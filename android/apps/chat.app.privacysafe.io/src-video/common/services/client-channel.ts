/*
  Copyright (C) 2024 - 2026 3NSoft Inc.

  This program is free software: you can redistribute it and/or modify it under
  the terms of the GNU General Public License as published by the Free Software
  Foundation, either version 3 of the License, or (at your option) any later
  version.

  This program is distributed in the hope that it will be useful, but
  WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
  See the GNU General Public License for more details.

  You should have received a copy of the GNU General Public License along with
  this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * Client WebRTC Channel — Star (Host-Client) Architecture
 *
 * The client:
 * 1. Creates ONE RTCPeerConnection to the Host
 * 2. Adds local tracks (camera/mic) to the connection
 * 3. Generates SDP Offer and sends to Host via signaling channel
 * 4. Waits for SDP Answer from Host
 * 5. Listens for incoming tracks (streams from other participants)
 *
 * Extracted from the former webrtc-peer-channel.ts to reduce file size.
 * Shared logic is in:
 * - webrtc-utils.ts: createRetryWatcher, applyAnswerWithRecovery, etc.
 * - shared-pc-setup.ts: setupPeerConnection (ICE/connection handlers)
 * - shared-screen-share.ts: buildScreenAddr, createProxyStreamForScreen
 */

import type {
  AnswerSignalPayload,
  CandidatesBatchPayload,
  ClientWebRTCChannel,
  OfferSignalPayload,
  ParticipantReconnectingInfo,
  RelaySlotDeclaration,
  StreamSenderInfo,
  StreamStateInfo,
  StreamSenderInfosBatchPayload,
  ClientChannelParams,
  StarSignalMessage,
} from '@video/common/types/star.types';
import { getVideoQualityConfig, SIMULCAST_ENCODINGS } from './star-constants';
import {
  extractSenderFromStream,
  applyBitrateToAllSenders,
  applyCodecPreferences,
  createRetryWatcher,
  createSdpFreshnessGate,
  createSerialTaskQueue,
  applyAnswerWithRecovery,
  audioEnergyGrowth,
  logTrackMuteState,
  parseSdpOrigin,
  MAX_RECREATE_COUNT,
  SUPERSEDED_REOFFER_MIN_INTERVAL_MILLIS,
} from './webrtc-utils';
import { setupPeerConnection } from './shared-pc-setup';
import { buildScreenAddr, createProxyStreamForScreen } from './shared-screen-share';
import {
  buildSlotReservation,
  clearedRelaySlotOnDeparture,
  relaySlotOwnerToShow,
  type SlotSpec,
} from './relay-slots';
import { makeLogger } from '@shared/logger';

/**
 * Lines that must survive the call window.
 *
 * The rest of this file logs to `console`, which lives and dies with the call
 * window (see log-relay.ts). Reserved slots go through the logger instead: a
 * slot is where another participant's voice arrives, and "the tile is there and
 * silent" is a state only this side can report.
 */
const log = makeLogger('ClientChannel');

/**
 * How often a client states what its reserved slots are carrying.
 *
 * Paired with the host's relay matrix, which runs on the same period: read side
 * by side, the two say whether media that left the host ever arrived.
 */
const SLOT_REPORT_INTERVAL_MS = 5000;

/**
 * How long a slot may name an owner without a single RTP packet before that is
 * called out.
 *
 * A mapping is the host stating it has put a participant's track into this
 * m-line, and the client puts a tile up on the strength of it. If nothing then
 * arrives, the viewer sees that participant and hears nothing - the group call
 * of 2026-08-19 - and neither side said a word. Two report periods, so a slot
 * filled moments before a tick is not accused of silence.
 */
const SLOT_SILENCE_REPORT_MS = 10_000;

/**
 * A relay slot as the client tracks it: an m-line offered `recvonly` for the
 * host to fill later with whichever participant it needs to relay.
 *
 * The client cannot rely on 'ontrack' here, and cannot rely on the stream id
 * either. A slot is negotiated once, with an empty stream whose id then never
 * changes — so when the host hands the m-line to a different participant there
 * is no new 'ontrack' and no new msid, only a mapping naming a new owner. That
 * is why the track is taken straight off the receiver and kept here until it is
 * safe to show, rather than pushed to the UI the moment it appears.
 */
interface ClientRelaySlot {
  declaration: RelaySlotDeclaration;
  transceiver: RTCRtpTransceiver;
  /** Owner as the host stated it. Authoritative; `forAddr` is only a guess. */
  mappedOwner: string | null;
  /** Whether RTP was ever seen on this slot (an 'unmute', or arriving unmuted). */
  hasMedia: boolean;
  /** Address this slot's track is currently shown under, if any. */
  emittedFor: string | null;
  /** The host did not claim this m-line (an older build): unusable. */
  dead: boolean;
  /** Whether the mute/unmute listeners are attached. */
  watched: boolean;
  /** Whether the negotiated direction was ever examined (for the log only). */
  reviewed: boolean;
}

// Retry constants for the SDP Offer watchdog.
const MAX_OFFER_RETRIES = 3;
// Counted from the moment the offer send is INITIATED (the watcher is armed
// before awaiting delivery confirmation, see negotiate()). A retry is for a
// LOST offer, and ASMail does not lose messages — it delivers them slowly:
// measured one-way latency is 10-20s, so an answer can only arrive 20-40s+
// after the send. Retrying earlier than that races the in-flight answer,
// multiplies multi-KB duplicates on the already-slow channel and, worse,
// used to trigger a pc recreate while the real answer was still on the wire
// (observed 2026-08-10: exhaustion at 43s vs answer RTT ~30-40s). When the
// signaling DC is open these delays are irrelevant — retries are skipped.
const OFFER_RETRY_DELAYS = [45_000, 60_000, 60_000];
const MAX_FAST_RETRIES = 3;
// Extra pause after a send came back unconfirmed. That verdict arrives only
// once the delivery-confirmation timeout has run out, so sub-second haste
// here only multiplies duplicates without making an answer arrive any sooner.
const FAST_RETRY_DELAY = 5000;
// How long after a rollback to wait for the native 'negotiationneeded' before
// checking for transceivers it left unnegotiated (see
// scheduleRenegotiateAfterRollback). Long enough for the event to fire and
// its negotiate() to leave 'stable'; short enough that a stalled screen share
// resumes promptly.
const POST_ROLLBACK_RENEGOTIATE_DELAY_MS = 1000;
// Same check, but while signalling still rides ASMail. The answer we just sent
// to the host needs a 5-12s one-way leg before the host leaves
// 'have-local-offer', and an offer of ours arriving before that is dropped by
// the impolite host as a collision — which schedules this check again, and so
// on. Waiting past the transport's latency is what turns the loop into a
// single clean renegotiation.
const POST_ROLLBACK_RENEGOTIATE_DELAY_ASMAIL_MS = 15_000;

// Group-call reconnect cycle: pause before each fresh connection attempt
// after the previous one ran its full budget (offer retries + recreate, or
// grace + recreate) without connecting. Capped at the last value — the cycle
// itself never gives up, the user decides when to leave. One attempt takes
// tens of seconds of retries on its own, so even the capped pace puts a
// fresh offer on ASMail at most about once a minute.
const RECONNECT_CYCLE_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000];

// Host-silence watchdog (group calls). The host's background heartbeats every
// participant of a live call every 15s (HEARTBEAT_INTERVAL in deno's
// call.ts), and that heartbeat is forwarded into this window — so while the
// call exists, SOMETHING from the host keeps arriving even when SDP-sized
// deliveries are failing. Silence longer than this (6 missed heartbeats),
// while we are not connected and HAVE heard the host before, means the host
// ended the call or is gone (or the channel to us is dead entirely — the
// call is unusable either way): time to close the window locally, since the
// host's 'disconnect' evidently cannot reach us.
const HOST_SILENCE_END_MS = 90_000;
const HOST_SILENCE_CHECK_MS = 15_000;

// Deadline for a client that has never heard the host at all. Keeping such a
// window open indefinitely was a deliberate choice, but every path that could
// still rescue the call is spent long before this: the offer retry budget
// (45+60+60s) and several reconnect cycles all fit inside it. Past it the window
// is showing a call that does not exist, so it closes with a notice — which also
// lets the background record the exit and clear its state instead of waiting for
// the user to notice.
const HOST_NEVER_HEARD_END_MS = 5 * 60_000;

/**
 * Creates a client-side WebRTC channel.
 *
 * @param params - Configuration parameters
 * @returns ClientWebRTCChannel interface
 */
export function createClientChannel(params: ClientChannelParams): ClientWebRTCChannel {
  const {
    hostAddr,
    ownAddr,
    rtcConfig,
    localStream,
    signalingChannel,
    onRemoteTrack,
    onConnectionStateChange,
    onRemoteStreamStateChanged,
    onStreamSenderInfo,
    onParticipantLeft,
    onParticipantReconnecting,
    onCallFull,
    onHostEndedCall,
  } = params;

  const participantCount = params.participantCount ?? 2;
  const videoQuality = getVideoQualityConfig(participantCount);
  const isGroupCall = !!params.isGroupCall;

  let peerConnection: RTCPeerConnection | null = null;
  let isClosed = false;

  // Perfect Negotiation state (client side)
  // Client is the POLITE peer: on an offer collision it rolls back its own
  // pending local offer and accepts the Host's (impolite peer's) offer.
  const polite = true;
  let makingOffer = false;

  // Serialises every incoming offer/answer from the host: two of them in one
  // ASMail batch must not be applied concurrently (see createSerialTaskQueue).
  const sdpQueue = createSerialTaskQueue();

  // Freshness watermarks for host SDP (StarSignalMessage.msgTs), kept per kind:
  // the newest send time of each kind we have already processed. ASMail reorders,
  // so without them an old offer arriving late is taken for a brand-new SDP
  // session and answered with a pc recreate. Offers and answers only —
  // candidates are self-buffering and app signals are order-insensitive.
  const hostSdpFreshness = createSdpFreshnessGate();

  // When the current pc last reached 'connected'. Diagnostics and the link
  // watchdogs; the new-session guard uses the peer-clock baseline below instead.
  let connectedAt = 0;

  // The host's clock as we last saw it, frozen when the pc generation now in use
  // was created. An offer the host sent before that cannot describe anything
  // newer than what we are already running, so it must never cost us this pc.
  let pcGenHostTsBaseline = 0;

  // Origin (o= line) of the last host offer this side applied — the client
  // mirror of the host's lastAppliedOfferOrigin. Tells a RETRIED host offer
  // (same session+version: resend our answer) from an offer of a NEW SDP
  // session (the host recreated its pc: our current pc can never apply it,
  // so we recreate and answer). Reset on every local pc recreate.
  let lastHostOfferOrigin: { sessionId: string; version: number } | null = null;

  // Blocks negotiate() while an answer-first recreate is applying the host's
  // offer to a fresh pc: transceivers created during that setup queue
  // 'negotiationneeded', and offering before our answer is sent would start
  // the very glare this path exists to avoid.
  let suppressNegotiation = false;

  // Buffer for ICE candidates that arrive before remote description is set
  const pendingCandidates: RTCIceCandidateInit[] = [];

  // Track screen share senders for cleanup
  const screenTrackSenders = new Set<RTCRtpSender>();

  // Screen stream-sender-info payloads to (re)send when signaling DC opens.
  // ASMail may deliver offer before stream-sender-info; DC resend closes the race.
  const pendingScreenSenderInfos = new Map<
    string,
    { streamId: string; senderAddr: string; screenName?: string }
  >();

  // Reserved relay slots, by mid, and the transceivers reserved for the current
  // pc generation before their mids exist. Both belong to that generation and
  // are dropped when it is replaced (see createPeerConnection).
  const relaySlots = new Map<string, ClientRelaySlot>();
  let reservedSlotTransceivers: Array<{ transceiver: RTCRtpTransceiver; spec: SlotSpec }> = [];

  // Retry watcher for the SDP Offer (replaces scheduleOfferRetry).
  // Uses the shared createRetryWatcher from webrtc-utils.ts.
  const offerRetryWatcher = createRetryWatcher({
    label: `[Client ${ownAddr}]`,
    maxRetries: MAX_OFFER_RETRIES,
    retryDelays: OFFER_RETRY_DELAYS,
    maxFastRetries: MAX_FAST_RETRIES,
    fastRetryDelay: FAST_RETRY_DELAY,
    shouldSkip: () => {
      if (isClosed) { return true; }
      // Retry only while our own offer is pending an answer (same semantics
      // as the host's watcher). Once the answer applied - or the offer rolled
      // back for a colliding one of the host's - the state left
      // 'have-local-offer' and there is nothing to re-send. Deliberately NOT
      // keyed on ICE state: a renegotiation offer (screen share, mid-call)
      // runs with ICE 'connected', and skipping on that left a lost answer
      // unrecovered forever - the screen m-line never finished negotiating.
      return peerConnection?.signalingState !== 'have-local-offer';
    },
    retry: async () => {
      // Re-send the pending offer AS IS (same as the host's retry path).
      // Re-creating it via setLocalDescription() bumped the SDP origin
      // version on every retry, so the host's duplicate-offer check (which
      // matches on origin session + version) never recognized a retry and
      // answered each one as a brand-new offer — one duplicate answer and a
      // spurious renegotiation round per retry.
      const desc = peerConnection?.localDescription;
      if (desc) {
        // Stamped, not gated: the watcher's budget is the recovery, and spending
        // it on a suppressed tick would be spending the recovery. The stamp is
        // what keeps the next resendCurrentOffer() from doubling up on this send.
        lastOfferSendAttemptAt = Date.now();
        // With the slot declarations again: a retry is for an offer the host
        // never saw, and one without them would leave every reserved m-line
        // unclaimed for the life of the connection.
        return await signalingChannel.sendDescription(offerPayloadOf(desc.toJSON()));
      }
      return true;
    },
    onExhausted: () => {
      if (isClosed) {
        return;
      }
      // No recreate here: an unanswered offer means SLOW delivery far more
      // often than a lost one, and recreating tears down the pc the host's
      // in-flight answer belongs to — the structural source of the
      // cross-generation glare storms (2026-08-11 revision). A recreate is
      // reserved for a real failure: SDP errors (applyAnswerWithRecovery)
      // and connectionState 'failed'. Here just report the link so the group
      // reconnect cycle (or, in 1-1, the setup/host watchdogs) takes over.
      console.warn(
        `[Client ${ownAddr}] Offer retries exhausted; leaving recovery to link watchdogs`,
      );
      reportLinkFailure('offer retries exhausted');
    },
    // Which negotiation is retrying: still joining, or a mid-call renegotiation
    // (a screen share, above all). From the bare `Scheduling retry N/M` line the
    // two were indistinguishable, which is what made the group-call log of
    // 2026-08-13 unreadable. Here `currentRemoteDescription === null` says it
    // exactly - no answer has ever been applied to this pc - whereas the host
    // has to ask a different question (see describePcLeg there); the words are
    // kept the same on both sides so the two logs read side by side.
    describeState: () => {
      const pc = peerConnection;
      if (!pc) {
        return 'no connection';
      }
      const leg = (pc.currentRemoteDescription === null) ? 'joining' : 'mid-call';
      return `leg=${leg} signalingState=${pc.signalingState} `
        + `connectionState=${pc.connectionState} iceState=${pc.iceConnectionState} `
        + `sigDc=${isSignalingFast() ? 'open' : 'none'}`;
    },
  });

  // Shared PC setup result (grace timer + quality monitor cleanup).
  let pcSetup: ReturnType<typeof setupPeerConnection> | null = null;

  // Timestamp of the last offer sent to the host, for the ICE-restart recovery
  // to tell an answer still in flight from a lost one (see
  // STRANDED_OFFER_ROLLBACK_AGE_MILLIS). Cleared on every pc recreate.
  let lastOfferSentAt: number | null = null;

  /**
   * When an offer was last put on the wire, by ANY path: the initial send from
   * negotiate(), a retry-watcher tick, or the immediate "host answered a
   * superseded offer" re-send.
   *
   * Separate from `lastOfferSentAt` on purpose, even though the two are usually
   * stamped together: that one feeds the stranded-offer rollback
   * (STRANDED_OFFER_ROLLBACK_AGE_MILLIS), so a re-send updating it would keep
   * postponing the rollback of an offer that is genuinely stuck - forever, since
   * every postponement is followed by another re-send.
   *
   * What this one does is keep two independent re-send paths from putting two
   * multi-KB offers on a struggling transport for one fact, which is the client
   * half of the host's ANSWER_RESEND_MIN_INTERVAL_MILLIS.
   */
  let lastOfferSendAttemptAt = 0;

  // Recreates spent in the current attempt, and a guard against two recovery
  // paths (failed answer, grace expiry, reconnect cycle) rebuilding the pc at
  // the same time — the loser would close the connection the winner just
  // registered. Both recreate paths (plain and answer-first) share the flag.
  let recreateCount = 0;
  let recreateInProgress = false;

  // One full-recreate attempt after the disconnect grace period expires,
  // before the connection is reported 'failed' (which ends a 1-1 call).
  let reconnectRecreateAttempted = false;
  let reconnectFailureTimer: ReturnType<typeof setTimeout> | null = null;
  // How long the recreated connection gets to reach 'connected'. Covers a
  // fresh offer/answer round trip over ASMail.
  const RECONNECT_RECREATE_TIMEOUT_MS = 60_000;

  function clearReconnectFailureTimer(): void {
    if (reconnectFailureTimer !== null) {
      clearTimeout(reconnectFailureTimer);
      reconnectFailureTimer = null;
    }
  }

  // Group-call reconnect cycle (see RECONNECT_CYCLE_BACKOFF_MS). One timer at
  // a time: an attempt's several failure signals (offer budget exhausted, pc
  // 'failed', grace expiry) must schedule one next cycle, not three.
  let reconnectCycleAttempt = 0;
  let reconnectCycleTimer: ReturnType<typeof setTimeout> | null = null;

  function resetReconnectCycle(): void {
    if (reconnectCycleTimer !== null) {
      clearTimeout(reconnectCycleTimer);
      reconnectCycleTimer = null;
    }
    reconnectCycleAttempt = 0;
  }

  function scheduleReconnectCycle(reason: string): void {
    if (isClosed || (reconnectCycleTimer !== null)) {
      return;
    }
    const delay = RECONNECT_CYCLE_BACKOFF_MS[
      Math.min(reconnectCycleAttempt, RECONNECT_CYCLE_BACKOFF_MS.length - 1)
    ];
    reconnectCycleAttempt += 1;
    console.warn(
      `[Client ${ownAddr}] Reconnect cycle #${reconnectCycleAttempt} to Host in ${delay}ms (${reason})`,
    );
    onConnectionStateChange('reconnecting');
    reconnectCycleTimer = setTimeout(() => {
      reconnectCycleTimer = null;
      if (isClosed || (peerConnection?.connectionState === 'connected')) {
        return;
      }
      // A fresh cycle gets the full recovery budget back: the one-shot
      // recreate flag below exists to stop a single attempt from spinning,
      // not to cap the number of attempts.
      reconnectRecreateAttempted = false;
      recreateCount = 0;
      clearReconnectFailureTimer();
      void recreatePeerConnection();
    }, delay);
  }

  /**
   * The link to the host is past in-place recovery. In a 1-1 call that is the
   * end of the call ('failed' → window closes); in a group call the call may
   * well still be going on without us, so the channel keeps cycling fresh
   * connection attempts and reports 'reconnecting' instead.
   */
  function reportLinkFailure(reason: string): void {
    if (isGroupCall) {
      scheduleReconnectCycle(reason);
    } else {
      onConnectionStateChange('failed');
    }
  }

  // Host-silence watchdog (see HOST_SILENCE_END_MS). `null` until the host is
  // heard for the first time; see HOST_NEVER_HEARD_END_MS for what bounds that
  // case.
  let lastHostActivityAt: number | null = null;
  let hostSilenceWatchdog: ReturnType<typeof setInterval> | null = null;
  const channelCreatedAt = Date.now();
  // Inbound byte count of the last watchdog tick, for telling a live media path
  // from a pc merely stuck in 'connected' (see below). Reset on pc recreate.
  let lastInboundBytes: number | null = null;

  function noteHostActivity(): void {
    if (!isClosed) {
      lastHostActivityAt = Date.now();
    }
  }

  function stopHostSilenceWatchdog(): void {
    if (hostSilenceWatchdog !== null) {
      clearInterval(hostSilenceWatchdog);
      hostSilenceWatchdog = null;
    }
  }

  function giveUpOnHost(why: string): void {
    console.warn(`[Client ${ownAddr}] ${why} — treating the call as ended/unreachable`);
    stopHostSilenceWatchdog();
    resetReconnectCycle();
    params.onHostUnreachable?.();
  }

  /**
   * Sums bytes received across the pc. RTCP keeps flowing even with every track
   * muted, so any live media path moves this counter; a host process that died
   * (or tore the call down) while our pc still reports 'connected' does not.
   */
  async function totalInboundBytes(pc: RTCPeerConnection): Promise<number | null> {
    try {
      let bytes = 0;
      let sawTransport = false;
      (await pc.getStats()).forEach(r => {
        if (r.type === 'transport') {
          bytes += (r.bytesReceived ?? 0);
          sawTransport = true;
        }
      });
      return sawTransport ? bytes : null;
    } catch {
      return null;
    }
  }

  if (isGroupCall && params.onHostUnreachable) {
    hostSilenceWatchdog = setInterval(() => {
      if (isClosed) {
        stopHostSilenceWatchdog();
        return;
      }
      const pc = peerConnection;

      if (lastHostActivityAt === null) {
        // Never heard the host at all. Keeping such a window open forever was
        // an explicit product decision, but "forever" outlived every recovery
        // path by a wide margin: offer retries (45+60+60s) and the reconnect
        // cycle are long done by then, so past this deadline there is nothing
        // left that could still bring the call up.
        const waited = Date.now() - channelCreatedAt;
        if (waited > HOST_NEVER_HEARD_END_MS) {
          giveUpOnHost(`Never heard from Host within ${waited}ms`);
        }
        return;
      }

      if (pc?.connectionState === 'connected') {
        // A pc in 'connected' used to disqualify the watchdog outright, which
        // is how a window survived a host that had ended the call: consent
        // freshness can hold 'connected' long after the peer is gone. Trust
        // moving bytes, not the state label — and if stats are unavailable,
        // keep the old, conservative behaviour.
        void totalInboundBytes(pc).then(bytes => {
          if (bytes === null) {
            noteHostActivity();
            return;
          }
          if ((lastInboundBytes === null) || (bytes > lastInboundBytes)) {
            lastInboundBytes = bytes;
            noteHostActivity();
          }
        });
        return;
      }

      const silence = Date.now() - lastHostActivityAt;
      if (silence <= HOST_SILENCE_END_MS) {
        return;
      }
      giveUpOnHost(
        `Nothing heard from Host for ${silence}ms (pcState: ${pc?.connectionState ?? 'none'})`,
      );
    }, HOST_SILENCE_CHECK_MS);
  }

  // ===========================================================================
  // Reserved relay slots (client side)
  // ===========================================================================
  // The client is the side that has to reserve them: only an offer can add
  // m-lines, and only this side offers on the happy path. Each slot is one
  // `recvonly` m-line the host answers as `sendonly` while it still has nothing
  // to send there — after which a participant joining the call costs the host a
  // replaceTrack and a mapping message, not an offer to everyone already in.
  // See relay-slots.ts for why that matters and star.types.ts for the wire form.

  /**
   * Adds this generation's slot m-lines. Called from createPeerConnection AFTER
   * the local tracks: addTrack() attaches to the first compatible unused
   * transceiver, so reserving first would have handed our own microphone the
   * first reserved audio slot.
   */
  function reserveRelaySlots(pc: RTCPeerConnection): void {
    const rosterAddrs = params.reservedPeers?.() ?? [];
    const specs = buildSlotReservation({ ownAddr, hostAddr, rosterAddrs, isGroupCall });
    for (const spec of specs) {
      try {
        reservedSlotTransceivers.push({
          transceiver: pc.addTransceiver(spec.kind, { direction: 'recvonly' }),
          spec,
        });
      } catch (err) {
        log.error(`failed to reserve a ${spec.kind} relay slot`, err);
        break;
      }
    }
    if (reservedSlotTransceivers.length > 0) {
      console.log(
        `[Client ${ownAddr}] Reserved ${reservedSlotTransceivers.length} relay slot(s) `
        + `for a roster of ${rosterAddrs.length}`,
      );
    }
  }

  /**
   * The declarations to put into the offer being sent, registering any slot
   * whose mid has just come into existence.
   *
   * Sent with EVERY offer, not once: mids only exist after
   * setLocalDescription, and a slot reserved later (a bigger roster after a
   * recreate) has to reach the host without a message of its own.
   */
  function collectRelaySlotDeclarations(): RelaySlotDeclaration[] {
    const declarations: RelaySlotDeclaration[] = [];
    for (const { transceiver, spec } of reservedSlotTransceivers) {
      const mid = transceiver.mid;
      if (!mid) {
        continue;
      }
      const declaration: RelaySlotDeclaration = {
        mid,
        kind: spec.kind,
        purpose: spec.purpose,
        ...(spec.forAddr ? { forAddr: spec.forAddr } : {}),
      };
      const existing = relaySlots.get(mid);
      if (existing) {
        existing.declaration = declaration;
      } else {
        // Only an m-line that has never been negotiated can become a slot. On
        // the answer-first recreate path the browser may pair a reserved
        // transceiver with one of the host's own sending m-lines; such a
        // transceiver already carries real relay media, and declaring it would
        // both mislead the host and hide that media from the ordinary
        // 'ontrack' path.
        if (transceiver.currentDirection !== null) {
          continue;
        }
        const slot: ClientRelaySlot = {
          declaration,
          transceiver,
          mappedOwner: null,
          hasMedia: false,
          emittedFor: null,
          dead: false,
          watched: false,
          reviewed: false,
        };
        relaySlots.set(mid, slot);
        watchRelaySlot(slot);
      }
      declarations.push(declaration);
    }
    return declarations;
  }

  /** The offer as it goes on the wire: the SDP plus the slots it declares. */
  function offerPayloadOf(description: RTCSessionDescriptionInit): OfferSignalPayload {
    const slots = collectRelaySlotDeclarations();
    return { ...description, ...(slots.length > 0 ? { relaySlots: slots } : {}) };
  }

  /**
   * Watches a slot's receiver track for the first RTP.
   *
   * 'unmute' is the only local evidence that a slot actually carries someone:
   * the mapping that names them travels separately and, over ASMail, arrives
   * 7-15s later. Both are needed before the tile appears — see emitRelaySlot.
   */
  function watchRelaySlot(slot: ClientRelaySlot): void {
    const track = slot.transceiver.receiver.track;
    if (!track || slot.watched) {
      return;
    }
    slot.watched = true;
    if (!track.muted) {
      slot.hasMedia = true;
    }
    track.addEventListener('unmute', () => {
      slot.hasMedia = true;
      console.log(`[Client ${ownAddr}] Relay slot ${slot.declaration.mid} started carrying media`);
      emitRelaySlot(slot);
    });
  }

  /**
   * Hands a slot's track to the UI, or re-points it at a new owner.
   *
   * Two conditions, and the second one is what keeps a call from sprouting black
   * tiles: the owner has to be known, AND there has to be a sign of real media.
   * A mapping is such a sign in itself (the host only sends one once it has put
   * a track in), so it satisfies both at once; the client's own `forAddr` hint
   * needs an 'unmute' to back it up. Emitting on the reservation alone would
   * give every not-yet-joined participant of the roster a stream, which hides
   * the connecting banner behind tiles that never fill.
   */
  function emitRelaySlot(slot: ClientRelaySlot): void {
    if (slot.dead || isClosed) {
      return;
    }
    const track = slot.transceiver.receiver.track;
    if (!track || (track.readyState === 'ended')) {
      return;
    }
    const owner = relaySlotOwnerToShow({
      mappedOwner: slot.mappedOwner,
      hasMedia: slot.hasMedia,
      forAddr: slot.declaration.forAddr,
    });
    if (!owner || (slot.emittedFor === owner)) {
      return;
    }
    if (slot.emittedFor) {
      // The host reassigned this m-line. Nothing else can tell the viewer: the
      // msid did not change and no second 'ontrack' fires, so without taking
      // the track off the old tile first the same media would show twice.
      console.log(
        `[Client ${ownAddr}] Relay slot ${slot.declaration.mid} moves from `
        + `${slot.emittedFor} to ${owner}`,
      );
      params.onRemoteTrackDetached?.(track, slot.emittedFor);
    }
    slot.emittedFor = owner;
    logTrackMuteState(track, `[Client ${ownAddr}] slot ${slot.declaration.mid}`, owner);
    // An explicit address, not a stream id to be resolved: a slot's stream is
    // the empty one it was negotiated with and says nothing about its owner.
    onRemoteTrack(track, new MediaStream([track]), owner);
  }

  /**
   * Checks, once an answer has applied, which slots the host actually claimed.
   *
   * An unclaimed one comes back 'inactive' (two receiving directions intersect
   * to nothing) — that is a host on a build without slots, and the fallback is
   * simply the renegotiated relay that has always been there.
   */
  function reviewRelaySlots(): void {
    for (const slot of relaySlots.values()) {
      const direction = slot.transceiver.currentDirection;
      if (direction === null) {
        continue; // not negotiated yet
      }
      const claimed = (direction === 'recvonly') || (direction === 'sendrecv');
      const changed = !slot.reviewed || (slot.dead === claimed);
      slot.dead = !claimed;
      slot.reviewed = true;
      if (changed) {
        (claimed ? log.info : log.warn)(
          `relay slot ${slot.declaration.mid} (${slot.declaration.kind}) `
          + (claimed
            ? `is live (${direction})`
            : `was not claimed by the host (${direction}); relay falls back to renegotiation`),
        );
      }
      if (claimed) {
        watchRelaySlot(slot);
        emitRelaySlot(slot);
      }
    }
  }

  // ===========================================================================
  // Slot diagnostics
  // ===========================================================================

  /** Per mid: what the last report saw, and since when an owner is named. */
  const slotReportState = new Map<string, {
    packets: number; energy: number | undefined; mappedSince: number | null;
  }>();
  let slotReportTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * What a slot's receiver is getting: packets, and for audio how loud it is.
   *
   * Packets say the m-line carries RTP; they do not say it carries a voice. A
   * muted microphone at the far end, and a host whose relay bridge produces no
   * samples, both arrive here as a steady packet rate of silence.
   * `totalAudioEnergy` is cumulative, so its growth between ticks is the part a
   * listener would call "hearing them".
   */
  async function inboundReportOf(
    receiver: RTCRtpReceiver,
  ): Promise<{ packets: number; energy: number | undefined }> {
    try {
      let packets = -1;
      let energy: number | undefined = undefined;
      (await receiver.getStats()).forEach(report => {
        if (report.type === 'inbound-rtp') {
          const inbound = report as unknown as {
            packetsReceived?: number; totalAudioEnergy?: number;
          };
          packets = inbound.packetsReceived ?? 0;
          energy = inbound.totalAudioEnergy;
        }
      });
      return { packets, energy };
    } catch {
      return { packets: -1, energy: undefined };
    }
  }

  /** ` nrg=…` for an audio slot, empty for video. Same field as the host prints. */
  function loudnessOf(
    kind: string,
    report: { energy: number | undefined },
    previousEnergy: number | undefined,
  ): string {
    return (kind === 'audio') ? ` nrg=${audioEnergyGrowth(report.energy, previousEnergy)}` : '';
  }

  /**
   * What every reserved slot is carrying, said out loud once per period.
   *
   * The counterpart of the host's relay matrix. A slot that names an owner and
   * receives nothing is reported as its own line: that is a participant the
   * viewer can see and cannot hear, and it is the only shape of failure in this
   * architecture that leaves every connection healthy.
   */
  async function logRelaySlots(): Promise<void> {
    if (isClosed || (relaySlots.size === 0)) {
      return;
    }
    const now = Date.now();
    const parts: string[] = [];
    for (const slot of relaySlots.values()) {
      const mid = slot.declaration.mid;
      const track = slot.transceiver.receiver.track;
      const report = await inboundReportOf(slot.transceiver.receiver);
      const packets = report.packets;
      const previous = slotReportState.get(mid);
      const owner = slot.mappedOwner ?? slot.emittedFor;
      const mappedSince = owner ? (previous?.mappedSince ?? now) : null;
      slotReportState.set(mid, { packets, energy: report.energy, mappedSince });
      const delta = ((previous === undefined) || (packets < 0))
        ? '?' : `+${packets - previous.packets}`;
      parts.push(
        `${mid} ${slot.declaration.kind}/${slot.declaration.purpose}`
        + ` for=${slot.declaration.forAddr ?? '-'} mapped=${slot.mappedOwner ?? '-'}`
        + ` shown=${slot.emittedFor ?? '-'} dir=${slot.transceiver.currentDirection ?? '-'}`
        + `${slot.dead ? ' DEAD' : ''} muted=${track ? track.muted : 'no-track'} recv=${delta}`
        + loudnessOf(slot.declaration.kind, report, previous?.energy),
      );
      // Silence with an owner named: the fault this report exists for.
      if (owner && mappedSince && ((now - mappedSince) >= SLOT_SILENCE_REPORT_MS)
        && (packets >= 0) && previous && (packets === previous.packets)) {
        log.warn(
          `relay slot ${mid} (${slot.declaration.kind}) has carried ${owner} for `
          + `${Math.round((now - mappedSince) / 1000)}s without a single packet: `
          + `the host says it filled this m-line and nothing is arriving`,
        );
      }
    }
    log.info(`relay slots: ${parts.join(' | ')}`);
    for (const mid of [...slotReportState.keys()]) {
      if (!relaySlots.has(mid)) {
        slotReportState.delete(mid);
      }
    }
  }

  function startSlotReporting(): void {
    if (slotReportTimer !== null) {
      return;
    }
    slotReportTimer = setInterval(() => {
      void logRelaySlots().catch(() => {
        // Diagnostics may not break what they observe.
      });
    }, SLOT_REPORT_INTERVAL_MS);
  }

  function stopSlotReporting(): void {
    if (slotReportTimer !== null) {
      clearInterval(slotReportTimer);
      slotReportTimer = null;
    }
    slotReportState.clear();
  }

  /**
   * Forgets what a departing participant left in the slots.
   *
   * Their tile is gone (the UI acts on 'participant-left'), but a slot still
   * naming them as its emitted owner would refuse to emit again when they
   * re-join into the same m-line — `emittedFor === owner` reads as "already
   * shown", and the tile would never come back. The host reuses that very slot
   * for a re-join on purpose (`forAddr`), so this is the normal course of events,
   * not an edge case.
   */
  function forgetRelaySlotOwner(participantAddr: string): void {
    for (const slot of relaySlots.values()) {
      if ((slot.emittedFor !== participantAddr) && (slot.mappedOwner !== participantAddr)) {
        continue;
      }
      // The track's own mute state is logged, never consulted: it is the
      // evidence for the race clearedRelaySlotOnDeparture() exists for, and
      // reading it here is precisely what used to cause that race.
      console.log(
        `[Client ${ownAddr}] Relay slot ${slot.declaration.mid} freed: ${participantAddr} left `
        + `(track muted=${slot.transceiver.receiver.track?.muted ?? 'no track'})`,
      );
      Object.assign(slot, clearedRelaySlotOnDeparture());
    }
  }

  /**
   * A stream mapping from the host, whichever transport carried it.
   *
   * `mid` wins over `streamId` where present: it is the only field that can
   * express "this m-line now carries someone else", which is the normal course
   * of events for a slot. The mapping is still passed on to the app layer,
   * which needs it for screen-share titles and for the ordinary relay path.
   */
  function applyStreamSenderInfo(info: StreamSenderInfo): void {
    if (info.mid) {
      const slot = relaySlots.get(info.mid);
      if (slot) {
        if (slot.mappedOwner !== info.senderAddr) {
          console.log(
            `[Client ${ownAddr}] Relay slot ${info.mid} now carries ${info.senderAddr}`,
          );
          slot.mappedOwner = info.senderAddr;
        }
        emitRelaySlot(slot);
      } else {
        log.warn(
          `mapping names relay slot ${info.mid}, which this pc does not have`,
        );
      }
    }
    onStreamSenderInfo?.(info.streamId, info.senderAddr, info.screenName);
  }

  /**
   * Creates and configures the RTCPeerConnection.
   */
  function createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection(rtcConfig);
    pcGenHostTsBaseline = hostSdpFreshness.highWater();
    // Slots belong to the pc that negotiated them: their transceivers die with
    // it, and the replacement declares its own from the current roster.
    relaySlots.clear();
    reservedSlotTransceivers = [];

    // Perfect Negotiation: ALL outgoing offers (the initial one and any
    // renegotiation, e.g. screen share add/remove) are driven strictly by
    // the native 'negotiationneeded' event. No manual createOffer() calls.
    pc.onnegotiationneeded = () => {
      negotiate().catch(err => {
        console.error(`[Client ${ownAddr}] onnegotiationneeded failed:`, err);
      });
    };

    // Bootstrap SCTP: puts an m=application line into the client's very first
    // offer. The host's DataChannels ('streamInfo', 'signaling') are created
    // on its side before it answers, but an SDP answer cannot ADD an m-line —
    // without this, they could only be negotiated by a host-initiated
    // renegotiation offer, i.e. a full extra offer/answer round trip over
    // ASMail before the low-latency signaling path existed at all. With the
    // m-line in the initial offer, the SCTP association comes up together
    // with media and the host's channels open in-band, no renegotiation
    // needed. This channel itself carries nothing.
    pc.createDataChannel('sctp-bootstrap');

    // Add transceivers for receiving audio and video from Host.
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.addTransceiver('video', { direction: 'recvonly' });

    // Add local tracks with simulcast for video.
    localStream.getTracks().forEach(track => {
      if (track.kind === 'video') {
        pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [localStream],
          sendEncodings: SIMULCAST_ENCODINGS,
        });
      } else {
        pc.addTrack(track, localStream);
      }
    });

    // Relay slots, after the local tracks on purpose (see reserveRelaySlots)
    // and before codec preferences, so their m-lines are pinned like the rest.
    reserveRelaySlots(pc);
    // Idempotent, and started here rather than at channel creation: before the
    // first pc there are no slots to report on.
    startSlotReporting();

    // Apply codec preferences to all transceivers to eliminate payload-type
    // (PT) codec collisions (e.g. duplicate PT 49/119 for RTX/RED across
    // BUNDLE m-lines) that break renegotiation and cause glitches.
    applyCodecPreferences(pc, `Client ${ownAddr}`);

    // Handle incoming tracks from Host (streams from other participants)
    pc.ontrack = (event: RTCTrackEvent) => {
      // A slot fires 'ontrack' as soon as it is negotiated — while it is still
      // empty, under the empty stream it was negotiated with. Handing that to
      // the UI would give every reserved participant a stream at once, so the
      // slot registry holds it until its owner is known and media is flowing.
      const mid = event.transceiver.mid;
      const slot = mid ? relaySlots.get(mid) : undefined;
      if (slot) {
        console.log(
          `[Client ${ownAddr}] Track on relay slot ${mid}; held until its owner is known`,
        );
        watchRelaySlot(slot);
        emitRelaySlot(slot);
        return;
      }
      const stream = event.streams[0];
      if (stream) {
        const fromAddr = extractSenderFromStream(stream);
        console.log(`[Client ${ownAddr}] Received track from ${fromAddr} via Host, kind: ${event.track.kind}`);
        logTrackMuteState(event.track, `[Client ${ownAddr}]`, fromAddr);
        onRemoteTrack(event.track, stream, fromAddr);
      }
    };

    // Wire shared event handlers (ICE candidate, connection state, quality monitor).
    pcSetup = setupPeerConnection(pc, {
      label: `Client ${ownAddr} -> Host ${hostAddr}`,
      rtcConfig,
      onIceCandidate: candidate => {
        if (!isClosed) {
          signalingChannel.sendCandidate(candidate.toJSON());
        }
      },
      onIceGatheringComplete: () => {
        if (!isClosed) {
          signalingChannel.flushCandidates?.();
        }
      },
      onConnectionStateChange: state => {
        if (state === 'connected') {
          clearReconnectFailureTimer();
          reconnectRecreateAttempted = false;
          resetReconnectCycle();
          // A link that did come up earns a fresh recreate budget: the cap is
          // there to stop a never-converging pc from spinning, not to limit
          // recovery over the lifetime of a long call.
          recreateCount = 0;
          connectedAt = Date.now();
          noteHostActivity();
        }
        if ((state === 'failed') && isGroupCall) {
          // A dead pc is not the end of a group call: keep the UI on
          // 'reconnecting' and let the cycle bring a fresh connection up.
          // 'failed' still goes through for a 1-1 call and for the terminal
          // cases that emit it directly (call-full).
          scheduleReconnectCycle('peer connection failed');
          return;
        }
        onConnectionStateChange(state);
      },
      onRequestRenegotiate: () => {
        negotiate().catch(err => {
          console.error(`[Client ${ownAddr}] Re-offer after ICE restart failed:`, err);
        });
      },
      strandedOfferAgeMillis: () => (
        ((peerConnection === pc) && (lastOfferSentAt !== null))
          ? (Date.now() - lastOfferSentAt) : null
      ),
      onGraceTimeout: () => {
        if (isClosed) {
          return;
        }
        if (reconnectRecreateAttempted) {
          reportLinkFailure('grace expired after a recreate');
          return;
        }
        // One full-recreate attempt before giving up: an in-place ICE restart
        // may have nothing to work with (e.g. the host already dropped this
        // pc), while a fresh offer on a new PeerConnection can still be
        // answered. 'failed' is reported only if this attempt does not
        // connect either.
        reconnectRecreateAttempted = true;
        console.warn(
          `[Client ${ownAddr}] Grace period expired — recreating connection to Host before giving up`,
        );
        reconnectFailureTimer = setTimeout(() => {
          reconnectFailureTimer = null;
          if (!isClosed && peerConnection?.connectionState !== 'connected') {
            console.warn(
              `[Client ${ownAddr}] Recreated connection did not connect in time`,
            );
            reportLinkFailure('recreated connection did not connect in time');
          }
        }, RECONNECT_RECREATE_TIMEOUT_MS);
        void recreatePeerConnection();
      },
      onDataChannel: (event: RTCDataChannelEvent) => {
        const channel = event.channel;
        if (channel.label === 'streamInfo') {
          console.log(`[Client ${ownAddr}] Received streamInfo data channel from Host`);
          channel.onmessage = (msgEvent: MessageEvent) => {
            try {
              const info = JSON.parse(msgEvent.data) as StreamSenderInfo;
              console.log(
                `[Client ${ownAddr}] DataChannel stream-sender-info: `
                + `${info.mid ? `slot ${info.mid}` : info.streamId} -> ${info.senderAddr}`,
              );
              applyStreamSenderInfo(info);
            } catch (err) {
              console.error(`[Client ${ownAddr}] Failed to parse streamInfo data channel message:`, err);
            }
          };
        } else if (channel.label === 'signaling') {
          console.log(`[Client ${ownAddr}] Received signaling data channel from Host`);
          // Register the DC with the signaling channel so outgoing signals
          // are sent via DC (low-latency) instead of ASMail once it opens.
          signalingChannel.setDataChannel?.(channel);
          channel.onmessage = (msgEvent: MessageEvent) => {
            try {
              const signal = JSON.parse(msgEvent.data) as StarSignalMessage;
              console.log(`[Client ${ownAddr}] DC signaling: ${signal.type} from ${signal.fromAddr}`);
              signalingChannel.handleIncomingSignal(signal);
            } catch (err) {
              console.error(`[Client ${ownAddr}] Failed to parse signaling DC message:`, err);
            }
          };

          const resendScreenInfos = () => {
            for (const info of pendingScreenSenderInfos.values()) {
              signalingChannel
                .sendSignal('stream-sender-info', info)
                .then(() => {
                  console.log(
                    `[Client ${ownAddr}] Re-sent screen stream-sender-info via DC: ${info.streamId} -> ${info.senderAddr}`,
                  );
                })
                .catch(err => {
                  console.error(`[Client ${ownAddr}] Failed to re-send screen stream-sender-info:`, err);
                });
            }
          };
          if (channel.readyState === 'open') {
            resendScreenInfos();
          } else {
            channel.addEventListener('open', resendScreenInfos, { once: true });
          }
        }
      },
    });

    return pc;
  }

  /**
   * Perfect Negotiation core: creates the local description (offer) and
   * sends it to the Host. Called ONLY from the native 'negotiationneeded'
   * event (and from createAndSendOffer() for the initial bootstrap).
   */
  async function negotiate(): Promise<void> {
    const pc = peerConnection;
    if (!pc || isClosed) {
      return;
    }
    // Held back, not dropped. Chromium fires 'negotiationneeded' the instant a
    // rollback's answer returns the pc to 'stable', which sent a fresh offer
    // immediately — straight into the host's still-unanswered one, over a
    // transport where that round trip takes 15-30s (group call of 2026-08-12).
    // The wait belongs to holdNegotiationAfterRollback; remembering the need is
    // what keeps a legitimate renegotiation from being lost with it — notably
    // STOPPING a screen share, which its heuristic cannot detect.
    if (suppressNegotiation || postRollbackHold) {
      negotiationDeferred = true;
      return;
    }

    // `makingOffer` guard (mirrors the host at negotiateWithClient): a
    // 'negotiationneeded' firing while the first setLocalDescription() is
    // still pending sees 'stable' and would start a SECOND offer, bumping the
    // o= version and defeating the host's duplicate-offer dedup.
    if (pc.signalingState !== 'stable' || makingOffer) {
      return;
    }

    try {
      makingOffer = true;
      console.log(`[Client ${ownAddr}] Creating SDP Offer for Host ${hostAddr}`);
      // Pin codecs on every negotiation, not only at PC creation: a
      // transceiver added since (the screen-share one, above all) still has
      // the full native codec list, and an unpinned m-line in the BUNDLE
      // group is where payload-type collisions come from (see
      // applyCodecPreferences).
      applyCodecPreferences(pc, `Client ${ownAddr} (negotiate)`);
      await pc.setLocalDescription();
      const desc = pc.localDescription;
      if (desc) {
        lastOfferSentAt = Date.now();
        lastOfferSendAttemptAt = lastOfferSentAt;
        applyBitrateToAllSenders(pc, videoQuality).catch(() => {});
        // Every negotiate() starts a new negotiation cycle with a fresh retry
        // budget - without this, renegotiations over a call's lifetime
        // (screen share on/off, track changes) drain one shared budget and
        // later cycles get no retries at all.
        //
        // The watcher is armed BEFORE awaiting delivery confirmation: the
        // await below resolves only when the ASMail delivery finished (or
        // its timeout ran out), and starting the retry clock after that
        // pushed the first re-send of a lost offer past half a minute.
        // shouldSkip() keeps an early tick harmless — it re-sends the same
        // SDP (deduped by the host) and only while the offer is pending.
        offerRetryWatcher.resetCounters();
        offerRetryWatcher.schedule();
        const delivered = await signalingChannel.sendDescription(offerPayloadOf(desc.toJSON()));
        // `delivered` is "not reported failed", not "confirmed" — see
        // sendSignalViaAsmail. The authoritative outcome line is logged there.
        console.log(`[Client ${ownAddr}] SDP Offer sent to Host (not reported failed: ${delivered})`);
        if (!delivered) {
          offerRetryWatcher.schedule(true);
        }
      }
    } catch (err) {
      console.error(`[Client ${ownAddr}] Failed to create/send SDP Offer:`, err);
    } finally {
      makingOffer = false;
    }
  }

  /**
   * Creates the PeerConnection (if needed) and kicks off the initial offer.
   */
  async function createAndSendOffer(): Promise<void> {
    if (isClosed) {
      throw new Error('Channel is closed');
    }

    if (!peerConnection) {
      peerConnection = createPeerConnection();
    }

    await negotiate();
  }

  /**
   * Flushes ICE candidates buffered while there was no remote description.
   */
  async function flushPendingCandidates(): Promise<void> {
    const pc = peerConnection;
    if (!pc || !pc.remoteDescription || pendingCandidates.length === 0) {
      return;
    }
    console.log(`[Client ${ownAddr}] Flushing ${pendingCandidates.length} buffered ICE candidates`);
    for (const candidate of pendingCandidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error(`[Client ${ownAddr}] Failed to add buffered ICE candidate:`, err);
      }
    }
    pendingCandidates.length = 0;
  }

  /**
   * Re-sends the offer currently pending with the host, throttled. Used when
   * the host demonstrably answered an older offer, i.e. the current one never
   * got there. The retry watcher is left untouched as the slow-path net.
   */
  function resendCurrentOffer(reason: string): void {
    const pc = peerConnection;
    if (!pc || isClosed || (pc.signalingState !== 'have-local-offer')) {
      return;
    }
    const desc = pc.localDescription;
    if (!desc) {
      return;
    }
    const now = Date.now();
    // Against every offer send, not only against previous re-sends of this kind:
    // a retry-watcher tick puts the same SDP on the wire, and the two coinciding
    // is what doubled the traffic during the 500 storm of 2026-08-13.
    const since = now - lastOfferSendAttemptAt;
    if (since < SUPERSEDED_REOFFER_MIN_INTERVAL_MILLIS) {
      console.log(
        `[Client ${ownAddr}] Skipping offer re-send (${reason}): last offer went out ${since}ms ago`,
      );
      return;
    }
    lastOfferSendAttemptAt = now;
    console.log(`[Client ${ownAddr}] Re-sending current offer to Host now (${reason})`);
    signalingChannel.sendDescription(offerPayloadOf(desc.toJSON())).catch(err => {
      console.error(`[Client ${ownAddr}] Failed to re-send offer to Host:`, err);
    });
  }

  /**
   * Applies SDP Answer received from the Host.
   * Also flushes any buffered ICE candidates that arrived before the answer.
   */
  async function applyAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    if (isClosed) {
      return;
    }

    // Perfect Negotiation: an Answer is only meaningful while our own offer
    // is pending. A stale Answer is silently dropped - WITHOUT touching the
    // retry watcher: clearing it here (as this used to do) permanently
    // disabled the re-send of an offer whose real answer was lost, and the
    // screen-share m-line it carried never finished negotiating.
    if (peerConnection.signalingState !== 'have-local-offer') {
      console.debug(
        `[Client ${ownAddr}] Ignoring stale Answer: signaling state is ${peerConnection.signalingState}`,
      );
      return;
    }

    // Correlate: an answer to a superseded offer applies CLEANLY to this pc
    // (same m-line shape) and silently pairs it with the host's already-dead
    // pc generation — 'have-local-offer' alone cannot tell. Absent answerTo
    // (older peer) is accepted as before.
    const answerTo = (answer as AnswerSignalPayload).answerTo;
    if (answerTo) {
      const ownOffer = parseSdpOrigin(peerConnection.localDescription?.sdp);
      if (ownOffer && (answerTo.sessionId !== ownOffer.sessionId
        || answerTo.version !== ownOffer.version)) {
        console.warn(
          `[Client ${ownAddr}] Ignoring answer to a superseded offer `
            + `(answerTo ${answerTo.sessionId}/${answerTo.version}, `
            + `current offer ${ownOffer.sessionId}/${ownOffer.version}); waiting for the right one`,
        );
        // The host answered an offer we have since replaced, so it never saw
        // the current one. Re-send it now rather than sitting out the 45s
        // retry delay (mirror of the host's recovery for the same case).
        resendCurrentOffer('host answered a superseded offer');
        return;
      }
    }

    offerRetryWatcher.clear();

    console.log(`[Client ${ownAddr}] Applying SDP Answer from Host`);
    await applyAnswerWithRecovery(peerConnection, answer, {
      label: `[Client ${ownAddr}]`,
      onRollbackReoffer: () => negotiate(),
      onRecreate: () => recreatePeerConnection(),
    });

    // Flush buffered ICE candidates now that remote description is set
    await flushPendingCandidates();

    // The answer states which reserved m-lines the host took up as a sender.
    reviewRelaySlots();
  }

  /**
   * Recreates the entire RTCPeerConnection to the Host when the SDP session
   * got hopelessly out of sync (e.g. rollback + re-offer still failed).
   */
  async function recreatePeerConnection(): Promise<void> {
    if (isClosed) {
      return;
    }

    if (recreateInProgress) {
      console.log(`[Client ${ownAddr}] Recreate already in progress, skipping`);
      return;
    }

    // A pc rebuilt this many times without ever connecting is not going to
    // converge on its own. Hand over to the link watchdogs: in a group call
    // that is the reconnect cycle (which grants a fresh budget per attempt, so
    // the pace is set by its backoff), in 1-1 it ends the call.
    if (recreateCount >= MAX_RECREATE_COUNT) {
      console.warn(
        `[Client ${ownAddr}] Recreate budget exhausted (${MAX_RECREATE_COUNT}); `
        + `leaving recovery to link watchdogs`,
      );
      reportLinkFailure('recreate budget exhausted');
      return;
    }

    recreateInProgress = true;
    try {
      recreateCount += 1;
      await recreatePeerConnectionUnguarded();
    } finally {
      recreateInProgress = false;
    }
  }

  async function recreatePeerConnectionUnguarded(): Promise<void> {
    console.log(
      `[Client ${ownAddr}] Recreating peer connection to Host ${hostAddr} `
      + `(recreate ${recreateCount}/${MAX_RECREATE_COUNT})`,
    );

    // Stop the old pc's quality monitor and grace timer before closing it,
    // so they neither leak nor fire against the fresh connection.
    pcSetup?.stopQualityMonitor();
    pcSetup = null;

    if (peerConnection) {
      try {
        peerConnection.close();
      } catch {
        // ignore close errors
      }
      peerConnection = null;
    }

    offerRetryWatcher.clear();
    offerRetryWatcher.resetCounters();
    makingOffer = false;
    pendingCandidates.length = 0;
    // Outbound candidates still batched for the old pc must not be sent.
    signalingChannel.clearCandidates?.();
    lastHostOfferOrigin = null;
    lastOfferSentAt = null;
    // The new generation's first offer is not a re-send of the old one's and must
    // not be throttled against it.
    lastOfferSendAttemptAt = 0;
    // A hold (and the need it remembers) belongs to the generation that rolled
    // back; this one starts by offering anyway.
    clearPostRollbackHold();
    // The new pc has not connected yet: an inherited timestamp would let it
    // claim a connection it never made.
    connectedAt = 0;
    // Byte counters belong to the pc that produced them.
    lastInboundBytes = null;

    try {
      await createAndSendOffer();
      console.log(`[Client ${ownAddr}] Recreated connection to Host, fresh offer sent`);
    } catch (err) {
      console.error(`[Client ${ownAddr}] Failed to recreate connection to Host:`, err);
    }
  }

  /**
   * Applies ICE candidate received from the Host.
   * If remote description is not yet set, buffers the candidate for later.
   */
  async function applyCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!peerConnection || isClosed) {
      return;
    }

    if (!peerConnection.remoteDescription) {
      pendingCandidates.push(candidate);
      return;
    }

    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.error(`[Client ${ownAddr}] Failed to add ICE candidate:`, err);
    }
  }

  /**
   * Sends stream state (mic/cam) change signal to Host.
   */
  async function sendStreamState(state: StreamStateInfo): Promise<void> {
    if (isClosed || !signalingChannel) {
      return;
    }

    try {
      await signalingChannel.sendSignal('stream-state-changed', state);
      console.log(`[Client ${ownAddr}] Stream state sent: audio=${state.audio}, video=${state.video}`);
    } catch (err) {
      console.error(`[Client ${ownAddr}] Failed to send stream state:`, err);
    }
  }

  /**
   * Adds a screen share track to the existing PeerConnection.
   */
  async function addScreenTrack(
    track: MediaStreamTrack,
    _screenStream: MediaStream,
    mailerId: string,
    srcId: string,
    screenName?: string,
  ): Promise<void> {
    if (!peerConnection || isClosed) {
      console.warn(`[Client ${ownAddr}] Cannot add screen track: no peer connection`);
      return;
    }

    const screenAddr = buildScreenAddr(mailerId, srcId);
    const proxyStream = createProxyStreamForScreen(track);
    const actualStreamId = proxyStream.id;
    const senderInfo = {
      streamId: actualStreamId,
      senderAddr: screenAddr,
      screenName,
    };

    try {
      // Publish mapping before addTransceiver so a fast local path can resolve
      // it; ASMail reorder is still handled on the host via pending buffer.
      pendingScreenSenderInfos.set(actualStreamId, senderInfo);
      await signalingChannel.sendSignal('stream-sender-info', senderInfo).catch(err => {
        console.error(`[Client ${ownAddr}] Failed to send screen stream-sender-info:`, err);
      });

      // A fresh transceiver every time, for the same reason as on the host:
      // re-pointing one the host is already receiving on changes only the
      // msid, giving the host no ontrack to tie the new share to. Retired
      // m-lines (see removeScreenTrack) are recycled by the browser once the
      // stop has been negotiated, so offers do not grow without bound.
      const transceiver = peerConnection.addTransceiver(track, {
        direction: 'sendrecv',
        streams: [proxyStream],
      });
      screenTrackSenders.add(transceiver.sender);

      console.log(
        `[Client ${ownAddr}] Screen track added (${screenAddr}, streamId: ${actualStreamId}), renegotiation via onnegotiationneeded`,
      );
    } catch (err) {
      console.error(`[Client ${ownAddr}] Failed to add screen track:`, err);
    }
  }

  /**
   * Removes a screen share track from the PeerConnection.
   */
  async function removeScreenTrack(track: MediaStreamTrack, mailerId: string, srcId: string): Promise<void> {
    if (!peerConnection || isClosed) {
      return;
    }

    const screenAddr = buildScreenAddr(mailerId, srcId);
    const senders = peerConnection.getSenders();
    const sender = senders.find(s => s.track === track);

    if (sender) {
      try {
        const transceiver = peerConnection.getTransceivers().find(tr => tr.sender === sender);
        screenTrackSenders.delete(sender);
        // stop() rather than removeTrack: the transceiver survives removeTrack
        // and its m-line would rot in every subsequent offer. Stopping it gets
        // the m-line rejected on the next negotiation, and gives the host a
        // clean end-of-track for this share.
        if (transceiver) {
          transceiver.stop();
        } else {
          peerConnection.removeTrack(sender);
        }
        console.log(`[Client ${ownAddr}] Screen track removed (${screenAddr})`);
      } catch (err) {
        console.error(`[Client ${ownAddr}] Failed to remove screen track:`, err);
        return;
      }
    }

    for (const [streamId, info] of [...pendingScreenSenderInfos.entries()]) {
      if (info.senderAddr === screenAddr) {
        pendingScreenSenderInfos.delete(streamId);
      }
    }

    signalingChannel
      .sendSignal('participant-left', {
        addr: screenAddr,
        name: screenAddr,
      })
      .catch(err => {
        console.error(`[Client ${ownAddr}] Failed to send participant-left for ${screenAddr}:`, err);
      });
  }

  /**
   * Notifies the Host that this client is leaving the call, via the
   * low-latency signaling DataChannel (falling back to ASMail). No-op once
   * the channel is already closed — e.g. when the Host ended the call and
   * `close()` already ran from the 'disconnect' signal handler below —
   * so a departing client never "replies" to the Host that ended the call.
   */
  function notifyHostOfLeaving(): Promise<void> {
    if (isClosed) { return Promise.resolve(); }
    // The returned promise settles once the signal is on its way (DC send, or
    // the ASMail delivery sub-system accepted it) — endCall() waits on it (with
    // a cap) before closeSelf(), so the window no longer closes 150ms after a
    // fire-and-forget send that never made it out of the process.
    return signalingChannel.sendSignal('disconnect').then(
      () => {},
      err => {
        console.error(`[Client ${ownAddr}] Failed to send disconnect on leave:`, err);
      },
    );
  }

  /**
   * Asks the host to re-send every stream-id → sender-address mapping.
   *
   * Sent when tracks have arrived without their 'stream-sender-info': the first
   * mapping can travel over best-effort ASMail, before the streamInfo
   * DataChannel opens, and be lost. Fire-and-forget on purpose - the caller
   * gives up on its own timeout, and the request costs nothing to repeat.
   */
  function requestStreamMappings(): void {
    if (isClosed) { return; }
    void signalingChannel.sendSignal('request-stream-info').catch(err => {
      console.error(`[Client ${ownAddr}] Failed to ask host for stream mappings:`, err);
    });
  }

  function isSignalingFast(): boolean {
    return signalingChannel.isDataChannelOpen?.() ?? false;
  }

  /**
   * Closes the connection and cleans up resources.
   */
  function close(): void {
    if (isClosed) {
      return;
    }

    isClosed = true;
    console.log(`[Client ${ownAddr}] Closing WebRTC channel`);

    offerRetryWatcher.clear();
    clearReconnectFailureTimer();
    resetReconnectCycle();
    stopHostSilenceWatchdog();
    clearPostRollbackHold();
    stopSlotReporting();
    pcSetup?.stopQualityMonitor();

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    screenTrackSenders.clear();
    pendingScreenSenderInfos.clear();
    relaySlots.clear();
    reservedSlotTransceivers = [];
    signalingChannel.close();
  }

  /**
   * Handles an incoming SDP Offer from the Host (initial or renegotiation),
   * following the Perfect Negotiation pattern (client = POLITE peer).
   */
  async function handleRenegotiationOffer(
    offer: RTCSessionDescriptionInit, msgTs?: number,
  ): Promise<void> {
    const pc = peerConnection;
    if (!pc || isClosed) {
      console.warn(`[Client ${ownAddr}] Cannot handle offer from Host: no peer connection`);
      return;
    }

    const origin = parseSdpOrigin(offer.sdp);

    // A RETRIED host offer (same SDP session and version as the one already
    // applied): the host's retry watcher re-sends it when our answer got lost
    // on ASMail. Re-applying is impossible ('stable' refuses a duplicate),
    // so resend the existing answer instead — the client mirror of the host's
    // isRetriedOffer handling.
    if (origin && lastHostOfferOrigin
      && (origin.sessionId === lastHostOfferOrigin.sessionId)
      && (origin.version === lastHostOfferOrigin.version)
      && (pc.signalingState === 'stable')
      && (pc.localDescription?.type === 'answer')) {
      console.log(`[Client ${ownAddr}] Duplicate (retried) host offer; resending existing answer`);
      try {
        await signalingChannel.sendAnswer({ type: 'answer', sdp: pc.localDescription.sdp, answerTo: origin });
      } catch (err) {
        console.error(`[Client ${ownAddr}] Failed to resend answer for retried host offer:`, err);
      }
      return;
    }

    // An offer of a NEW SDP session means the host recreated its peer
    // connection: its m-line topology no longer matches this pc's session, so
    // setRemoteDescription is bound to fail with an m-line order error. Do
    // not even try — recreate our own pc and answer the fresh offer on it.
    // `lastHostOfferOrigin` is only recorded from applied host OFFERS, so in
    // the usual bootstrap (this client offered, the host answered) it is null
    // for the whole call; the applied ANSWER carries the same o= sessionId the
    // host's offers would, so fall back to it as the baseline.
    const hostSessionBaseline = lastHostOfferOrigin
      ?? (pc.currentRemoteDescription
        ? parseSdpOrigin(pc.currentRemoteDescription.sdp)
        : null);
    if (origin && hostSessionBaseline
      && (origin.sessionId !== hostSessionBaseline.sessionId)
      && pc.currentRemoteDescription) {
      // ...unless this pc is up and the offer predates it. A session id only
      // says "different", never "newer": an offer ASMail held back from before
      // our connection came up describes a pc the host has already replaced.
      // Recreating on it threw away a working connection and handed the host a
      // new session id of our own, which made it recreate in turn — the
      // mutual-recreate loop that kept tiles flapping for minutes.
      // Measured against the host's own clock as of when this pc generation was
      // built, and NOT limited to a connected pc: the old form (msgTs vs our
      // connectedAt) could not fire before the first 'connected' — exactly where
      // the loop starts, since each diverging session id spends one of the two
      // recreates — and it compared our clock with the peer's.
      if ((msgTs !== undefined) && (msgTs <= pcGenHostTsBaseline)) {
        console.log(
          `[Client ${ownAddr}] Ignoring new-session host offer sent `
          + `${pcGenHostTsBaseline - msgTs}ms before this pc generation was built `
          + `(state: ${pc.connectionState}, connected ${connectedAt
            ? `${Date.now() - connectedAt}ms ago` : 'never'}, keeping the pc)`,
        );
        return;
      }
      console.log(
        `[Client ${ownAddr}] Host offer opens a new SDP session `
          + `(${hostSessionBaseline.sessionId} -> ${origin.sessionId}); recreating pc to answer it`,
      );
      await recreateAndAnswerHostOffer(offer, origin);
      return;
    }

    try {
      const offerCollision = makingOffer || pc.signalingState !== 'stable';
      const ignoreOffer = !polite && offerCollision;
      if (ignoreOffer) {
        console.log(`[Client ${ownAddr}] Ignoring colliding offer from Host`);
        return;
      }

      console.log(
        `[Client ${ownAddr}] Handling offer from Host (collision: ${offerCollision}, state: ${pc.signalingState})`,
      );

      if (offerCollision) {
        // Armed BEFORE the answer, not after it: Chromium queues
        // 'negotiationneeded' on the rollback and runs it as soon as the answer
        // below returns the pc to 'stable' — i.e. while sendAnswer is still
        // awaiting its ASMail leg. Arming afterwards is too late, and the offer
        // that escapes is the one that collides with the host's own.
        scheduleRenegotiateAfterRollback();
        // IMPORTANT: rollback + setRemoteDescription MUST be issued together
        // (Promise.all) to avoid a race condition with onnegotiationneeded.
        await Promise.all([pc.setLocalDescription({ type: 'rollback' }), pc.setRemoteDescription(offer)]);
        console.log(`[Client ${ownAddr}] Rolled back local offer and applied Host's offer (polite)`);
      } else {
        await pc.setRemoteDescription(offer);
      }
      lastHostOfferOrigin = origin;

      await pc.setLocalDescription();
      const answer = pc.localDescription;
      if (answer) {
        await signalingChannel.sendAnswer({
          type: 'answer', sdp: answer.sdp, ...(origin ? { answerTo: origin } : {}),
        });
        console.log(`[Client ${ownAddr}] Answer sent to Host`);
      }

      await flushPendingCandidates();

      if (offerCollision) {
        // Re-arm so the window is measured from the answer actually being sent,
        // not from the rollback: it exists to outlast that answer's ASMail leg.
        scheduleRenegotiateAfterRollback();
      }
    } catch (err) {
      console.error(`[Client ${ownAddr}] Failed to handle offer from Host:`, err);
      // An SDP-session mismatch (m-line order/count) means this pc can never
      // apply what the host now offers - logging alone left the client
      // permanently out of sync with the call. A fresh pc negotiates the
      // host's current topology from scratch.
      const name = (err as Error)?.name;
      const text = String((err as Error)?.message ?? err);
      const sdpMismatch = (name === 'InvalidAccessError')
        || (name === 'InvalidModificationError')
        || /m[- =]?lines?/i.test(text);
      if (sdpMismatch && !isClosed) {
        console.warn(
          `[Client ${ownAddr}] Host offer does not fit this SDP session; recreating peer connection`,
        );
        await recreatePeerConnection();
      }
    }
  }

  /**
   * Applies a host offer that opened a NEW SDP session (the host recreated
   * its peer connection) by recreating our own pc and answering on it -
   * answer-first, without racing our own offer against the host's.
   *
   * The fresh pc is built by createPeerConnection() with the usual local
   * transceivers; applying the host's offer as its FIRST remote description
   * matches m-lines by kind, so the host's topology is acceptable whatever
   * shape it has. Send transceivers of ours that the host's offer did not
   * cover are re-offered afterwards by scheduleRenegotiateAfterRollback(),
   * from 'stable' - a single clean renegotiation instead of glare.
   */
  async function recreateAndAnswerHostOffer(
    offer: RTCSessionDescriptionInit,
    origin: { sessionId: string; version: number },
  ): Promise<void> {
    // Shares the recreate guard with recreatePeerConnection(): both tear the
    // pc down and rebuild it, and neither may run while the other does.
    if (recreateInProgress) {
      console.log(
        `[Client ${ownAddr}] Recreate in progress; ignoring host's new-session offer for now`,
      );
      return;
    }
    // Answering the host's new session is normally the converging move, so
    // this path used to be exempt from the budget entirely. That exemption is
    // what let the mutual-recreate loop run unbounded: our fresh pc offers a
    // new session to the host, which recreates in turn, whose offer is a new
    // session to us, and round again. Past the cap, stop tearing down and let
    // the reconnect cycle drive recovery under its backoff instead — it grants
    // a fresh budget per attempt, and 'connected' clears the count outright,
    // so a long call with occasional breaks is unaffected.
    if (recreateCount >= MAX_RECREATE_COUNT) {
      console.warn(
        `[Client ${ownAddr}] Recreate budget exhausted (${MAX_RECREATE_COUNT}) while answering the `
        + `host's new session; deferring to the reconnect cycle`,
      );
      reportLinkFailure('new-session recreate budget exhausted');
      return;
    }
    recreateCount += 1;
    recreateInProgress = true;
    suppressNegotiation = true;
    try {
      pcSetup?.stopQualityMonitor();
      pcSetup = null;
      if (peerConnection) {
        try {
          peerConnection.close();
        } catch {
          // ignore close errors
        }
        peerConnection = null;
      }
      offerRetryWatcher.clear();
      offerRetryWatcher.resetCounters();
      makingOffer = false;
      // Buffered candidates belong to the old session; the host sends fresh
      // ones for the new pc. Same for our own outbound batch.
      pendingCandidates.length = 0;
      signalingChannel.clearCandidates?.();
      lastHostOfferOrigin = null;
      lastOfferSentAt = null;
      lastOfferSendAttemptAt = 0;
      clearPostRollbackHold();
      connectedAt = 0;
      lastInboundBytes = null;

      const pc = createPeerConnection();
      peerConnection = pc;

      await pc.setRemoteDescription(offer);
      lastHostOfferOrigin = origin;
      await pc.setLocalDescription();
      const answer = pc.localDescription;
      if (answer) {
        await signalingChannel.sendAnswer({ type: 'answer', sdp: answer.sdp, answerTo: origin });
        console.log(`[Client ${ownAddr}] Answered host's new-session offer on a fresh pc`);
      }
      await flushPendingCandidates();
    } catch (err) {
      console.error(
        `[Client ${ownAddr}] Failed to answer host's new-session offer on a fresh pc:`, err,
      );
    } finally {
      suppressNegotiation = false;
      recreateInProgress = false;
    }
    // Now that negotiate() is allowed again, re-offer any of our send
    // transceivers the host's offer did not cover (screen share, chiefly).
    scheduleRenegotiateAfterRollback();
  }

  /**
   * Post-rollback negotiation hold: while it is armed no offer leaves this side,
   * and any need for one is remembered in `negotiationDeferred` and served the
   * moment it lifts. Several colliding offers in a burst extend the same hold
   * rather than stacking timers. Belongs to the current pc generation.
   */
  let postRollbackHold: { timer: ReturnType<typeof setTimeout> } | null = null;
  let negotiationDeferred = false;

  /** Drops the hold without running it; for pc teardown/recreate. */
  function clearPostRollbackHold(): void {
    if (postRollbackHold) {
      clearTimeout(postRollbackHold.timer);
      postRollbackHold = null;
    }
    negotiationDeferred = false;
  }

  /**
   * After a rollback, the transceivers the rolled-back offer was negotiating
   * (a fresh screen-share m-line, chiefly) are supposed to fire
   * 'negotiationneeded' again once the state returns to stable. Chromium is
   * not reliable about that (the host side works around the same problem with
   * scheduleNegotiateWithClient), so this checks for transceivers left
   * unnegotiated and re-runs negotiate() itself. negotiate() no-ops outside
   * 'stable', making a spurious call here harmless.
   */
  function scheduleRenegotiateAfterRollback(): void {
    if (postRollbackHold) {
      clearTimeout(postRollbackHold.timer);
    }
    // Pace the check to the transport actually carrying our answer. Over the
    // DataChannel the host is back in 'stable' within milliseconds, so a
    // second is plenty. Over ASMail the answer we have just sent needs a
    // 5-12s leg, and offering after one second lands while the host still
    // holds its own unanswered offer — the impolite side drops ours as a
    // collision, and each collision schedules another one: the glare livelock
    // that kept a third participant dark (2026-08-11).
    const dcOpen = signalingChannel.isDataChannelOpen?.() ?? false;
    const delay = dcOpen
      ? POST_ROLLBACK_RENEGOTIATE_DELAY_MS
      : POST_ROLLBACK_RENEGOTIATE_DELAY_ASMAIL_MS;
    const timer = setTimeout(() => {
      postRollbackHold = null;
      const wanted = negotiationDeferred;
      negotiationDeferred = false;
      const pc = peerConnection;
      if (!pc || isClosed || pc.signalingState !== 'stable') {
        return;
      }
      // A negotiation asked for while the hold was up: run it, no questions.
      // This is the path that carries a screen share started — or stopped —
      // during the hold, which the heuristic below cannot see.
      if (wanted) {
        console.log(
          `[Client ${ownAddr}] Running the negotiation deferred during the `
            + `post-rollback hold (waited ${delay}ms for ${dcOpen ? 'DC' : 'ASMail'})`,
        );
        negotiate().catch(err => {
          console.error(`[Client ${ownAddr}] Deferred re-negotiate failed:`, err);
        });
        return;
      }
      // `stopped` exists at runtime but not in the project's TS lib version
      // (same defensive read as in applyCodecPreferences).
      //
      // Only OUR sending transceivers count: `currentDirection === null` is
      // also true of transceivers the host's own offer just created (recvonly
      // slots, relay m-lines mid-negotiation), and re-offering on those made
      // this fire after nearly every collision - a fresh client offer aimed
      // at a host that may still be in 'have-local-offer', i.e. yet another
      // glare. A transceiver is ours to re-offer only if we send on it and a
      // live track is attached.
      const unnegotiated = pc.getTransceivers().some(tr =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        !(tr as any).stopped && (tr.currentDirection === null)
        && ((tr.direction === 'sendonly') || (tr.direction === 'sendrecv'))
        && !!tr.sender.track
      );
      if (unnegotiated) {
        console.log(
          `[Client ${ownAddr}] Transceiver(s) left unnegotiated after rollback `
            + `and no 'negotiationneeded' fired; re-negotiating `
            + `(waited ${delay}ms for ${dcOpen ? 'DC' : 'ASMail'})`,
        );
        negotiate().catch(err => {
          console.error(`[Client ${ownAddr}] Post-rollback re-negotiate failed:`, err);
        });
      }
    }, delay);
    postRollbackHold = { timer };
  }

  /**
   * True when this SDP is older than one already processed from the host.
   *
   * ASMail neither orders nor deduplicates, so a retried or simply slow offer
   * can land after a newer one. Applying it is never useful: at best it is a
   * duplicate, at worst its unfamiliar session id reads as "the host recreated
   * its pc" and costs us a working connection. Retries carry a fresh stamp, so
   * only genuinely superseded copies are dropped; a peer on an older build
   * sends no stamp at all and keeps the previous behaviour.
   */
  function isStaleHostSdp(signal: StarSignalMessage, kind: string): boolean {
    return hostSdpFreshness.isStale(
      kind,
      signal.msgTs,
      behindMs => `[Client ${ownAddr}] Ignoring stale ${kind} from host: sent ${behindMs}ms `
        + `before the newest one already processed`,
    );
  }

  // Register handler for incoming signals from Host
  signalingChannel.onSignal(signal => {
    if (isClosed) { return; }

    // Any signal from the host is a sign of life for the silence watchdog,
    // whichever transport (ASMail or DC) it rode in on.
    noteHostActivity();

    switch (signal.type) {
      // Offers and answers go through one serial queue: an ASMail batch can
      // deliver two of them in the same tick, and concurrent handlers sample
      // signalingState before the other one has finished mutating it (see
      // createSerialTaskQueue).
      case 'offer':
        if (isStaleHostSdp(signal, 'offer')) { break; }
        sdpQueue.run(
          () => handleRenegotiationOffer(signal.data as RTCSessionDescriptionInit, signal.msgTs),
        ).catch(err => {
          console.error(`[Client ${ownAddr}] Unhandled error in handleRenegotiationOffer:`, err);
        });
        break;
      case 'answer':
        if (isStaleHostSdp(signal, 'answer')) { break; }
        sdpQueue.run(
          () => applyAnswer(signal.data as RTCSessionDescriptionInit),
        ).catch(err => {
          console.error(`[Client ${ownAddr}] Unhandled error in applyAnswer:`, err);
        });
        break;
      case 'candidate':
        applyCandidate(signal.data as RTCIceCandidateInit).catch(err => {
          console.error(`[Client ${ownAddr}] Unhandled error in applyCandidate:`, err);
        });
        break;
      case 'candidates': {
        // Batched ASMail candidates: applied one by one — applyCandidate
        // buffers into pendingCandidates while there is no remote description
        // and catches per-item errors, so one bad item cannot kill the rest.
        const batch = (signal.data as CandidatesBatchPayload)?.candidates ?? [];
        console.log(`[Client ${ownAddr}] Received batch of ${batch.length} ICE candidate(s)`);
        (async () => {
          for (const c of batch) {
            await applyCandidate(c);
          }
        })().catch(err => {
          console.error(`[Client ${ownAddr}] Unhandled error applying candidates batch:`, err);
        });
        break;
      }
      case 'stream-state-changed':
        if (onRemoteStreamStateChanged) {
          const stateData = signal.data as StreamStateInfo;
          console.log(
            `[Client ${ownAddr}] Remote stream state from ${signal.fromAddr}: audio=${stateData.audio}, video=${stateData.video}`,
          );
          onRemoteStreamStateChanged(signal.fromAddr, stateData);
        }
        break;
      case 'stream-sender-info':
        {
          const senderInfo = signal.data as StreamSenderInfo;
          console.log(
            `[Client ${ownAddr}] Stream sender info: `
            + `${senderInfo.mid ? `slot ${senderInfo.mid}` : senderInfo.streamId} -> ${senderInfo.senderAddr}`,
          );
          applyStreamSenderInfo(senderInfo);
        }
        break;
      case 'stream-sender-infos':
        // Batched ASMail mappings: same handling as the singles they replace.
        {
          const infos = (signal.data as StreamSenderInfosBatchPayload)?.infos ?? [];
          console.log(`[Client ${ownAddr}] Received batch of ${infos.length} stream mapping(s)`);
          for (const info of infos) {
            applyStreamSenderInfo(info);
          }
        }
        break;
      case 'participant-left':
        {
          const leftInfo = signal.data as { addr: string; name: string };
          console.log(`[Client ${ownAddr}] Participant left: ${leftInfo.addr}`);
          forgetRelaySlotOwner(leftInfo.addr);
          if (onParticipantLeft) {
            onParticipantLeft(leftInfo.addr);
          }
        }
        break;
      case 'participant-reconnecting':
        {
          const reconnectingInfo = signal.data as ParticipantReconnectingInfo;
          // `kind` is logged: without it the two meanings of this signal are
          // indistinguishable in a log, which is what made the "live video
          // under a reconnecting blur" of 2026-08-16 take a code read to
          // diagnose. Absent for a host on a build that predates the field.
          console.log(
            `[Client ${ownAddr}] Participant reconnecting: ${reconnectingInfo.addr} = `
              + `${reconnectingInfo.reconnecting} (${reconnectingInfo.kind ?? 'kind not stated'})`,
          );
          onParticipantReconnecting?.(
            reconnectingInfo.addr, reconnectingInfo.reconnecting, reconnectingInfo.kind,
          );
        }
        break;
      case 'call-full':
        {
          const fullInfo = signal.data as { maxParticipants: number; currentParticipants: number };
          console.log(
            `[Client ${ownAddr}] Call is full: ${fullInfo.currentParticipants}/${fullInfo.maxParticipants}`,
          );
          if (onCallFull) {
            onCallFull(fullInfo.maxParticipants, fullInfo.currentParticipants);
          }
          if (onConnectionStateChange) {
            onConnectionStateChange('failed');
          }
          close();
        }
        break;
      case 'disconnect':
        console.log(`[Client ${ownAddr}] Received disconnect signal from Host`);
        onHostEndedCall?.();
        close();
        break;
      case 'dropped':
        // The host gave up on our link after exhausting its retries. If we are
        // connected by now, our reconnect cycle already re-joined us as a
        // fresh client AFTER this signal was sent — a late copy (blind repeat,
        // slow ASMail) must not kill the working call.
        if (peerConnection?.connectionState === 'connected') {
          console.log(`[Client ${ownAddr}] Ignoring stale 'dropped' from Host: already (re)connected`);
          break;
        }
        console.warn(`[Client ${ownAddr}] Host dropped this client after exhausted retries`);
        params.onDroppedByHost?.();
        close();
        break;
    }
  });

  return {
    createAndSendOffer,
    applyAnswer,
    applyCandidate,
    close,
    notifyHostOfLeaving,
    noteHostActivity,
    requestStreamMappings,
    isSignalingFast,
    getPeerConnection: () => peerConnection,
    sendStreamState,
    addScreenTrack,
    removeScreenTrack,
  };
}
