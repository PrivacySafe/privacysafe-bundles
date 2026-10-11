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
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Host WebRTC Channel — Star (Host-Client) Architecture
 *
 * The host:
 * 1. Manages Map<clientAddr, RTCPeerConnection>
 * 2. Handles SDP Offers from clients, generates and sends Answers
 * 3. Receives tracks from clients
 * 4. SFU retransmission: broadcasts each client's tracks to all other clients
 * 5. Handles client disconnection and cleans up their tracks
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
  HostWebRTCChannel,
  OfferSignalPayload,
  ParticipantReconnectingInfo,
  StreamSenderInfo,
  StreamStateInfo,
  HostChannelParams,
  ClientConnection,
  StarSignalMessage,
} from '@video/common/types/star.types';
import { MAX_CALL_PARTICIPANTS, getVideoQualityConfig } from './star-constants';
import {
  parseSdpOrigin,
  applyBitrateToAllSenders,
  applySimulcastLayers,
  applyCodecPreferences,
  createAudioRelayBridge,
  applyVideoBitrateLimit,
  createRetryWatcher,
  createSdpFreshnessGate,
  createSerialTaskQueue,
  applyAnswerWithRecovery,
  audioEnergyGrowth,
  isUnapplicableOnThisPc,
  logTrackMuteState,
  sdpDirectionsByMid,
  MAX_RECREATE_COUNT,
  SUPERSEDED_REOFFER_MIN_INTERVAL_MILLIS,
  SUPERSEDED_REOFFER_MIN_INTERVAL_DC_MILLIS,
  type SdpFreshnessGate,
} from './webrtc-utils';
import { kindsAlreadyForwarded, pickSlot, streamInfoKey, type SlotState } from './relay-slots';
import { REJOIN_NOTICE_TTL_MS, rejoinNoticeAction, rejoinNoticeExpiry } from './rejoin-notice';
import { setupPeerConnection } from './shared-pc-setup';
import { createStreamInfoBatcher, type StreamInfoBatcher } from './signaling-channel-core';
import { toCanonicalAddress } from '@shared/address-utils';
import { createDepartureGate } from '@shared/departure-gate';
import { makeLogger } from '@shared/logger';
import {
  buildScreenAddr,
  createProxyStreamForScreen,
  isScreenShareAddr,
  extractSrcIdFromScreenAddr,
  // extractMailerIdFromScreenAddr,
  mayActFor,
} from './shared-screen-share';

/**
 * Lines that must survive the call window.
 *
 * Everything else in this file logs to `console`, which reaches the window's
 * devtools and nothing else — and the call window exists only while the call
 * does, so its output is gone with it (see log-relay.ts). That is why the media
 * side of a live run has never been readable afterwards. Only the media-relay
 * facts go through the logger: what was forwarded to whom, and every way that
 * can fail.
 */
const log = makeLogger('HostChannel');

// Retry constants for host-initiated renegotiation offers. A retry is for a
// LOST offer; ASMail delivers slowly (10-20s one-way), not lossily, so the
// answer to a renegotiation offer can only arrive 20-40s+ after the send.
// When the signaling DC is open, shouldSkip suppresses these entirely — the
// delays only matter for the ASMail phase, where anything shorter races the
// in-flight answer and multiplies multi-KB duplicates (2026-08-11 revision).
const MAX_NEGOTIATION_RETRIES = 2;
const NEGOTIATION_RETRY_DELAYS = [45_000, 60_000];
const MAX_NEGOTIATION_FAST_RETRIES = 3;
// Extra pause after a send came back unconfirmed: sub-second haste here only
// multiplies duplicates without making an answer arrive any sooner.
const NEGOTIATION_FAST_RETRY_DELAY = 5000;

// Retry constants for the initial SDP answer. A lost answer is also recovered
// by the client's own offer retry watcher (which re-sends the offer and gets
// the answer re-sent as a duplicate-offer response), so one late retry is
// enough; see NEGOTIATION_RETRY_DELAYS for why not shorter.
const MAX_ANSWER_RETRIES = 1;
const ANSWER_RETRY_DELAYS = [45_000];
const MAX_ANSWER_FAST_RETRIES = 1;
const ANSWER_FAST_RETRY_DELAY = 5000;

/**
 * How long an answer already on its way suppresses a RE-send of itself.
 *
 * The re-send paths are independent of each other: every duplicate (retried)
 * offer from a client gets the existing answer resent, and the answer retry
 * watcher ticks on its own schedule. They coincided during the 500 storm of
 * 2026-08-13, putting two multi-KB messages on the wire for one fact — at the
 * moment the transport could least afford them.
 *
 * 10 s is deliberately far below the 45 s watcher tick: at healthy timings this
 * never triggers, and it only ever collapses re-sends that are within seconds of
 * each other. The INITIAL answer is never suppressed — see needAnswerResend().
 */
const ANSWER_RESEND_MIN_INTERVAL_MILLIS = 10_000;

/**
 * How long a client may stay short of 'connected' (counted from its latest
 * accepted offer) before the host gives up on it. Every accepted offer
 * re-arms the deadline, so a client that is actively retrying keeps its
 * place; one that went silent — e.g. its window closed before ever
 * connecting, with the 'disconnect' lost on the same broken signalling
 * channel — gets removed, and the remaining participants receive a
 * 'participant-left' instead of keeping an eternal "about to start" tile.
 * About 2x the client's own full recovery budget (offer retries + one
 * recreate + grace), so a client still within that budget is never removed.
 */
const CLIENT_CONNECT_TIMEOUT_MS = 120_000;

/**
 * Cap and shelf life for ICE candidates that arrive before the client's
 * offer created its ClientConnection. Small ASMail messages overtake the
 * multi-KB offer routinely, and dropping them (the previous behavior) left
 * ICE waiting for the candidates' re-send. Stale entries are only ever a few
 * dozen bytes each, but a client that never sends an offer must not grow the
 * buffer forever.
 */
const MAX_EARLY_CANDIDATES_PER_CLIENT = 30;
const EARLY_CANDIDATES_TTL_MS = 120_000;

/**
 * How long an identical stream mapping already sent over ASMail suppresses a
 * repeat of itself. The mapping paths are deliberately re-entrant (every
 * 'ontrack', every renegotiation, every DC-less resend re-affirms everything),
 * which over ASMail turned into dozens of deliveries per join. Long enough to
 * collapse one join's worth of repeats, short enough that a genuinely lost
 * mapping is re-sent well within a call.
 */
const STREAM_INFO_RESEND_MIN_MS = 15_000;

/**
 * Shelf life of a client offer deferred as a glare collision (see
 * ClientConnection.deferredOffer). Matches the connect deadline: past it the
 * client has certainly re-offered on its own, and applying an offer this old
 * would answer a session the client has already abandoned.
 */
const DEFERRED_OFFER_TTL_MS = 120_000;

/**
 * Delay after a client's link is reported 'reconnecting' before other
 * participants (who cannot see that client's RTCPeerConnection directly)
 * are told to show a "reconnecting" hint on that participant's tile.
 * Deliberately shorter than DISCONNECT_GRACE_MILLIS (8s, unchanged) so a
 * brief network blip becomes visible well before the tile is actually
 * removed, without flashing the hint on every ICE hiccup that self-heals
 * in well under this delay.
 */
const RECONNECT_HINT_DELAY_MS = 2500;

/**
 * Debounce window for scheduleNegotiateWithClient(): coalesces the
 * addTransceiver calls for a source's audio and video tracks — which arrive
 * as separate 'ontrack' events, sometimes in separate task-queue turns, not
 * just separate microtasks — into a single renegotiation offer. Too short
 * and audio/video split across two offers (the second one racing the first
 * answer's ASMail round-trip); this is well under that round-trip time
 * (100ms-2s, see negotiateWithClient's retry watchdog) so it does not add
 * perceptible delay.
 */
const NEGOTIATE_DEBOUNCE_MS = 150;

/**
 * Safety net for scheduleNegotiateWithClient()'s event-driven wait for
 * 'stable': a re-check this often catches a missed 'signalingstatechange'
 * (or a makingOffer flag that flipped without a state change). The primary
 * wake-up is the event itself, so this timer almost never does the work.
 */
const NEGOTIATE_STABLE_SAFETY_MS = 5000;

/**
 * How long a renegotiation waits for the signaling DataChannel after the client's
 * pc reached 'connected'.
 *
 * The channel is created with the pc and opens in-band within tens of
 * milliseconds of DTLS completing, so this is a wide margin — and it is far less
 * than the one-way ASMail latency (7-15s) that waiting for it saves. Once open,
 * sendSignalToClient prefers it on its own, which turns a renegotiation round
 * trip from half a minute into milliseconds and makes glare trivially
 * recoverable.
 */
const NEGOTIATE_WAIT_DC_MS = 5000;

/**
 * Hard cap on holding a renegotiation back for a client that never connects.
 *
 * A premature host offer is destructive (see the gate in
 * attemptExplicitNegotiate) but it is also, by accident, a recovery path for a
 * lost initial answer: a polite client rolls its own offer back, answers ours,
 * and the session completes. That path must not be lost forever, only deferred
 * until the ordinary recoveries — the answer watchdog (45s) and the client's own
 * offer retries (45/60/60s) — have had their turn. Well inside
 * CLIENT_CONNECT_TIMEOUT_MS, which is what finally gives up on the client.
 */
const NEGOTIATE_WAIT_CONNECTED_MAX_MS = 60_000;

/**
 * How long a track buffered for want of 'stream-sender-info' waits before the
 * delay is reported as suspicious. Attribution may still arrive after this.
 */
const PENDING_TRACK_WARN_MS = 10_000;

/**
 * Hard limit on that wait. Past it the buffered tracks are released: the mapping
 * is evidently not coming, and a held MediaStreamTrack keeps a decoder alive.
 * Without this bound a long call with repeated screen-share start/stop
 * accumulates a buffer entry per abandoned stream.id, none of which is ever
 * freed until the call ends.
 */
const PENDING_TRACK_DISCARD_MS = 60_000;

/**
 * Buffered streams kept per client. Screen sharing produces a new stream.id on
 * every start, so a client whose mappings keep going missing must not be able to
 * grow the buffer without limit; the oldest entry is released instead.
 */
const MAX_PENDING_STREAMS_PER_CLIENT = 4;

/**
 * How often the host states what it is actually relaying, per client and source.
 *
 * The same 5s as the quality monitor, and for the same reason: two consecutive
 * readings are what turn a counter into "is media flowing", and a longer period
 * only delays the answer a broken call is waiting for.
 */
const RELAY_MATRIX_INTERVAL_MS = 5000;

/**
 * Creates a host-side WebRTC channel.
 *
 * @param params - Configuration parameters
 * @returns HostWebRTCChannel interface
 */
export function createHostChannel(params: HostChannelParams): HostWebRTCChannel {
  const {
    ownAddr,
    rtcConfig,
    localStream,
    signalingChannel,
    onClientConnected,
    onClientDisconnected,
    onClientConnectionStateChange,
    onClientTrack,
    onStreamStateChanged,
    onStreamSenderInfo,
    onParticipantLeft,
    onParticipantReconnecting,
    getOwnScreenTracks,
  } = params;

  const participantCount = params.participantCount ?? 2;
  const videoQuality = getVideoQualityConfig(participantCount);

  // Map of connected clients
  const clients = new Map<string, ClientConnection>();

  // Per-client PC setup cleanup (grace timer + quality monitor)
  const pcSetups = new Map<string, ReturnType<typeof setupPeerConnection>>();

  // Clients whose peer connection is currently being rebuilt. Guards against
  // two recovery paths recreating the same client at the same time.
  const recreatesInProgress = new Set<string>();

  // Per-client batching of ASMail-delivered stream mappings, and what was last
  // sent to each client (to suppress identical repeats). Both are dropped when a
  // client's connection is rebuilt or the client goes away.
  const streamInfoBatchers = new Map<string, StreamInfoBatcher>();
  const sentStreamInfos = new Map<
    string, Map<string, { senderAddr: string; screenName?: string; sentAt: number }>
  >();

  // Per-client renegotiation retry watchers (replaces scheduleNegotiationRetry)
  const negotiationRetryWatchers = new Map<string, ReturnType<typeof createRetryWatcher>>();

  // Per-client retry watchers for the initial SDP answer (sent in the
  // background from handleClientOffer; a resend fires when its ASMail
  // delivery came back unconfirmed).
  const answerRetryWatchers = new Map<string, ReturnType<typeof createRetryWatcher>>();

  // Per-client "still reconnecting" hint timers (two-phase UI for network
  // blips — see RECONNECT_HINT_DELAY_MS below) and the set of clients for
  // whom the hint was actually sent (so recovery only broadcasts a
  // reconnecting:false when a reconnecting:true was seen by peers).
  const reconnectHintTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const reconnectHintSent = new Set<string>();

  // Clients that announced a re-join and have not arrived yet, with the expiry
  // of that announcement (see announceRejoiningPeer and REJOIN_NOTICE_TTL_MS).
  //
  // Kept apart from the two above although both broadcast the same signal: a
  // blip's reconnecting:false must go out the moment the link recovers, while a
  // re-join's must NOT — it is what takes the returning peer's placeholder tile
  // down, and the link "recovering" here means the peer is arriving. Sharing
  // the state made a successful return remove its own tile and re-add it a beat
  // later, on every single return.
  const rejoinNoticeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const rejoinAnnounced = new Set<string>();

  // Per-client "never connected" deadlines (see CLIENT_CONNECT_TIMEOUT_MS).
  const connectDeadlineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ICE candidates that arrived before the client's offer (see
  // MAX_EARLY_CANDIDATES_PER_CLIENT).
  const earlyClientCandidates = new Map<
    string,
    { bufferedAt: number; list: RTCIceCandidateInit[] }
  >();

  // Map of tracks from all clients (for retransmission)
  const clientTracks = new Map<string, MediaStreamTrack[]>();

  // Map of stream IDs to sender addresses received from clients
  // (clients send stream-sender-info for screen share tracks)
  const clientStreamSenderMap = new Map<string, string>();
  const clientStreamScreenNames = new Map<string, string>();

  // First/known VA MediaStream per client. Used so a later screen-share stream
  // (different native stream.id) is NOT mistaken for VA when stream-sender-info
  // is delayed by ASMail reordering.
  const clientVaStreamIds = new Map<string, string>();
  const clientVaStreams = new Map<string, MediaStream>();

  // Tracks that arrived on a new stream.id before stream-sender-info.
  // Key: stream.id
  const pendingClientTracks = new Map<
    string,
    {
      clientAddr: string;
      bufferedAt: number;
      tracks: Array<{ track: MediaStreamTrack; stream: MediaStream }>;
    }
  >();
  const pendingTrackTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  // How many streams were released without ever learning their sender. A growing
  // count means mappings are being lost, which is what makes tiles show up under
  // a UUID instead of an address.
  let discardedPendingStreams = 0;

  // What senderAddr we already applied for a given stream.id (for late-correction).
  const appliedStreamTracks = new Map<
    string,
    { clientAddr: string; senderAddr: string; stream: MediaStream; tracks: MediaStreamTrack[] }
  >();

  // Relay streams for retransmission: one shared MediaStream per source client.
  // Using ONE stream per source guarantees that audio+video tracks of the same
  // participant arrive at receiving clients under the SAME (native) stream.id,
  // which is then mapped to the sender address via 'stream-sender-info'.
  const relayStreams = new Map<string, MediaStream>();

  /**
   * Returns the shared relay stream for a source client, creating it if needed,
   * and ensures the given track is part of it.
   */
  function getOrCreateRelayStream(sourceAddr: string, track: MediaStreamTrack): MediaStream {
    let stream = relayStreams.get(sourceAddr);
    if (!stream) {
      stream = new MediaStream();
      relayStreams.set(sourceAddr, stream);
    }
    // Defensive cleanup: drop dead tracks and stale tracks of the same kind
    // (re-join case) so the relay stream never contains two video/audio
    // tracks or ended tracks from a previous session.
    for (const existing of stream.getTracks()) {
      if (existing !== track && (existing.readyState === 'ended' || existing.kind === track.kind)) {
        stream.removeTrack(existing);
      }
    }
    if (!stream.getTracks().includes(track)) {
      stream.addTrack(track);
    }
    return stream;
  }

  // Proxy streams for screen shares: one cached MediaStream per screen key.
  // Broadcasting the same screen twice (onClientTrackWithSender, then
  // correctMisappliedScreen) used to mint a fresh proxy per call, and every
  // viewer got a second ontrack under a NEW stream.id for the same share -
  // with the previous sender removed, its old stream stayed in the viewer's
  // <video> as a dead one.
  const screenRelayStreams = new Map<string, MediaStream>();

  // Window name per screen addr, so a mapping re-sent by
  // resendAllStreamSenderInfo carries the same title as the original one -
  // without it the viewer's tile would lose its name on a resend.
  const screenAddrNames = new Map<string, string>();

  // One serial SDP queue per client (see createSerialTaskQueue). Kept outside
  // ClientConnection on purpose: it must survive the record swap a re-joining
  // client causes, so the offer that triggers the swap and the one right
  // behind it still cannot overlap.
  const sdpQueues = new Map<string, ReturnType<typeof createSerialTaskQueue>>();

  function sdpQueueFor(clientAddr: string): ReturnType<typeof createSerialTaskQueue> {
    let queue = sdpQueues.get(clientAddr);
    if (!queue) {
      queue = createSerialTaskQueue();
      sdpQueues.set(clientAddr, queue);
    }
    return queue;
  }

  // Newest send time (StarSignalMessage.msgTs) of SDP already processed per
  // client. Deliberately outside ClientConnection: a re-joining client's record
  // is swapped wholesale, and the watermark has to outlive that — otherwise the
  // very reordering that caused the swap would be free to repeat.
  const sdpFreshness = new Map<string, SdpFreshnessGate>();

  // Per client: the peer's clock high-water mark at the moment the pc generation
  // now in use was created. Outside ClientConnection for the same reason as the
  // freshness gate — a re-joining client's record is swapped wholesale.
  const pcGenPeerTsBaseline = new Map<string, number>();

  // Per client: the newest departure stamp already acted upon. Unlike the
  // baseline above it is NOT dropped when the client is removed — a removed
  // client is exactly the one whose remaining copies need recognizing (see
  // isStaleClientDisconnect).
  const departures = createDepartureGate();

  function freshnessGateFor(clientAddr: string): SdpFreshnessGate {
    let gate = sdpFreshness.get(clientAddr);
    if (!gate) {
      gate = createSdpFreshnessGate();
      sdpFreshness.set(clientAddr, gate);
    }
    return gate;
  }

  /**
   * True when this SDP is older than one already processed from that client.
   *
   * ASMail neither orders nor deduplicates: a retried or simply slow offer can
   * land after a newer one. Applying it is never useful — at best a duplicate,
   * at worst its unfamiliar session id reads as "the client recreated its pc"
   * and costs a working connection. Retries carry a fresh stamp, so only
   * genuinely superseded copies are dropped; a client on an older build sends
   * no stamp and keeps the previous behaviour.
   */
  function isStaleClientSdp(clientAddr: string, signal: StarSignalMessage, kind: string): boolean {
    return freshnessGateFor(clientAddr).isStale(
      kind,
      signal.msgTs,
      behindMs => `[Host] Ignoring stale ${kind} from ${clientAddr}: sent ${behindMs}ms `
        + `before the newest one already processed`,
    );
  }

  /**
   * True when a 'disconnect' was sent before the pc now serving this client was
   * built — the client left and came back, and this is a late copy of the
   * departure it has already superseded.
   *
   * A departure rides ASMail with three blind repeats over a minute
   * (TEARDOWN_REPEAT_DELAYS_MILLIS), because a lost 'disconnect' leaves the
   * peer's window open until its 90s watchdog. Those copies were assumed inert
   * on arrival. They are not: on 2026-08-12 a client re-joined inside that
   * minute, a repeat of its own old departure arrived after the re-join offer
   * had been answered, and the host tore the fresh connection down — the client
   * then needed a full reconnect cycle to get back. The repeats have to stay (a
   * peer that missed the original still needs one), so the fix belongs here.
   *
   * Compared against the peer's own clock, never ours: `sentAt` is WebRTCMsg.id,
   * the same field that becomes StarSignalMessage.msgTs, and the baseline is the
   * peer-clock high-water frozen when this pc generation was created — which by
   * then already includes the re-join offer's stamp. A client with no baseline
   * (never connected, or already removed) is not stale, so the ghost-removal
   * path behaves exactly as before; nor is a peer on a build that sends no stamp.
   */
  function isStaleClientDisconnect(clientAddr: string, sentAt: number | undefined): boolean {
    if (sentAt === undefined) {
      return false;
    }
    const baseline = pcGenPeerTsBaseline.get(clientAddr);
    if ((baseline !== undefined) && (sentAt <= baseline)) {
      console.log(
        `[Host] Ignoring stale disconnect from ${clientAddr}: sent ${baseline - sentAt}ms `
        + `before this pc generation was built (the client has since re-joined)`,
      );
      return true;
    }
    // Second gate, for the copies the baseline cannot see. `removeClient` drops
    // the baseline of the client it removes, so from the second copy onward the
    // check above has nothing to compare against and waves every one of them
    // through — the host then re-ran a ghost removal, a 'participant-left'
    // broadcast and an out-of-cycle heartbeat per copy (~10 in the group call of
    // 2026-08-13). The departure watermark survives the removal, which is
    // precisely the difference; it is cleared only in closeAll().
    return departures.isRepeat(clientAddr, sentAt);
  }

  /** Screen counterpart of getOrCreateRelayStream, keyed by the screen addr. */
  function getOrCreateScreenRelayStream(screenAddr: string, track: MediaStreamTrack): MediaStream {
    let stream = screenRelayStreams.get(screenAddr);
    if (!stream) {
      stream = createProxyStreamForScreen(track);
      screenRelayStreams.set(screenAddr, stream);
      return stream;
    }
    for (const existing of stream.getTracks()) {
      if (existing !== track && (existing.readyState === 'ended' || existing.kind === track.kind)) {
        stream.removeTrack(existing);
      }
    }
    if (!stream.getTracks().includes(track)) {
      stream.addTrack(track);
    }
    return stream;
  }

  // ===========================================================================
  // Perfect Negotiation (host side)
  // ===========================================================================
  // Host is the IMPOLITE peer: on an offer collision (glare) it keeps its own
  // offer and IGNORES the colliding offer from a client. The polite client
  // rolls back its own offer and answers the Host's one, so the pair always
  // converges. All host-initiated renegotiation is driven exclusively by the
  // native 'negotiationneeded' event — no manual debounce timers.
  const polite = false;

  // Temporary storage for DataChannel created in createPeerConnectionForClient()
  // before the ClientConnection record is allocated in handleClientOffer().
  // Keyed by RTCPeerConnection, value is the 'streamInfo' RTCDataChannel.
  const tempStreamInfoChannels = new Map<RTCPeerConnection, RTCDataChannel>();
  const tempSignalingChannels = new Map<RTCPeerConnection, RTCDataChannel>();

  /**
   * Sends stream-sender-info to a client via DataChannel (preferred) or ASMail
   * (early fallback).
   *
   * DataChannel is ordered and reliable, so it is the primary path. However,
   * the DC is not open yet right after the initial answer is sent, and the
   * client's ontrack can fire before the DC opens — leading to a 10s timeout
   * waiting for stream-sender-info and a UUID-keyed participant. To avoid that
   * latency, the INITIAL mapping for the host's own stream is also sent via
   * ASMail (fire-and-forget) immediately after the answer, so the client can
   * resolve the host's stream as soon as tracks arrive. The DC onopen handler
   * still re-affirms all mappings once the reliable channel is open, so a lost
   * ASMail mapping is not fatal.
   */
  function sendStreamSenderInfo(
    clientAddr: string,
    streamId: string,
    senderAddr: string,
    screenName?: string,
    opts?: { force?: boolean; mid?: string },
  ): void {
    const clientConn = clients.get(clientAddr);
    if (!clientConn) { return; }

    // A slot's mapping is addressed by mid: its stream id is fixed at
    // negotiation and stays the same however many participants pass through the
    // slot, so the id alone cannot express "this m-line now carries someone
    // else". Absent for ordinary relay, which keeps using streamId.
    const info: StreamSenderInfo = {
      streamId, senderAddr, screenName, ...(opts?.mid ? { mid: opts.mid } : {}),
    };

    if (clientConn.streamInfoChannel && clientConn.streamInfoChannel.readyState === 'open') {
      try {
        clientConn.streamInfoChannel.send(JSON.stringify(info));
        console.log(`[Host] Sent stream-sender-info via DC to ${clientAddr}: ${streamId} -> ${senderAddr}`);
        return;
      } catch (err) {
        console.error(`[Host] Failed to send stream-sender-info via DC to ${clientAddr}:`, err);
      }
    }

    // On the ASMail path the same mapping is produced again and again — on every
    // 'ontrack', every renegotiation, every DC-less resend — and each send used
    // to be its own delivery. Suppress an identical repeat within the window;
    // `force` is for a client that explicitly said it has no mapping
    // ('request-stream-info'), where a suppressed resend would strand it.
    const dedupKey = streamInfoKey(info);
    const sent = sentStreamInfos.get(clientAddr);
    const previous = sent?.get(dedupKey);
    const now = Date.now();
    if (!opts?.force && previous
      && (previous.senderAddr === senderAddr) && (previous.screenName === screenName)
      && ((now - previous.sentAt) < STREAM_INFO_RESEND_MIN_MS)) {
      console.debug(
        `[Host] Skipping duplicate stream-sender-info to ${clientAddr}: `
        + `${dedupKey} -> ${senderAddr} (sent ${now - previous.sentAt}ms ago)`,
      );
      return;
    }
    if (sent) {
      sent.set(dedupKey, { senderAddr, screenName, sentAt: now });
    } else {
      sentStreamInfos.set(clientAddr, new Map([[dedupKey, { senderAddr, screenName, sentAt: now }]]));
    }

    // Batched, not sent one by one: a joining participant produces one mapping
    // per stream it is about to receive, and a delivery each is what the ASMail
    // server answers with HTTP 500. Fire-and-forget as before — the DC onopen
    // handler re-affirms every mapping once the reliable channel is up, so a
    // lost batch is not fatal.
    streamInfoBatcherFor(clientAddr).add(info);
  }

  /**
   * The per-client batcher for ASMail-delivered stream mappings, created on
   * first use. Its send goes through the same signalling call as the single
   * mappings it replaces.
   */
  function streamInfoBatcherFor(clientAddr: string): StreamInfoBatcher {
    const existing = streamInfoBatchers.get(clientAddr);
    if (existing) {
      return existing;
    }
    const batcher = createStreamInfoBatcher(async payload => {
      console.log(
        `[Host] Sent stream-sender-infos batch via ASMail to ${clientAddr}: `
        + `${payload.infos.length} mapping(s)`,
      );
      return await signalingChannel.sendSignalToClient(clientAddr, {
        type: 'stream-sender-infos',
        fromAddr: ownAddr,
        toAddr: clientAddr,
        data: payload,
      }).catch(err => {
        console.error(`[Host] Failed to send stream-sender-infos to ${clientAddr}:`, err);
        return false;
      });
    });
    streamInfoBatchers.set(clientAddr, batcher);
    return batcher;
  }

  /** Drops a client's mapping batcher and dedup memory (recreate / removal). */
  function clearStreamInfoStateFor(clientAddr: string): void {
    streamInfoBatchers.get(clientAddr)?.clear();
    streamInfoBatchers.delete(clientAddr);
    sentStreamInfos.delete(clientAddr);
  }

  /**
   * Forgets that a stream's mapping was ever sent, for every client.
   *
   * Called when the stream stops being relayed (a share ending, a client
   * leaving). Without it the dedup memory outlives the stream, and should the
   * same id come round again within STREAM_INFO_RESEND_MIN_MS its mapping is
   * suppressed as a duplicate — leaving the viewer with a stream it cannot
   * resolve back to a sender.
   */
  function revokeSentStreamInfo(streamId: string | undefined): void {
    if (!streamId) {
      return;
    }
    const key = streamInfoKey({ streamId });
    for (const sent of sentStreamInfos.values()) {
      sent.delete(key);
    }
  }

  /**
   * Re-sends the mappings of every stream this client is receiving.
   *
   * Called on two occasions, and idempotent by design - it merely re-affirms
   * what the client either already has or is still waiting for:
   *
   *  - when the streamInfo DataChannel opens. The FIRST attempt to deliver
   *    these mappings goes out right after the initial answer, before this DC
   *    had a chance to open, and therefore over best-effort ASMail only, where
   *    it can be silently lost;
   *  - when the client asks ('request-stream-info'), which is what it does when
   *    tracks have arrived but their mapping has not.
   *
   * Without either, a lost mapping is never retried and the client permanently
   * identifies that participant by a raw stream UUID - which then fails to
   * match 'stream-state-changed' updates routed by real address, leaving the
   * tile without a name and without a mute-state icon.
   */
  function resendAllStreamSenderInfo(
    clientAddr: string, opts?: { force?: boolean },
  ): void {
    const conn = clients.get(clientAddr);
    if (!conn) {
      return;
    }

    const slots = clientRelaySlots.get(clientAddr) ?? [];
    for (const [sourceAddr, senders] of conn.outgoingTrackSenders.entries()) {
      // Whatever of this source rides a reserved slot is announced by mid: the
      // client resolves a slot's media by m-line, never by the fixed stream id
      // the slot was negotiated with.
      for (const slot of slots) {
        if (slot.owner === sourceAddr) {
          sendStreamSenderInfo(
            clientAddr, slot.stream.id, sourceAddr, screenAddrNames.get(sourceAddr),
            { ...opts, mid: slot.declaration.mid },
          );
        }
      }
      // Screen shares live in screenRelayStreams (one proxy per share), not in
      // relayStreams. Skipping them here left the host without ANY way to
      // re-affirm a screen mapping: neither the DC-open resend nor the client's
      // explicit 'request-stream-info' covered it, so a mapping lost once was
      // lost for the rest of the call - the client kept a screen track it could
      // not attribute, i.e. a tile that never showed the share.
      const onOwnTransceiver = senders.some(sender => !slotOfSender(clientAddr, sender));
      const stream = isScreenShareAddr(sourceAddr)
      ? screenRelayStreams.get(sourceAddr)
      : relayStreams.get(sourceAddr);
      if (onOwnTransceiver && stream) {
        sendStreamSenderInfo(clientAddr, stream.id, sourceAddr, screenAddrNames.get(sourceAddr), opts);
      }
    }
    // The Host's own stream mapping too, for the same reason.
    sendStreamSenderInfo(clientAddr, localStream.id, ownAddr, undefined, opts);
    // Over ASMail these went into the batcher; send them as one message now
    // rather than after the debounce, since the client is waiting on them.
    streamInfoBatchers.get(clientAddr)?.flush();
  }

  let isClosed = false;

  /**
   * Clears and removes the renegotiation retry watcher for a client.
   */
  function clearNegotiationRetry(clientAddr: string): void {
    const watcher = negotiationRetryWatchers.get(clientAddr);
    if (watcher) {
      watcher.clear();
      watcher.resetCounters();
    }
  }

  /**
   * Removes the renegotiation retry watcher entirely (client gone).
   */
  function disposeNegotiationRetry(clientAddr: string): void {
    const watcher = negotiationRetryWatchers.get(clientAddr);
    if (watcher) {
      watcher.clear();
      negotiationRetryWatchers.delete(clientAddr);
    }
  }

  /**
   * Clears the initial-answer retry watcher for a client (a new negotiation
   * cycle started, or the answer evidently arrived).
   */
  function clearAnswerRetry(clientAddr: string): void {
    const watcher = answerRetryWatchers.get(clientAddr);
    if (watcher) {
      watcher.clear();
      watcher.resetCounters();
    }
  }

  /**
   * Removes the initial-answer retry watcher entirely (client gone).
   */
  function disposeAnswerRetry(clientAddr: string): void {
    const watcher = answerRetryWatchers.get(clientAddr);
    if (watcher) {
      watcher.clear();
      answerRetryWatchers.delete(clientAddr);
    }
  }

  /**
   * Resolves an address to the key actually used in `clients`. Addresses
   * arrive from several sources (signal envelopes, the deno-side 'disconnect'
   * relay, the UI) and may differ in case/whitespace — same reconciliation as
   * streams.store's keyFor(). A missed lookup in removeClient() used to
   * cancel the whole removal, the 'participant-left' broadcast included.
   */
  function clientKeyFor(addr: string): string {
    if (clients.has(addr)) {
      return addr;
    }
    try {
      const canon = toCanonicalAddress(addr);
      for (const key of clients.keys()) {
        if (toCanonicalAddress(key) === canon) {
          return key;
        }
      }
    } catch {
      // Not a parseable address — use as-is.
    }
    return addr;
  }

  function clearClientConnectDeadline(clientAddr: string): void {
    const timer = connectDeadlineTimers.get(clientAddr);
    if (timer !== undefined) {
      clearTimeout(timer);
      connectDeadlineTimers.delete(clientAddr);
    }
  }

  /**
   * (Re)arms the "never connected" deadline for a client. Clear-then-set, so
   * a client cycling through re-joins holds exactly one timer, counted from
   * its latest sign of life.
   */
  function armClientConnectDeadline(clientAddr: string): void {
    clearClientConnectDeadline(clientAddr);
    if (isClosed) {
      return;
    }
    if (clients.get(clientAddr)?.peerConnection.connectionState === 'connected') {
      return;
    }
    const timer = setTimeout(() => {
      connectDeadlineTimers.delete(clientAddr);
      if (isClosed) {
        return;
      }
      const conn = clients.get(clientAddr);
      if (conn?.peerConnection.connectionState === 'connected') {
        return;
      }
      console.warn(
        `[Host] Client ${clientAddr} never connected within ${CLIENT_CONNECT_TIMEOUT_MS}ms — removing`,
      );
      void removeClient(clientAddr, { notifyDropped: true });
    }, CLIENT_CONNECT_TIMEOUT_MS);
    connectDeadlineTimers.set(clientAddr, timer);
  }

  /**
   * Cancels a pending "still reconnecting" hint timer for a client, if any.
   */
  function clearReconnectHintTimer(clientAddr: string): void {
    const timer = reconnectHintTimers.get(clientAddr);
    if (timer !== undefined) {
      clearTimeout(timer);
      reconnectHintTimers.delete(clientAddr);
    }
  }

  /**
   * Reports a client's transient link status to the host's own UI and, via
   * broadcast, to all other clients — who cannot see that client's
   * RTCPeerConnection directly and would otherwise learn about the link
   * loss only once DISCONNECT_GRACE_MILLIS elapses and the tile disappears.
   *
   * `kind` is what keeps the receiving side from having to guess which of the
   * signal's two meanings this is (see ParticipantReconnectingInfo): the guess
   * it used to make put a "reconnecting" blur over the live video of peers who
   * had just joined.
   */
  function sendReconnectHint(
    clientAddr: string, reconnecting: boolean,
    kind: NonNullable<ParticipantReconnectingInfo['kind']>,
  ): void {
    onParticipantReconnecting?.(clientAddr, reconnecting, kind);
    void signalingChannel
      .broadcastSignal(
        {
          type: 'participant-reconnecting',
          fromAddr: ownAddr,
          data: { addr: clientAddr, reconnecting, kind },
        },
        clientAddr,
      )
      .catch(err => {
        console.error(`[Host] Failed to broadcast participant-reconnecting for ${clientAddr}:`, err);
      });
  }

  /**
   * A client announced it is re-joining, ahead of its SDP offer.
   *
   * The offer used to be the first and only thing that said so, and it is the
   * largest message in the protocol: in the group call of 2026-08-13 the other
   * participants waited 50s with nothing on screen between the returning peer
   * pressing "Join Call" and its tile appearing. The notice costs ~250 B on the
   * same ASMail path; from here on the hop is a DataChannel one, i.e.
   * milliseconds, because the links to everyone still in the call are live.
   *
   * No new UI state: this is the same 'participant-reconnecting' a link blip
   * sends, and the receiving side now creates the tile when the participant it
   * names is absent (see participantTileOnRejoinNotice).
   */
  function announceRejoiningPeer(rawClientAddr: string): void {
    // This address comes off an ASMail envelope, by way of the background, and
    // the connection it refers to was keyed from the roster: they differ in
    // case often enough that a raw lookup would read a connected client as
    // absent and announce a return for someone already in the call. Normalized
    // once here, so the bookkeeping below shares its key with every other place
    // that cancels an announcement.
    const clientAddr = clientKeyFor(rawClientAddr);
    const conn = clients.get(clientAddr);
    const action = rejoinNoticeAction({
      callIsClosed: isClosed,
      isConnected: !!conn?.connectedAt,
    });
    if (action !== 'announce') {
      console.log(`[Host] Re-join notice from ${clientAddr}: ${action}`);
      return;
    }

    console.log(`[Host] ${clientAddr} is re-joining — telling the other participants`);
    // Repeats re-announce rather than being dropped (see rejoinNoticeAction).
    // Cleared first so the expiry below replaces the standing one instead of
    // running beside it.
    clearRejoinNotice(clientAddr);
    rejoinAnnounced.add(clientAddr);
    sendReconnectHint(clientAddr, true, 'rejoin');

    // The notice promises nothing: the peer may close its window again, and its
    // offer may never arrive. Without this the "connecting…" it just put up
    // stands for the rest of the call.
    const timer = setTimeout(() => {
      rejoinNoticeTimers.delete(clientAddr);
      const expiry = rejoinNoticeExpiry({
        callIsClosed: isClosed,
        isConnected: !!clients.get(clientAddr)?.connectedAt,
        stillAnnounced: rejoinAnnounced.delete(clientAddr),
      });
      if (expiry !== 'withdraw') {
        return;
      }
      console.warn(
        `[Host] ${clientAddr} announced a re-join ${REJOIN_NOTICE_TTL_MS}ms ago and never `
          + `arrived — taking its placeholder down`,
      );
      // 'rejoin', not 'link-blip': this withdraws an announced return, and only
      // that kind may take a placeholder tile off the other participants'
      // screens.
      sendReconnectHint(clientAddr, false, 'rejoin');
    }, REJOIN_NOTICE_TTL_MS);
    rejoinNoticeTimers.set(clientAddr, timer);
  }

  /**
   * Forgets a standing re-join announcement WITHOUT withdrawing it.
   *
   * Called wherever the announcement has been overtaken by events: the peer
   * arrived (its own join path owns the tile from then on, and a withdrawal
   * would remove it just before its tracks land), or it is being removed
   * outright (a 'participant-left' broadcast does the taking-down). Only the
   * expiry above ever withdraws.
   */
  function clearRejoinNotice(clientAddr: string): void {
    const timer = rejoinNoticeTimers.get(clientAddr);
    if (timer !== undefined) {
      clearTimeout(timer);
      rejoinNoticeTimers.delete(clientAddr);
    }
    rejoinAnnounced.delete(clientAddr);
  }

  /**
   * What a `Scheduling retry N/M` line for this client is actually about.
   *
   * Without it the log cannot tell a client that is still joining from a
   * mid-call renegotiation (a screen share, above all): both print the same
   * line, and the group-call log of 2026-08-13 was unreadable for exactly that
   * reason.
   *
   * `pc.currentRemoteDescription === null` is the discriminator on the CLIENT,
   * which offers first — but not here: the host applies the client's offer
   * before its very first answer goes out, so on this side that field is
   * non-null from the start and would label every leg 'renegotiation' (observed
   * in the 2026-08-13 run). What does hold on the host is whether this
   * connection ever reached 'connected'.
   */
  function describePcLeg(clientAddr: string): string {
    const conn = clients.get(clientAddr);
    const pc = conn?.peerConnection;
    if (!conn || !pc) {
      return 'no connection';
    }
    const leg = conn.connectedAt ? 'mid-call' : 'joining';
    const dc = conn.signalingDataChannel?.readyState ?? 'none';
    return `leg=${leg} signalingState=${pc.signalingState} `
      + `connectionState=${pc.connectionState} iceState=${pc.iceConnectionState} sigDc=${dc}`;
  }

  /**
   * Returns (or creates) the renegotiation retry watcher for a client.
   * Replaces the old scheduleNegotiationRetry / clearNegotiationRetry pair.
   */
  function getNegotiationRetryWatcher(clientAddr: string): ReturnType<typeof createRetryWatcher> {
    let watcher = negotiationRetryWatchers.get(clientAddr);
    if (watcher) {
      return watcher;
    }

    watcher = createRetryWatcher({
      label: `[Host -> ${clientAddr}]`,
      maxRetries: MAX_NEGOTIATION_RETRIES,
      retryDelays: NEGOTIATION_RETRY_DELAYS,
      maxFastRetries: MAX_NEGOTIATION_FAST_RETRIES,
      fastRetryDelay: NEGOTIATION_FAST_RETRY_DELAY,
      shouldSkip: () => {
        if (isClosed) { return true; }
        const conn = clients.get(clientAddr);
        if (!conn) { return true; }
        // Answer already arrived (state back to 'stable') — nothing to retry.
        // An open signaling DC is deliberately NOT a reason to skip: the DC
        // guarantees delivery of the offer, not that an answer comes back.
        // An answer dropped as uncorrelated ('superseded offer') used to leave
        // the host parked in have-local-offer forever, with the just-added
        // sender (e.g. the host's own screen share) never activated — the
        // client showed the tile it had negotiated and no picture. Retries do
        // still ride the DC: sendSignalToClient() prefers it, so a retry with
        // the DC up is a cheap local send, not ASMail traffic.
        return conn.peerConnection.signalingState !== 'have-local-offer';
      },
      retry: async () => {
        const conn = clients.get(clientAddr);
        if (!conn) { return true; }
        const desc = conn.peerConnection.localDescription;
        if (!desc) { return true; }
        console.log(`[Host] Retrying renegotiation offer to ${clientAddr}`);
        return await signalingChannel.sendSignalToClient(clientAddr, {
          type: 'offer',
          fromAddr: ownAddr,
          toAddr: clientAddr,
          data: desc.toJSON(),
        });
      },
      onExhausted: () => {
        const conn = clients.get(clientAddr);
        if (!conn || isClosed) { return; }
        // No recreate here: unanswered retries mean slow delivery far more
        // often than a dead peer, and recreating orphans the client's
        // in-flight answer (cross-generation glare, 2026-08-11 revision).
        // A truly gone client is caught by the honest link signals — the
        // 120s connect deadline and the disconnect grace path — both of
        // which end in removeClient({notifyDropped}).
        console.warn(
          `[Host] Renegotiation offer to ${clientAddr} unanswered after ${MAX_NEGOTIATION_RETRIES} retries; leaving recovery to the connect deadline / grace path`,
        );
      },
      describeState: () => describePcLeg(clientAddr),
    });

    negotiationRetryWatchers.set(clientAddr, watcher);
    return watcher;
  }

  /**
   * Returns (or creates) the retry watcher for the initial SDP answer.
   * Mirrors getNegotiationRetryWatcher(), but for the answer leg: the client
   * cannot proceed without it, and before this watcher a lost answer was
   * recovered only by the client re-sending its offer.
   */
  function getAnswerRetryWatcher(clientAddr: string): ReturnType<typeof createRetryWatcher> {
    let watcher = answerRetryWatchers.get(clientAddr);
    if (watcher) {
      return watcher;
    }

    watcher = createRetryWatcher({
      label: `[Host answer -> ${clientAddr}]`,
      maxRetries: MAX_ANSWER_RETRIES,
      retryDelays: ANSWER_RETRY_DELAYS,
      maxFastRetries: MAX_ANSWER_FAST_RETRIES,
      fastRetryDelay: ANSWER_FAST_RETRY_DELAY,
      shouldSkip: () => {
        if (isClosed) { return true; }
        const conn = clients.get(clientAddr);
        if (!conn) { return true; }
        const pc = conn.peerConnection;
        // The client evidently received the answer: media/ICE went through,
        // or the low-latency signaling DC (opened by that very connection)
        // is up and any resend would ride it pointlessly.
        if (pc.connectionState === 'connected') { return true; }
        if (conn.signalingDataChannel && conn.signalingDataChannel.readyState === 'open') {
          return true;
        }
        // A renegotiation started (or a new offer replaced this cycle) —
        // the recorded answer is no longer the current local description.
        return pc.signalingState !== 'stable' || pc.localDescription?.type !== 'answer';
      },
      retry: async () => {
        const conn = clients.get(clientAddr);
        if (!conn) { return true; }
        const desc = conn.peerConnection.localDescription;
        if (!desc || desc.type !== 'answer') { return true; }
        console.log(`[Host] Retrying SDP answer to ${clientAddr}`);
        // Stamped, not gated: this watcher has one slow retry in its whole
        // budget, so suppressing it would spend the recovery rather than a
        // duplicate. What the stamp does is keep the NEXT duplicate-offer
        // response from doubling up on this send.
        noteAnswerSend(clientAddr);
        const answerTo = conn.lastAppliedOfferOrigin ?? undefined;
        return await signalingChannel.sendAnswerToClient(clientAddr, {
          type: desc.type,
          sdp: desc.sdp,
          ...(answerTo ? { answerTo } : {}),
        });
      },
      onExhausted: () => {
        // No recreate here: the client's own offer retry watcher is the
        // stronger recovery path and is still running on its side.
        console.warn(
          `[Host] SDP answer to ${clientAddr} still unconfirmed after ${MAX_ANSWER_RETRIES} retries; leaving recovery to the client's offer retry`,
        );
      },
      describeState: () => describePcLeg(clientAddr),
    });

    answerRetryWatchers.set(clientAddr, watcher);
    return watcher;
  }

  /**
   * Records that an answer is going out to a client and, for a RE-send, says
   * whether it may go at all.
   *
   * An initial answer (no `resendReason`) is never suppressed - it is the one the
   * client cannot proceed without. A re-send is suppressed while an answer sent
   * moments ago is still in flight; see ANSWER_RESEND_MIN_INTERVAL_MILLIS.
   */
  function noteAnswerSend(clientAddr: string, resendReason?: string): boolean {
    const conn = clients.get(clientAddr);
    const now = Date.now();
    const lastSentAt = conn?.lastAnswerSentAt;
    if (resendReason && (lastSentAt !== undefined)) {
      const sinceMs = now - lastSentAt;
      if (sinceMs < ANSWER_RESEND_MIN_INTERVAL_MILLIS) {
        console.log(
          `[Host] Skipping ${resendReason} to ${clientAddr}: an answer went out `
          + `${sinceMs}ms ago and is still in flight`,
        );
        return false;
      }
    }
    if (conn) {
      conn.lastAnswerSentAt = now;
    }
    return true;
  }

  /**
   * Sends an SDP answer without blocking the caller on ASMail delivery
   * confirmation: confirmation is only a retry trigger, not a precondition
   * for any local work. An unconfirmed (or failed) send arms the answer
   * retry watcher.
   */
  function sendAnswerInBackground(
    clientAddr: string, answer: RTCSessionDescriptionInit,
    opts?: { armRetryWatcher?: boolean; resend?: boolean },
  ): void {
    const armRetryWatcher = opts?.armRetryWatcher ?? true;
    if (!noteAnswerSend(
      clientAddr, opts?.resend ? 'answer resend on a duplicate offer' : undefined,
    )) {
      return;
    }
    // Correlate the answer with the offer it answers (see AnswerToRef): the
    // applied offer's origin is what handleClientOffer recorded.
    const answerTo = clients.get(clientAddr)?.lastAppliedOfferOrigin ?? undefined;
    signalingChannel.sendAnswerToClient(
      clientAddr, { ...answer, ...(answerTo ? { answerTo } : {}) },
    ).then(delivered => {
      console.log(`[Host] SDP Answer to ${clientAddr} not reported failed: ${delivered}`);
      if (armRetryWatcher) {
        getAnswerRetryWatcher(clientAddr).schedule(!delivered);
      }
    }).catch(err => {
      console.error(`[Host] Failed to send SDP answer to ${clientAddr}:`, err);
      if (armRetryWatcher) {
        getAnswerRetryWatcher(clientAddr).schedule(true);
      }
    });
  }

  /**
   * Perfect Negotiation core (host side): creates the local description
   * (offer) and sends it to the given client. Called from the native
   * 'negotiationneeded' event, after explicit relay-track adds, and after
   * connection recreate.
   *
   * Also arms a retry watchdog because, unlike a purely in-process negotiation,
   * the offer/answer round-trips over ASMail delivery and can be silently lost.
   */
  async function negotiateWithClient(clientAddr: string): Promise<void> {
    const clientConn = clients.get(clientAddr);
    if (!clientConn || isClosed) {
      return;
    }

    const { peerConnection: pc } = clientConn;

    // If a negotiation is already in flight, the queued 'negotiationneeded'
    // event will fire again once we return to 'stable'. Explicit schedule
    // below also re-queues via microtask when state is not yet stable.
    if (pc.signalingState !== 'stable' || clientConn.makingOffer) {
      return;
    }

    // Fresh negotiation cycle starting — reset retry bookkeeping. The initial
    // answer's watcher is obsolete too: the local description is about to
    // become an offer.
    clearNegotiationRetry(clientAddr);
    clearAnswerRetry(clientAddr);
    // Everything added to the pc up to setLocalDescription below travels in THIS
    // offer, so any request still waiting on the gate has been served. Without
    // this, an ungated path (recreate, ICE restart) leaves the entry behind and
    // it emits a duplicate offer once the client connects.
    clearPendingNegotiate(clientAddr);

    try {
      clientConn.makingOffer = true;
      console.log(`[Host] Creating renegotiation offer for ${clientAddr}`);
      // Ensure codec prefs cover any transceiver added since PC creation
      // (relay / screen) before SDP is generated — avoids BUNDLE PT collisions.
      applyCodecPreferences(pc, `Host -> Client ${clientAddr} (renegotiate)`);
      await pc.setLocalDescription();
      const desc = pc.localDescription;
      if (desc) {
        // Age of the offer in flight — read by the ICE-restart recovery to tell
        // "answer still travelling over ASMail" from "answer lost".
        clientConn.lastOfferSentAt = Date.now();
        // Re-apply video bitrate limits and simulcast layer selection after renegotiation
        applyBitrateToAllSenders(pc, videoQuality).catch(() => {});
        applySimulcastLayers(pc, participantCount).catch(() => {});
        // Arm the watchdog from the moment of sending, in case the Answer
        // never arrives (ASMail loss); shouldSkip() disarms it the moment
        // the answer is applied.
        const watcher = getNegotiationRetryWatcher(clientAddr);
        watcher.schedule();
        // The send itself goes to the background: awaiting its delivery
        // confirmation (up to 12s over ASMail) would keep makingOffer=true
        // all that time, and the impolite host discards every client offer
        // in that window as a false collision. makingOffer must only guard
        // the local SDP work; real glare is still caught by signalingState.
        signalingChannel.sendSignalToClient(clientAddr, {
          type: 'offer',
          fromAddr: ownAddr,
          toAddr: clientAddr,
          data: desc.toJSON(),
        }).then(delivered => {
          console.log(`[Host] Renegotiation offer sent to ${clientAddr} (not reported failed: ${delivered})`);
          if (!delivered) {
            watcher.schedule(true);
          }
        }).catch(err => {
          console.error(`[Host] Failed to send renegotiation offer to ${clientAddr}:`, err);
          watcher.schedule(true);
        });
      }
    } catch (err) {
      console.error(`[Host] Failed to negotiate with ${clientAddr}:`, err);
    } finally {
      clientConn.makingOffer = false;
    }
  }

  /**
   * Explicit renegotiation after addTransceiver for SFU relay tracks.
   * Native onnegotiationneeded is unreliable in some Electron/Chromium
   * paths after answer + batch addTransceiver; do not rely on it alone.
   * Debounces multiple adds (e.g. a source's audio and video tracks arriving
   * as separate 'ontrack' events) into a single offer.
   *
   * The entry lives until the renegotiation actually runs. While the pc is
   * away from 'stable' — which lasts as long as an offer/answer ASMail
   * round-trip, 10-30s — execution waits on 'signalingstatechange' instead
   * of polling, with a safety-net re-check for a missed event. There is no
   * "give up": a schedule request is only dropped with its client. Repeated
   * requests while an entry is pending just add their reason: the offer is
   * built from the pc's state at execution time, so every transceiver added
   * meanwhile is covered by the one offer.
   */
  const pendingNegotiate = new Map<string, {
    reasons: string[];
    attach?: Array<{ target: RTCPeerConnection; type: string; listener: () => void }>;
    timer?: ReturnType<typeof setTimeout>;
    /** When the request was first made; bounds the wait for 'connected'. */
    startedAt: number;
    /** When the wait for the signaling DataChannel runs out; set once connected. */
    dcDeadlineAt?: number;
  }>();

  /** Drops a pending explicit renegotiation, detaching its listeners/timer. */
  function clearPendingNegotiate(clientAddr: string): void {
    const entry = pendingNegotiate.get(clientAddr);
    if (!entry) {
      return;
    }
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
    }
    entry.attach?.forEach(({ target, type, listener }) => {
      target.removeEventListener(type, listener);
    });
    pendingNegotiate.delete(clientAddr);
  }

  function scheduleNegotiateWithClient(clientAddr: string, reason: string): void {
    if (isClosed || !clients.has(clientAddr)) {
      return;
    }
    const existing = pendingNegotiate.get(clientAddr);
    if (existing) {
      // Deduplicated and capped: while the gate below holds a request back the
      // entry can live for a minute, and every relayed track asks again.
      if (!existing.reasons.includes(reason) && (existing.reasons.length < 20)) {
        existing.reasons.push(reason);
      }
      return;
    }
    const entry: NonNullable<ReturnType<typeof pendingNegotiate.get>> = {
      reasons: [reason],
      startedAt: Date.now(),
    };
    pendingNegotiate.set(clientAddr, entry);
    console.log(`[Host] Scheduling explicit renegotiation for ${clientAddr} (${reason})`);
    // Debounce past the current answer/setLocalDescription turn so a
    // source's audio and video tracks land in the same offer.
    entry.timer = setTimeout(() => attemptExplicitNegotiate(clientAddr), NEGOTIATE_DEBOUNCE_MS);
  }

  /** Re-arms an entry's wait on a pc event plus a safety-net re-check. */
  function waitForNegotiateWakeUp(
    entry: NonNullable<ReturnType<typeof pendingNegotiate.get>>,
    clientAddr: string,
    pc: RTCPeerConnection,
    eventTypes: string[],
    safetyDelayMs: number,
  ): void {
    const listener = () => attemptExplicitNegotiate(clientAddr);
    entry.attach = eventTypes.map(type => {
      pc.addEventListener(type, listener);
      return { target: pc, type, listener };
    });
    entry.timer = setTimeout(() => attemptExplicitNegotiate(clientAddr), safetyDelayMs);
  }

  function attemptExplicitNegotiate(clientAddr: string): void {
    const entry = pendingNegotiate.get(clientAddr);
    if (!entry) {
      return;
    }
    // Detach the wake-up sources; they are re-armed below if still needed.
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    if (entry.attach) {
      entry.attach.forEach(({ target, type, listener }) => {
        target.removeEventListener(type, listener);
      });
      entry.attach = undefined;
    }
    if (isClosed || !clients.has(clientAddr)) {
      pendingNegotiate.delete(clientAddr);
      return;
    }
    const conn = clients.get(clientAddr)!;
    const pc = conn.peerConnection;
    const pcState = pc.connectionState;
    if ((pcState === 'closed') || (pcState === 'failed')) {
      // The request belonged to a generation that is over; a recreate or a
      // re-join will bring its own.
      clearPendingNegotiate(clientAddr);
      return;
    }
    // The gate. Offering to a client whose own first negotiation is still in
    // flight is what tore down the group call of 2026-08-12: over a 7-15s ASMail
    // hop our offer arrives while the client sits in 'have-local-offer', the
    // polite client rolls its offer back, and an already ICE-connected transport
    // goes back to 'new' and never recovers. Nothing here is urgent enough to
    // race that — relayed media is useless until the peer is connected anyway.
    if (pcState !== 'connected') {
      const waited = Date.now() - entry.startedAt;
      if (waited < NEGOTIATE_WAIT_CONNECTED_MAX_MS) {
        waitForNegotiateWakeUp(
          entry, clientAddr, pc,
          ['connectionstatechange', 'signalingstatechange'],
          NEGOTIATE_STABLE_SAFETY_MS,
        );
        return;
      }
      console.warn(
        `[Host] Offering to ${clientAddr} after waiting ${waited}ms for it to connect `
        + `(state: ${pcState}); its own negotiation may have been lost`,
      );
    } else if (conn.signalingDataChannel?.readyState !== 'open') {
      // Connected, but the low-latency path has not come up yet. Waiting a
      // moment for it turns this round trip from ~30s into milliseconds; not
      // waiting forever, because a DataChannel that never opens must not strand
      // the relay.
      entry.dcDeadlineAt ??= Date.now() + NEGOTIATE_WAIT_DC_MS;
      const remaining = entry.dcDeadlineAt - Date.now();
      if (remaining > 0) {
        waitForNegotiateWakeUp(entry, clientAddr, pc, ['connectionstatechange'], remaining);
        return;
      }
      console.log(
        `[Host] Signaling DC to ${clientAddr} did not open within ${NEGOTIATE_WAIT_DC_MS}ms; `
        + `renegotiating over ASMail`,
      );
    }
    if (pc.signalingState !== 'stable' || conn.makingOffer) {
      waitForNegotiateWakeUp(
        entry, clientAddr, pc, ['signalingstatechange'], NEGOTIATE_STABLE_SAFETY_MS,
      );
      return;
    }
    const reasons = entry.reasons.join('; ');
    pendingNegotiate.delete(clientAddr);
    console.log(`[Host] Executing explicit renegotiation for ${clientAddr} (${reasons})`);
    negotiateWithClient(clientAddr).catch(err => {
      console.error(`[Host] Explicit renegotiation failed for ${clientAddr}:`, err);
    });
  }

  /**
   * Adds a sendonly transceiver for SFU relay.
   * Codec preferences are applied in negotiateWithClient() immediately before
   * setLocalDescription so new m-lines do not introduce BUNDLE PT collisions.
   */
  function addRelayTransceiver(
    pc: RTCPeerConnection,
    track: MediaStreamTrack,
    proxyStream: MediaStream,
    label: string,
  ): RTCRtpTransceiver {
    // Always a fresh transceiver, never one recycled in-process. Handing a new
    // track to a transceiver the viewer is already receiving on changes only
    // the msid: the receiving direction never breaks, so no new ontrack fires
    // there and the viewer keeps resolving the share under the previous
    // stream id, while stream-sender-info announces the new one. Rejected
    // m-lines (see stopRelaySender) are recycled by the browser itself once
    // the stop has been negotiated, so SDP still does not grow without bound.
    console.log(`[Host] ${label}: adding a ${track.kind} transceiver`);
    return pc.addTransceiver(track, {
      direction: 'sendonly',
      streams: [proxyStream],
    });
  }

  /**
   * Stops forwarding `sender`'s track and retires its transceiver.
   *
   * Used at every point where a relayed track goes away (a participant
   * leaving, a re-join replacing stale senders, a screen share stopping).
   * stop() rather than a bare removeTrack(): removeTrack only nulls the
   * sender's track, leaving the m-line in place for the lifetime of the pc, so
   * a call that saw participants join, leave and share their screens kept
   * growing its SDP (observed 3 -> 24 m-lines in one group call). A stopped
   * transceiver's m-line is rejected on the next negotiation and its slot
   * becomes reusable by the browser, which also gives the viewer a clean
   * end-of-track instead of a silently re-pointed one.
   *
   * A reserved relay slot is the one thing this must NOT do: stopping it needs
   * a renegotiation (the very thing slots exist to avoid) and loses the m-line
   * for good, since only the client can offer a new one. Such a sender is
   * merely emptied, and its slot goes back into the free pool.
   */
  function stopRelaySender(conn: ClientConnection, sender: RTCRtpSender): void {
    const slot = slotOfSender(conn.clientAddr, sender);
    if (slot) {
      releaseSlot(slot);
      return;
    }
    try {
      const transceiver = conn.peerConnection.getTransceivers().find(tr => tr.sender === sender);
      if (transceiver) {
        transceiver.stop();
      } else {
        conn.peerConnection.removeTrack(sender);
      }
    } catch {
      // A closed pc, or a sender it no longer owns: nothing left to retire.
    }
  }

  // ===========================================================================
  // Reserved relay slots (host side)
  // ===========================================================================
  // A slot is an m-line the client offered as `recvonly` purely so the host can
  // negotiate it as a sender NOW, while it still has nothing to send there.
  // Filling it later is a replaceTrack() — no offer, no answer, no glare. That
  // is what lets a participant join a group call without the host re-offering to
  // everyone already in it: over a 7-15s ASMail hop such a re-offer met the
  // joiners' own unfinished negotiation, and the polite rollback took an
  // already ICE-connected transport back to 'new' (group call of 2026-08-12).

  /** A slot as the host holds it: the client's declaration plus its m-line. */
  interface HostRelaySlot extends SlotState<RTCRtpTransceiver> {
    /**
     * The (empty) MediaStream this slot was negotiated with. Its id is the msid
     * on the wire and never changes, whoever ends up in the slot — which is
     * exactly why mappings for slots must be addressed by mid, not by stream id.
     */
    stream: MediaStream;
  }

  /**
   * Slots per client. Deliberately outside ClientConnection: nothing here
   * survives the pc it belongs to, so every path that replaces a pc drops the
   * entry wholesale rather than carrying stale transceivers into a new one.
   */
  const clientRelaySlots = new Map<string, HostRelaySlot[]>();

  // One placeholder track per kind for the whole channel, created on first use.
  // It exists for a single purpose: to be attached while the answer is being
  // created, so the slot's m-section carries an msid and an ssrc. Media
  // arriving later is then attributable without relying on unsignalled SSRCs.
  // Emptied again right after setLocalDescription, so no junk RTP ever flows.
  /**
   * Relayed audio has to be re-sourced locally before a slot can carry it: a
   * remote audio track given to replaceTrack() sends nothing at all. See
   * createAudioRelayBridge for the measurements this rests on.
   */
  // Just the role: the logger already prefixes every line with this user's address.
  const audioRelayBridge = createAudioRelayBridge('Host');

  let placeholderVideoTrack: MediaStreamTrack | null = null;
  let placeholderAudioTrack: MediaStreamTrack | null = null;
  let placeholderAudioCtx: AudioContext | null = null;

  function placeholderTrackOf(kind: 'audio' | 'video'): MediaStreamTrack | null {
    try {
      if (kind === 'video') {
        if (!placeholderVideoTrack || (placeholderVideoTrack.readyState === 'ended')) {
          const canvas = document.createElement('canvas');
          canvas.width = 2;
          canvas.height = 2;
          canvas.getContext('2d')?.fillRect(0, 0, 2, 2);
          placeholderVideoTrack = canvas.captureStream(1).getVideoTracks()[0] ?? null;
        }
        return placeholderVideoTrack;
      }
      if (!placeholderAudioTrack || (placeholderAudioTrack.readyState === 'ended')) {
        placeholderAudioCtx = placeholderAudioCtx ?? new AudioContext();
        placeholderAudioTrack = placeholderAudioCtx.createMediaStreamDestination()
        .stream.getAudioTracks()[0] ?? null;
      }
      return placeholderAudioTrack;
    } catch (err) {
      log.warn(`could not create a ${kind} slot placeholder`, err);
      return null;
    }
  }

  function disposePlaceholders(): void {
    placeholderVideoTrack?.stop();
    placeholderAudioTrack?.stop();
    placeholderVideoTrack = null;
    placeholderAudioTrack = null;
    void placeholderAudioCtx?.close().catch(() => {});
    placeholderAudioCtx = null;
  }

  /** The slot a sender belongs to, if the sender is a slot's at all. */
  function slotOfSender(clientAddr: string, sender: RTCRtpSender): HostRelaySlot | undefined {
    return clientRelaySlots.get(clientAddr)?.find(slot => slot.handle.sender === sender);
  }

  /** Empties a slot but keeps it: `declaration.forAddr` earns a re-join its old m-line. */
  function releaseSlot(slot: HostRelaySlot): void {
    slot.owner = null;
    slot.handle.sender.replaceTrack(null).catch(() => {
      // A closed pc: the whole registry is about to be dropped anyway.
    });
  }

  /** Empties every slot currently relaying `ownerKey` (a leaver, a stopped share). */
  function releaseSlotsFor(clientAddr: string, ownerKey: string): void {
    for (const slot of clientRelaySlots.get(clientAddr) ?? []) {
      if (slot.owner === ownerKey) {
        releaseSlot(slot);
      }
    }
  }

  /**
   * Turns the slots a client declared in its offer into sending m-lines.
   *
   * Called strictly between setRemoteDescription and createAnswer: the direction
   * has to be 'sendonly' BEFORE the answer is generated, or the intersection of
   * two receiving directions makes the m-line 'inactive' and the slot is born
   * dead.
   *
   * Three refusals, each guarding against silencing something real:
   *  - the SDP must actually state `a=recvonly` for that mid. A transceiver the
   *    browser created from a remote offer looks identical for "a slot for us"
   *    and "the peer's own camera" (`direction === 'recvonly'`,
   *    `currentDirection === null`), so a mistaken declaration would otherwise
   *    mute that client for the life of the connection;
   *  - the m-line must not already be sending. The host's own camera and mic
   *    pair with the client's receiving m-lines during setRemoteDescription, and
   *    those are `recvonly` in the offer too;
   *  - the kind must match what was declared, or replaceTrack could never work.
   */
  function claimRelaySlots(conn: ClientConnection, offer: RTCSessionDescriptionInit): void {
    const declarations = (offer as OfferSignalPayload).relaySlots;
    if (!declarations || (declarations.length === 0)) {
      return;
    }
    const { clientAddr, peerConnection: pc } = conn;
    const directions = sdpDirectionsByMid(offer.sdp);
    let slots = clientRelaySlots.get(clientAddr);
    if (!slots) {
      slots = [];
      clientRelaySlots.set(clientAddr, slots);
    }
    const byMid = new Map<string, RTCRtpTransceiver>();
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.mid) {
        byMid.set(transceiver.mid, transceiver);
      }
    }
    let claimed = 0;
    for (const declaration of declarations) {
      const { mid, kind } = declaration;
      const existing = slots.find(slot => slot.declaration.mid === mid);
      if (existing) {
        // Every offer re-states all slots, so a re-offer (a screen share going
        // up, say) lands here for the ones already claimed. Only the hint can
        // have changed; the m-line itself is already ours.
        existing.declaration = declaration;
        continue;
      }
      const transceiver = byMid.get(mid);
      if (!transceiver) {
        log.warn(`client ${clientAddr} declared relay slot ${mid} with no such m-line`);
        continue;
      }
      if (directions.get(mid) !== 'recvonly') {
        log.warn(
          `refusing relay slot ${mid} of ${clientAddr}: its m-line is `
          + `'${directions.get(mid) ?? 'unknown'}', not 'recvonly'`,
        );
        continue;
      }
      if (transceiver.sender.track) {
        log.warn(
          `refusing relay slot ${mid} of ${clientAddr}: that m-line already sends media`,
        );
        continue;
      }
      if (transceiver.receiver.track && (transceiver.receiver.track.kind !== kind)) {
        log.warn(
          `refusing relay slot ${mid} of ${clientAddr}: declared ${kind}, `
          + `m-line is ${transceiver.receiver.track.kind}`,
        );
        continue;
      }
      try {
        transceiver.direction = 'sendonly';
      } catch (err) {
        log.warn(`could not turn slot ${mid} of ${clientAddr} into a sender`, err);
        continue;
      }
      slots.push({ declaration, owner: null, handle: transceiver, stream: new MediaStream() });
      claimed += 1;
    }
    if (claimed > 0) {
      console.log(
        `[Host] Claimed ${claimed} relay slot(s) of ${clientAddr} `
        + `(${slots.length} in total on this connection)`,
      );
    }
  }

  /**
   * Attaches the placeholder to every empty slot, right before the answer is
   * created. See placeholderTrackOf: this is what puts msid/ssrc for the slot
   * into the SDP.
   */
  async function armEmptyRelaySlots(clientAddr: string): Promise<void> {
    for (const slot of clientRelaySlots.get(clientAddr) ?? []) {
      if (slot.owner) {
        continue;
      }
      const placeholder = placeholderTrackOf(slot.declaration.kind);
      if (!placeholder) {
        continue;
      }
      try {
        await slot.handle.sender.replaceTrack(placeholder);
        slot.handle.sender.setStreams(slot.stream);
      } catch (err) {
        log.warn(`could not arm relay slot ${slot.declaration.mid} of ${clientAddr}`, err);
      }
    }
  }

  /** Empties the placeholders again once the answer is set: no junk RTP. */
  async function silenceEmptyRelaySlots(clientAddr: string): Promise<void> {
    for (const slot of clientRelaySlots.get(clientAddr) ?? []) {
      if (slot.owner) {
        continue;
      }
      try {
        await slot.handle.sender.replaceTrack(null);
      } catch {
        // Nothing to silence on a pc that is already gone.
      }
    }
  }

  /**
   * Puts a track into one of this client's free slots, if there is a fitting
   * one. Returns what the caller needs to record and announce it, or undefined
   * to say "no slot — use the old addRelayTransceiver path and renegotiate".
   *
   * This is the whole point of the phase: on the happy path a participant
   * joining a call costs one replaceTrack and one mapping message, and no SDP
   * crosses the wire at all.
   */
  async function assignSlot(conn: ClientConnection, opts: {
    ownerKey: string;
    track: MediaStreamTrack;
    purpose: 'va' | 'screen';
  }): Promise<{ sender: RTCRtpSender; mid: string; streamId: string } | undefined> {
    const slots = clientRelaySlots.get(conn.clientAddr);
    if (!slots || (slots.length === 0)) {
      return undefined;
    }
    const kind = (opts.track.kind === 'audio') ? 'audio' : 'video';
    const slot = pickSlot(slots, { kind, purpose: opts.purpose, ownerKey: opts.ownerKey });
    if (!slot) {
      return undefined;
    }
    // A relayed audio track cannot be a sender's source directly; its locally
    // sourced copy can. Video is handed over untouched - it has never had this
    // problem, and a needless graph would only cost a re-encode.
    const trackForSlot = (opts.track.kind === 'audio')
      ? audioRelayBridge.localCopyOf(opts.track) : opts.track;
    if (!trackForSlot) {
      log.warn(
        `no local copy for ${opts.ownerKey}'s audio; leaving slot `
        + `${slot.declaration.mid} of ${conn.clientAddr} free and renegotiating instead`,
      );
      return undefined;
    }
    slot.owner = opts.ownerKey;
    // Awaited, and the caller is told nothing until it settles. Fire-and-forget
    // was worse than a plain failure: the rejection freed the slot again, but by
    // then the caller had recorded the sender and sent the mapping naming this
    // participant — so the viewer put up a tile for media the host was not
    // sending, and the bookkeeping said the source was covered, which is what
    // made the state permanent. Returning `undefined` instead puts the track on
    // the ordinary transceiver path, the same one taken when there is no free
    // slot at all; no recovery machinery, just the existing fallback.
    try {
      await slot.handle.sender.replaceTrack(trackForSlot);
    } catch (err) {
      slot.owner = null;
      log.error(
        `failed to put ${opts.ownerKey}'s ${kind} into slot ${slot.declaration.mid} `
        + `of ${conn.clientAddr}; falling back to a transceiver of its own`, err,
      );
      return undefined;
    }
    // Explicitly, because applyBitrateToAllSenders runs at answer time when the
    // slot is empty and applyVideoBitrateLimit skips a sender without a track.
    void applyVideoBitrateLimit(slot.handle.sender, videoQuality).catch(() => {});
    log.info(
      `relaying ${opts.ownerKey}'s ${kind} to ${conn.clientAddr} in reserved slot `
      + `${slot.declaration.mid} (no renegotiation)`,
    );
    return {
      sender: slot.handle.sender,
      mid: slot.declaration.mid,
      streamId: slot.stream.id,
    };
  }

  // ===========================================================================
  // Relay matrix diagnostics
  // ===========================================================================

  /** What a relaying sender had put out when the matrix last looked. */
  const lastRelayReport = new Map<RTCRtpSender, { packets: number; energy: number | undefined }>();
  let relayMatrixTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * What a sender is putting out: packets, and for audio how loud the source is.
   *
   * Packets alone cannot answer "is A heard by B": a muted microphone and a
   * bridge whose AudioContext never woke both keep sending at the ordinary rate,
   * one of them carrying silence. `totalAudioEnergy` is cumulative, so its
   * per-tick growth is the difference between relayed speech and relayed nothing
   * - which is what the ear had to be used for until now. Read off the
   * media-source the outbound-rtp names, i.e. of the bridged copy itself.
   */
  async function relayReportOf(
    sender: RTCRtpSender,
  ): Promise<{ packets: number; energy: number | undefined }> {
    try {
      const stats = await sender.getStats();
      let packets = -1;
      let sourceId: string | undefined = undefined;
      stats.forEach(report => {
        if (report.type === 'outbound-rtp') {
          const outbound = report as unknown as { packetsSent?: number; mediaSourceId?: string };
          packets = outbound.packetsSent ?? 0;
          sourceId = outbound.mediaSourceId;
        }
      });
      const source = sourceId
        ? (stats.get(sourceId) as unknown as { totalAudioEnergy?: number } | undefined)
        : undefined;
      return { packets, energy: source?.totalAudioEnergy };
    } catch {
      return { packets: -1, energy: undefined };
    }
  }

  /**
   * ` nrg=…` for an audio sender, empty for video.
   *
   * Off the media-source of the bridged copy, so it answers the one question the
   * host can answer on its own: does the WebAudio graph produce samples. What it
   * cannot answer is whether the source was speaking at all - the inbound side
   * of a relayed track reports no energy here, because Chromium fills
   * `totalAudioEnergy` only for audio it plays out, and the host plays nothing
   * on the graph's behalf (measured in Suite 15: a relayed track feeding the
   * bridge reads 0 throughout while its copy sends 1007 packets). That half of
   * the answer lives in the source's own `[CallQuality]` line, which reports the
   * energy of its microphone from the side where it is real.
   */
  function loudnessOf(
    kind: string | undefined,
    report: { energy: number | undefined },
    previousEnergy: number | undefined,
  ): string {
    if (kind !== 'audio') {
      return '';
    }
    return ` nrg=${audioEnergyGrowth(report.energy, previousEnergy)}`;
  }

  /**
   * One line per (client, source, kind) of what this host is actually relaying.
   *
   * The question a broken call raises is never "is the connection up" - it is
   * "is A's voice reaching B", and until now nothing on either side could answer
   * it. A sender whose `sent` does not move between ticks while its track is live
   * is the whole fault, stated: the m-line exists, the mapping was sent, the
   * viewer has a tile, and no RTP is going into it.
   */
  async function logRelayMatrix(): Promise<void> {
    if (isClosed || (clients.size === 0)) {
      return;
    }
    for (const [clientAddr, conn] of clients.entries()) {
      const slots = clientRelaySlots.get(clientAddr) ?? [];
      const parts: string[] = [];
      for (const [sourceAddr, senders] of conn.outgoingTrackSenders.entries()) {
        for (const sender of senders) {
          const track = sender.track;
          const slot = slotOfSender(clientAddr, sender);
          const report = await relayReportOf(sender);
          const previous = lastRelayReport.get(sender);
          lastRelayReport.set(sender, { packets: report.packets, energy: report.energy });
          const delta = ((previous === undefined) || (report.packets < 0))
            ? '?' : `+${report.packets - previous.packets}`;
          parts.push(
            `${sourceAddr} ${track ? track.kind : 'no-track'}`
            + `[${slot ? `slot ${slot.declaration.mid}` : 'transceiver'}]`
            + ` track=${track ? track.readyState : '-'}`
            + `${track && !track.enabled ? '/disabled' : ''}${track?.muted ? '/muted' : ''}`
            + ` sent=${delta}`
            + loudnessOf(track?.kind, report, previous?.energy),
          );
        }
      }
      const emptySlots = slots.filter(slot => !slot.owner).length;
      log.info(
        `relay matrix -> ${clientAddr} (${conn.peerConnection.connectionState}, `
        + `${emptySlots}/${slots.length} slot(s) free): `
        + (parts.length ? parts.join(' | ') : 'nothing forwarded'),
      );
    }
    // Senders of pcs that are gone must not keep a baseline: a recycled object
    // would be compared against a stranger's counter.
    const live = new Set<RTCRtpSender>();
    for (const conn of clients.values()) {
      for (const senders of conn.outgoingTrackSenders.values()) {
        senders.forEach(sender => live.add(sender));
      }
    }
    for (const sender of [...lastRelayReport.keys()]) {
      if (!live.has(sender)) {
        lastRelayReport.delete(sender);
      }
    }
  }

  function startRelayMatrixLogging(): void {
    if (relayMatrixTimer !== null) {
      return;
    }
    relayMatrixTimer = setInterval(() => {
      void logRelayMatrix().catch(() => {
        // Diagnostics may not break what they observe.
      });
    }, RELAY_MATRIX_INTERVAL_MS);
  }

  function stopRelayMatrixLogging(): void {
    if (relayMatrixTimer !== null) {
      clearInterval(relayMatrixTimer);
      relayMatrixTimer = null;
    }
    lastRelayReport.clear();
  }

  /**
   * Attaches the 'negotiationneeded' handler to a client's RTCPeerConnection.
   * Must be called only AFTER the initial answer was sent to the client
   * (otherwise adding host's local tracks would trigger a premature offer
   * before the client's initial offer is answered).
   */
  function armNegotiationHandler(clientConn: ClientConnection): void {
    const { peerConnection: pc, clientAddr } = clientConn;
    // Through the gate, not straight to negotiateWithClient: transceivers added
    // after the initial answer (relay, screen) fire this natively, and an offer
    // sent from here before the client is connected is exactly what the gate
    // exists to prevent. The request is deferred, never dropped.
    pc.onnegotiationneeded = () => scheduleNegotiateWithClient(clientAddr, 'negotiationneeded');
  }

  /**
   * Recreates the entire peer connection for a client when the SDP session
   * got out of sync (e.g. an answer failed to apply). All existing relayed
   * tracks are re-added to the new connection and a fresh offer is sent via
   * the standard 'negotiationneeded' path.
   */
  async function recreateClientConnection(clientAddr: string): Promise<void> {
    const oldConn = clients.get(clientAddr);
    if (!oldConn || isClosed) { return; }

    // Several independent paths can decide to recreate the same client at once
    // (a failed answer, a caught offer error, an exhausted watcher). Letting
    // two of them run concurrently would leave the second one closing the pc
    // the first has just built and registered.
    if (recreatesInProgress.has(clientAddr)) {
      console.log(`[Host] Recreate already in progress for ${clientAddr}, skipping`);
      return;
    }

    // A connection that has already been rebuilt MAX_RECREATE_COUNT times
    // without ever reaching 'connected' is not going to converge; recreating
    // forever just keeps the client in a silent reconnect loop. Drop it
    // instead — removeClient() notifies it with 'dropped', so its UI can react
    // and it is free to re-join with a fresh offer.
    if (oldConn.recreateCount >= MAX_RECREATE_COUNT) {
      console.warn(
        `[Host] Recreate budget exhausted for ${clientAddr} (${MAX_RECREATE_COUNT}); dropping client`,
      );
      await removeClient(clientAddr, { notifyDropped: true });
      return;
    }

    recreatesInProgress.add(clientAddr);
    try {
      await recreateClientConnectionUnguarded(clientAddr, oldConn);
    } finally {
      recreatesInProgress.delete(clientAddr);
    }
  }

  async function recreateClientConnectionUnguarded(
    clientAddr: string, oldConn: ClientConnection,
  ): Promise<void> {
    console.log(
      `[Host] Recreating peer connection for ${clientAddr} `
      + `(recreate ${oldConn.recreateCount + 1}/${MAX_RECREATE_COUNT})`,
    );

    // Collect all track senders from the old connection
    const oldSenders = oldConn.outgoingTrackSenders;

    // Stop retry watchers, pending renegotiation and PC setup for the old connection
    disposeNegotiationRetry(clientAddr);
    disposeAnswerRetry(clientAddr);
    clearPendingNegotiate(clientAddr);
    // Outbound candidates still batched for the old pc must not be sent.
    signalingChannel.clearCandidatesFor?.(clientAddr);
    // Same for mappings: the fresh connection re-affirms all of them, and the
    // dedup memory of the dead pc must not suppress that.
    clearStreamInfoStateFor(clientAddr);
    // Slots belong to the pc that negotiated them, and only a client offer can
    // declare new ones — this path offers host-first, so the replacement starts
    // with none and relays through its own transceivers until the client offers
    // again.
    clientRelaySlots.delete(clientAddr);
    const oldSetup = pcSetups.get(clientAddr);
    if (oldSetup) {
      oldSetup.stopQualityMonitor();
      pcSetups.delete(clientAddr);
    }

    // Close old connection
    try {
      if (oldConn.streamInfoChannel) {
        oldConn.streamInfoChannel.close();
        oldConn.streamInfoChannel = null;
      }
      oldConn.peerConnection.close();
    } catch {
      // Ignore close errors
    }
    clients.delete(clientAddr);

    // Create a fresh peer connection
    const pc = createPeerConnectionForClient(clientAddr);

    // Receive slots for the client's own mic/cam. createPeerConnectionForClient
    // only adds SEND m-lines (host tracks; relay transceivers follow below):
    // enough when the host answers a client's offer, but this recreate path
    // OFFERS first, and an offer with no recv m-lines gives the client nothing
    // to attach its media to - its answer cannot add m-lines, so its audio and
    // video would stay dark until yet another renegotiation. Added before the
    // relay transceivers so the m-line layout is stable across recreates.
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.addTransceiver('video', { direction: 'recvonly' });

    // Transfer the DC from temp storage to the new connection record
    const dc = tempStreamInfoChannels.get(pc) ?? null;
    tempStreamInfoChannels.delete(pc);
    const sigDc = tempSignalingChannels.get(pc) ?? null;
    tempSignalingChannels.delete(pc);

    const setup = pcSetups.get(clientAddr);

    const newConn: ClientConnection = {
      clientAddr,
      peerConnection: pc,
      incomingTracks: [],
      outgoingTrackSenders: new Map(),
      streamInfoChannel: dc,
      signalingDataChannel: sigDc,
      makingOffer: false,
      // Carried over from the replaced connection: the new-SDP-session check in
      // handleClientOffer() needs this baseline to recognize the client's own
      // recreated pc. Nulling it here trapped the host in have-local-offer —
      // every fresh client offer was ignored as a collision, forever.
      lastAppliedOfferOrigin: oldConn.lastAppliedOfferOrigin,
      recreateCount: oldConn.recreateCount + 1,
      pendingCandidates: [],
      stopQualityMonitor: setup?.stopQualityMonitor,
    };
    clients.set(clientAddr, newConn);
    signalingChannel.addClient(clientAddr);

    // The fresh connection starts from scratch — give it a full deadline.
    armClientConnectDeadline(clientAddr);

    // Re-add host's own stream-sender-info
    sendStreamSenderInfo(clientAddr, localStream.id, ownAddr);

    // Re-add all outgoing tracks from the old connection.
    //
    // IMPORTANT: read the actual track directly off the OLD sender
    // (sender.track), not via clientTracks.get(sourceAddr). clientTracks is
    // keyed by the *connecting* client's own address (populated in ontrack()
    // for that client's PeerConnection) — it never has an entry for a
    // 'screen:<mailerId>:<srcId>' key. outgoingTrackSenders, however, DOES
    // use that 'screen:...' key for both the host's own screen share
    // (addOwnScreenTrack) and a re-broadcasted screen share coming from
    // another client (broadcastScreenTrackToOtherClients). Looking tracks up
    // via clientTracks therefore silently dropped every screen-share track
    // whenever this client's connection had to be recreated (e.g. after
    // exhausted renegotiation retries), permanently ending that share for
    // this client with no way to recover short of restarting the share.
    for (const [sourceAddr, senders] of oldSenders.entries()) {
      const isScreen = isScreenShareAddr(sourceAddr);
      // Only live tracks: once the old pc is closed some senders already hold
      // ended tracks, and a proxy stream must never be seeded with one.
      const liveTracks = senders
      .map(oldSender => oldSender.track)
      .filter(track => !!track && (track.readyState !== 'ended')) as MediaStreamTrack[];
      if (liveTracks.length === 0) {
        continue;
      }
      // Screens keep the SAME cached proxy stream every other viewer already
      // knows (getOrCreateScreenRelayStream), so the msid on the wire always
      // matches the id announced by stream-sender-info — including mappings
      // re-sent later by resendAllStreamSenderInfo. Minting a fresh
      // MediaStream here made those two diverge, leaving the viewer with a
      // screen stream it could not map back to a sender. Non-screen sources
      // keep sharing the single relay stream so audio+video stay grouped
      // under one stream id.
      const proxyStream = isScreen
      ? getOrCreateScreenRelayStream(sourceAddr, liveTracks[0])
      : getOrCreateRelayStream(sourceAddr, liveTracks[0]);

      let reAddedAny = false;
      for (const track of liveTracks) {
        try {
          if (isScreen && !proxyStream.getTracks().includes(track)) {
            proxyStream.addTrack(track);
          }
          const transceiver = addRelayTransceiver(
            pc,
            track,
            proxyStream,
            `Host -> Client ${clientAddr} (recreate relay)`,
          );

          let newSenders = newConn.outgoingTrackSenders.get(sourceAddr);
          if (!newSenders) {
            newSenders = [];
            newConn.outgoingTrackSenders.set(sourceAddr, newSenders);
          }
          newSenders.push(transceiver.sender);
          reAddedAny = true;
        } catch (err) {
          console.error(`[Host] Failed to re-add track from ${sourceAddr} to new PC for ${clientAddr}:`, err);
        }
      }

      if (!reAddedAny) {
        continue;
      }

      // Re-send stream-sender-info with the id of the (possibly new) proxy stream.
      const streamForInfo = isScreen ? proxyStream : relayStreams.get(sourceAddr);
      if (streamForInfo) {
        sendStreamSenderInfo(clientAddr, streamForInfo.id, sourceAddr);
      }
    }

    // Re-add host's own screen share tracks using live tracks from the app layer.
    // After the old PC is closed, sender.track from outgoingTrackSenders becomes
    // ended — getOwnScreenTracks() provides fresh, live tracks from the current
    // screen share session.
    const ownScreenTracks = getOwnScreenTracks?.() ?? [];
    for (const { track, mailerId, srcId, screenName } of ownScreenTracks) {
      if (track.readyState === 'ended') {
        continue;
      }
      try {
        addOwnScreenTrack(track, new MediaStream(), mailerId, srcId, screenName);
      } catch (err) {
        console.error(`[Host] Failed to re-add own screen track ${srcId} to recreated PC for ${clientAddr}:`, err);
      }
    }

    // Arm Perfect Negotiation and send the fresh offer. Deliberately straight to
    // negotiateWithClient, bypassing the connected-gate: this pc has never been
    // connected and never will be until this very offer goes out.
    armNegotiationHandler(newConn);
    await negotiateWithClient(clientAddr);

    console.log(`[Host] Recreated connection for ${clientAddr}, fresh offer sent`);
  }

  /**
   * Creates RTCPeerConnection for a new client.
   */
  function createPeerConnectionForClient(clientAddr: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(rtcConfig);
    // The peer's own clock as we last saw it, frozen at the moment this pc
    // generation was built: anything the peer sent before that cannot be
    // describing something newer than what we are already running. Compared
    // against msgTs, which is also the peer's clock — unlike connectedAt, which
    // is ours and therefore meaningless across a clock skew.
    pcGenPeerTsBaseline.set(clientAddr, freshnessGateFor(clientAddr).highWater());

    // Add Host's local tracks
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Apply codec preferences to all transceivers to eliminate payload-type
    // (PT) codec collisions (e.g. duplicate PT 49/119 for RTX/RED across
    // BUNDLE m-lines) that break renegotiation and cause glitches. Done here
    // after local tracks are added (which creates the transceivers) and before
    // the client's offer is applied via setRemoteDescription().
    applyCodecPreferences(pc, `Host -> Client ${clientAddr}`);

    // A colliding client offer refused earlier waits for exactly this moment:
    // 'stable' is when it can finally be applied. Covers every way back to
    // stable (answer applied, rollback, recovery), not just the answer path.
    //
    // Deferred to the next tick because this event fires synchronously from
    // inside setRemoteDescription(): replaying the offer right here would
    // interleave with the bookkeeping the answer path still has to run (retry
    // watchers, pending renegotiation). processDeferredOffer() takes the offer
    // before doing anything else, so several stable transitions in a row
    // cannot replay it twice.
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable') {
        setTimeout(() => {
          // Through the client's SDP queue like any incoming offer: the replay
          // ends in handleClientOffer and must not overlap one already running.
          void sdpQueueFor(clientAddr).run(() => processDeferredOffer(clientAddr, pc));
        }, 0);
      }
    };

    // Create data channel for reliable stream-sender-info delivery to this client.
    // The client's ondatachannel handler picks this up and maps stream IDs before
    // ontrack fires, avoiding UUID fallbacks.
    const streamInfoDc = pc.createDataChannel('streamInfo', {
      ordered: true,
    });

    // Create data channel for low-latency SDP signaling (offer/answer/candidate).
    // Once open, this bypasses ASMail entirely for WebRTC signaling,
    // eliminating 100ms-2s delay per signal. ASMail remains as fallback
    // for the initial offer (DC not yet open) and for non-critical signals.
    const signalingDc = pc.createDataChannel('signaling', {
      ordered: true,
      negotiated: false,
      id: undefined, // let browser assign
    });
    signalingDc.onopen = () => {
      console.log(`[Host] signaling data channel to ${clientAddr} opened`);
      // Register the now-open DC with the signaling channel so outgoing
      // signals to this client bypass ASMail (low-latency path).
      signalingChannel.setClientDataChannel?.(clientAddr, signalingDc);
      // An offer still awaiting an answer is re-sent right away over the
      // freshly opened DC — cheap, and it recovers an offer whose ASMail copy
      // was lost or whose answer was dropped as superseded. schedule() is a
      // no-op when shouldSkip() sees no pending offer.
      getNegotiationRetryWatcher(clientAddr).schedule(true);
      // The answer leg is different: this DC opening IS the proof the client
      // received the answer (the very connection it completes carries the DC),
      // so its retry can be dropped for good.
      clearAnswerRetry(clientAddr);
      // What the gate was waiting for: a renegotiation held back for this client
      // can now go out over the fast path instead of a 7-15s ASMail hop.
      if (clients.get(clientAddr)?.peerConnection === pc) {
        attemptExplicitNegotiate(clientAddr);
      }
    };
    signalingDc.onmessage = (msgEvent: MessageEvent) => {
      try {
        const signal = JSON.parse(msgEvent.data) as StarSignalMessage;
        console.log(`[Host] DC signaling from ${clientAddr}: ${signal.type}`);
        // Route through the same handler as ASMail-delivered signals.
        signalingChannel.handleIncomingSignal(clientAddr, signal);
      } catch (err) {
        console.error(`[Host] Failed to parse signaling DC message from ${clientAddr}:`, err);
      }
    };
    signalingDc.onerror = err => {
      console.error(`[Host] signaling data channel to ${clientAddr} error:`, err);
    };
    signalingDc.onclose = () => {
      // Guarded by identity of `pc`: recreateClientConnection() and
      // removeClient()/closeAll() all close a PC too, and must not be
      // mistaken for a fresh departure of the (by then already-superseded or
      // already-removed) client.
      if (isClosed) { return; }
      const conn = clients.get(clientAddr);
      if (!conn || conn.peerConnection !== pc) { return; }
      // A closing SCTP association is a departure only when the transport
      // itself is dead. The CLIENT closing its own pc (its recreate path)
      // fires this too, while its fresh offer still needs a full ASMail leg
      // — removing it here killed a 1-1 call 5s into the client's recovery.
      // For a crashed client app the connectionState collapses within
      // seconds and the grace path handles the removal.
      const pcState = pc.connectionState;
      if (pcState === 'failed' || pcState === 'closed') {
        console.warn(`[Host] signaling DC to ${clientAddr} closed with pc ${pcState} — treating as departure`);
        void removeClient(clientAddr);
        return;
      }
      console.warn(
        `[Host] signaling DC to ${clientAddr} closed (pc ${pcState}) — leaving removal to the grace path`,
      );
    };
    // Store DC reference so signaling channels can use it.
    tempSignalingChannels.set(pc, signalingDc);
    streamInfoDc.onopen = () => {
      console.log(`[Host] streamInfo data channel to ${clientAddr} opened`);
      resendAllStreamSenderInfo(clientAddr);
    };
    streamInfoDc.onerror = err => {
      console.error(`[Host] streamInfo data channel to ${clientAddr} error:`, err);
    };
    // Store DC reference in the connection record. If the connection record
    // hasn't been created yet, we store it in a temporary map keyed by pc.
    // The actual storage happens in handleClientOffer() right after this call.
    tempStreamInfoChannels.set(pc, streamInfoDc);

    // Handle tracks from this client
    pc.ontrack = (event: RTCTrackEvent) => {
      const stream = event.streams[0];
      if (!stream) {
        return;
      }

      const track = event.track;
      logTrackMuteState(track, `[Host]`, clientAddr);

      // Store track
      let tracks = clientTracks.get(clientAddr);
      if (!tracks) {
        tracks = [];
        clientTracks.set(clientAddr, tracks);
      }
      if (!tracks.includes(track)) {
        tracks.push(track);
      }

      // Handle track end
      track.addEventListener('ended', () => {
        console.log(`[Host] Track from ${clientAddr} ended`);
        const storedTracks = clientTracks.get(clientAddr);
        if (storedTracks) {
          const idx = storedTracks.indexOf(track);
          if (idx !== -1) {
            storedTracks.splice(idx, 1);
          }
        }
      });

      resolveIncomingClientTrack(clientAddr, track, stream);
    };

    // Link to this client is down (grace timeout or definitive 'failed').
    // The first time, wait one more grace period instead of removing: the
    // client's own recovery recreates its PeerConnection after ITS grace
    // period and sends a fresh offer, which needs a full ASMail leg to get
    // here — removing the client now would end a 1-1 call that is about to
    // recover. Only a second expiry removes the client for real.
    const waitOrRemoveOnLinkDown = () => {
      const conn = clients.get(clientAddr);
      if (!conn || conn.peerConnection !== pc) {
        return;
      }
      const state = pc.connectionState;
      if (state !== 'disconnected' && state !== 'failed') {
        return;
      }
      if (!conn.graceExtended) {
        conn.graceExtended = true;
        console.warn(
          `[Host] Client ${clientAddr} did not recover within grace period; ` +
            `waiting one more period for a fresh offer before removing`,
        );
        pcSetups.get(clientAddr)?.disconnectGraceTimer.arm(waitOrRemoveOnLinkDown);
        return;
      }
      console.warn(`[Host] Client ${clientAddr} did not recover within extended grace period, removing`);
      void removeClient(clientAddr, { notifyDropped: true });
    };

    // Wire shared event handlers (ICE candidate, connection state, quality monitor).
    // Replace any previous setup for this clientAddr (recreate path).
    const prevSetup = pcSetups.get(clientAddr);
    if (prevSetup) {
      prevSetup.stopQualityMonitor();
    }
    const setup = setupPeerConnection(pc, {
      label: `Host -> Client ${clientAddr}`,
      rtcConfig,
      onIceCandidate: candidate => {
        if (!isClosed) {
          signalingChannel.sendCandidateToClient(clientAddr, candidate.toJSON());
        }
      },
      onIceGatheringComplete: () => {
        if (!isClosed) {
          signalingChannel.flushCandidatesFor?.(clientAddr);
        }
      },
      onRequestRenegotiate: () => {
        // Also deliberately ungated: an ICE restart happens on a pc that has
        // dropped out of 'connected', and this offer is what brings it back.
        negotiateWithClient(clientAddr).catch(err => {
          console.error(`[Host] Re-offer after ICE restart failed for ${clientAddr}:`, err);
        });
      },
      strandedOfferAgeMillis: () => {
        const conn = clients.get(clientAddr);
        return ((conn?.peerConnection === pc) && conn.lastOfferSentAt)
          ? (Date.now() - conn.lastOfferSentAt) : null;
      },
      onConnectionStateChange: state => {
        onClientConnectionStateChange?.(clientAddr, state);

        if (state === 'failed') {
          // Even a definitive 'failed' gets the fresh-offer wait first (see
          // waitOrRemoveOnLinkDown): the client recreates its PeerConnection
          // after its own grace period, and that offer takes an ASMail leg
          // to arrive.
          waitOrRemoveOnLinkDown();
          return;
        }

        if (state === 'connected') {
          clearClientConnectDeadline(clientAddr);
          const conn = clients.get(clientAddr);
          if (conn) {
            conn.graceExtended = false;
            // The recreate budget guards against a connection that can never
            // converge, not against a long call with occasional network
            // breaks: a link that did come up earns a fresh budget.
            conn.recreateCount = 0;
            // Baseline for the "don't demolish a live pc for an older offer"
            // guard in handleClientOffer().
            conn.connectedAt = Date.now();
          }
          // The answer leg is settled: DTLS cannot complete unless the client
          // applied our answer, so a pending answer retry has nothing to
          // recover. Hygiene rather than a saving - shouldSkip() already returns
          // true on 'connected', so no tick would have sent anything - and
          // deliberately limited to the ANSWER: the same reasoning does NOT hold
          // for a renegotiation offer, whose answer ICE tells us nothing about
          // (see shared-pc-setup.ts and client-channel.ts on why keying
          // negotiation recovery on ICE state left a screen share unnegotiated).
          clearAnswerRetry(clientAddr);
          // A renegotiation held back by the gate: now it may go out, after a
          // short wait for the signaling DataChannel (see NEGOTIATE_WAIT_DC_MS).
          attemptExplicitNegotiate(clientAddr);
        }

        if (state === 'reconnecting') {
          if (!reconnectHintTimers.has(clientAddr)) {
            const timer = setTimeout(() => {
              reconnectHintTimers.delete(clientAddr);
              reconnectHintSent.add(clientAddr);
              sendReconnectHint(clientAddr, true, 'link-blip');
            }, RECONNECT_HINT_DELAY_MS);
            reconnectHintTimers.set(clientAddr, timer);
          }
          return;
        }

        // Any other state (typically 'connected') means the link recovered —
        // cancel a pending hint, or announce recovery if peers were already
        // told this client was reconnecting.
        clearReconnectHintTimer(clientAddr);
        if (reconnectHintSent.delete(clientAddr)) {
          sendReconnectHint(clientAddr, false, 'link-blip');
        }
        // A client that announced a re-join has arrived: its connection is
        // reporting states. Forgotten, NOT withdrawn — this fires on the first
        // state the pc reports, long before its tracks land, and a withdrawal
        // here would take the tile down and put it back a beat later.
        clearRejoinNotice(clientAddr);
      },
      onGraceTimeout: waitOrRemoveOnLinkDown,
    });
    pcSetups.set(clientAddr, setup);

    // Keep ClientConnection.stopQualityMonitor in sync when the record exists.
    const existingConn = clients.get(clientAddr);
    if (existingConn) {
      existingConn.stopQualityMonitor = setup.stopQualityMonitor;
    }

    return pc;
  }

  /**
   * Replays a client offer that was refused as a glare collision, now that
   * signaling is back in 'stable'. All the usual admission logic (duplicate
   * detection, new-SDP-session handling, origin comparison) is reused by
   * routing it through handleClientOffer().
   */
  async function processDeferredOffer(clientAddr: string, pc: RTCPeerConnection): Promise<void> {
    const conn = clients.get(clientAddr);
    if (!conn || isClosed || (conn.peerConnection !== pc)) {
      return;
    }
    const deferred = conn.deferredOffer;
    if (!deferred) {
      return;
    }
    // Cleared before applying: handleClientOffer() can put the connection back
    // into negotiation, and a re-entrant replay of the same offer must not
    // happen.
    conn.deferredOffer = null;

    if ((pc.signalingState !== 'stable') || conn.makingOffer) {
      return;
    }
    const age = Date.now() - deferred.receivedAt;
    if (age > DEFERRED_OFFER_TTL_MS) {
      console.log(
        `[Host] Discarding deferred offer from ${clientAddr}: ${age}ms old (client will re-offer)`,
      );
      return;
    }
    // Already applied (or older than what we applied) within the same session.
    const applied = conn.lastAppliedOfferOrigin;
    if (deferred.origin && applied
      && (deferred.origin.sessionId === applied.sessionId)
      && (deferred.origin.version <= applied.version)) {
      return;
    }

    console.log(
      `[Host] Executing deferred offer from ${clientAddr} (origin: `
      + `${deferred.origin ? `${deferred.origin.sessionId}/${deferred.origin.version}` : 'n/a'}, `
      + `deferred for ${age}ms)`,
    );
    try {
      // The original send time travels with the offer, so the replay is judged
      // by when the client actually produced it, not by when we got round to it.
      await handleClientOffer(clientAddr, deferred.offer, deferred.msgTs);
    } catch (err) {
      console.error(`[Host] Deferred offer from ${clientAddr} failed to apply:`, err);
      // An offer held for a while describes a pc generation whose m-lines this
      // one no longer matches (relay/screen lines were added meanwhile), and
      // Chromium refuses it outright. Logging and moving on left the client
      // waiting out its 120s connect deadline for an answer that would never
      // come. Rebuild TO ANSWER rather than recreating-and-offering: the answer
      // carries our new session id to a client that does not check session ids
      // on answers, so it converges in one step instead of triggering a recreate
      // of its own (the mutual-recreate loop of 2026-08-12).
      if (isUnapplicableOnThisPc(err) && !isClosed && (clients.get(clientAddr) === conn)) {
        console.log(`[Host] Rebuilding the connection to ${clientAddr} to answer its offer`);
        pcSetups.get(clientAddr)?.stopQualityMonitor();
        try {
          conn.peerConnection.close();
        } catch {
          // already dead; the record is going away either way
        }
        clients.delete(clientAddr);
        try {
          await handleClientOffer(clientAddr, deferred.offer, deferred.msgTs);
        } catch (rebuildErr) {
          console.error(
            `[Host] Rebuilt connection to ${clientAddr} still could not answer its offer:`,
            rebuildErr,
          );
        }
      }
    }
  }

  /**
   * Handles SDP Offer from a client.
   * Creates connection if needed and sends Answer back.
   */
  async function handleClientOffer(
    clientAddr: string, offer: RTCSessionDescriptionInit, msgTs?: number,
  ): Promise<void> {
    if (isClosed) {
      return;
    }

    // Check if we can accept new client
    if (!canAcceptNewClient() && !clients.has(clientAddr)) {
      console.warn(`[Host] Cannot accept client ${clientAddr}: call is full`);
      // Send rejection signal
      await signalingChannel.sendSignalToClient(clientAddr, {
        type: 'call-full',
        fromAddr: ownAddr,
        data: {
          maxParticipants: MAX_CALL_PARTICIPANTS,
          currentParticipants: clients.size + 1, // +1 for host
        },
      });
      return;
    }

    // Recreate count of a connection dropped below, carried into its
    // replacement so the budget survives a re-join (see B3 comment there).
    let carriedRecreateCount = 0;
    let clientConn = clients.get(clientAddr);
    if (clientConn) {
      // Fast re-join case: an offer for a NEW session arrived while the old
      // (dead) connection still exists. A brand-new offer cannot be applied
      // to the old RTCPeerConnection (m-line mismatch), so drop the stale
      // connection and start clean. 'disconnected' counts too when the offer
      // provably comes from a fresh RTCPeerConnection (different SDP origin
      // session): that is the client's own link-down recovery recreating its
      // connection, exactly what the extended grace period is waiting for.
      const pcState = clientConn.peerConnection.connectionState;
      const sigState = clientConn.peerConnection.signalingState;
      const incomingOrigin = parseSdpOrigin(offer.sdp);
      const isNewSdpSession = !!incomingOrigin && (
        (!!clientConn.lastAppliedOfferOrigin
          && incomingOrigin.sessionId !== clientConn.lastAppliedOfferOrigin.sessionId)
        // No baseline ever recorded while this side holds a local offer: only
        // the recreate path offers host-first, so ANY client offer here comes
        // from a pc this one has never negotiated with — accept-and-reset,
        // never ignore. (The initial-connection window is not affected: a
        // fresh ClientConnection applying its first client offer sits in
        // 'stable'/'have-remote-offer', not 'have-local-offer'.)
        || (!clientConn.lastAppliedOfferOrigin && sigState === 'have-local-offer')
      );
      // A new SDP session is sufficient on its own, whatever the connection
      // state: the client only mints a new session by recreating its pc, so
      // the old one is dead on its side and this pc can never apply the new
      // offer (m-line mismatch). Crucially, this also holds during glare -
      // the impolite-side ignore below is for collisions within ONE session,
      // and ignoring a new-session offer instead left both sides stuck until
      // the 120s connect deadline.
      // ...but a new session id alone never justifies demolishing a CONNECTED
      // pc for an offer that predates it. A session id says "different", not
      // "newer": ASMail happily delivers an offer from a pc generation the
      // client has already abandoned, and acting on it threw away a working
      // connection, then handed the client a new session id of our own, which
      // made it recreate in turn — the mutual-recreate loop behind the
      // minutes-long flapping. Only the new-session trigger is softened; a
      // closed/failed pc is dropped as before.
      const onlyNewSessionTrigger = isNewSdpSession
        && (pcState !== 'closed') && (pcState !== 'failed') && (sigState !== 'closed');
      // Deliberately NOT limited to a connected pc, and measured against the
      // peer's own clock rather than ours. The old form (msgTs vs connectedAt)
      // could not fire before the first 'connected', which is precisely where
      // the mutual-recreate loop starts: during initial setup every diverging
      // session id spent one of the two recreates, and both sides ran out
      // (group call of 2026-08-12). It also compared two different clocks, so a
      // skewed peer either defeated it or tripped it on legitimate offers.
      const genBaseline = pcGenPeerTsBaseline.get(clientAddr) ?? 0;
      if (onlyNewSessionTrigger && (msgTs !== undefined) && (msgTs <= genBaseline)) {
        console.log(
          `[Host] Ignoring new-session offer from ${clientAddr} sent `
          + `${genBaseline - msgTs}ms before this pc generation was built `
          + `(state: ${pcState}, connected ${clientConn.connectedAt
            ? `${Date.now() - clientConn.connectedAt}ms ago` : 'never'}, keeping the pc)`,
        );
        return;
      }
      // Belt to the timestamp guard's suspenders, for a peer whose build sends
      // no msgTs: once this many live pcs have been dropped for this client
      // without the pair settling, dropping one more is not converging on
      // anything. Keep what works and let the link watchdogs (connect
      // deadline, grace path) decide.
      if (onlyNewSessionTrigger && (pcState === 'connected')
        && (clientConn.recreateCount >= MAX_RECREATE_COUNT)) {
        console.warn(
          `[Host] Ignoring new-session offer from ${clientAddr}: ${clientConn.recreateCount} live `
          + `connections already dropped for it (keeping the live pc)`,
        );
        return;
      }
      if (pcState === 'closed' || pcState === 'failed' || sigState === 'closed'
        || isNewSdpSession) {
        console.log(
          `[Host] Dropping stale connection for re-joining client ${clientAddr} (state: ${pcState}/${sigState})`,
        );
        // Dropping a LIVE pc counts against the recreate budget, and the count
        // is carried into the replacement record below. Restarting it at zero
        // on every re-join (the old behaviour) meant the cap could never be
        // reached on exactly the path that loops. Dropping an already-dead pc
        // is ordinary re-join traffic and costs nothing.
        carriedRecreateCount = clientConn.recreateCount
          + ((pcState === 'connected') ? 1 : 0);
        // Stop its monitors/timers and close the dead pc: the entry is about
        // to be replaced, so nothing else would ever clean it up.
        pcSetups.get(clientAddr)?.stopQualityMonitor();
        try {
          clientConn.peerConnection.close();
        } catch {
          // ignore close errors on an already-dead connection
        }
        clients.delete(clientAddr);
        // Its slots died with its pc; the fresh offer below declares its own.
        clientRelaySlots.delete(clientAddr);
        clientConn = undefined;
      } else {
        // Perfect Negotiation (host = IMPOLITE peer): if our own offer to
        // this client is in flight (glare/collision), we IGNORE the client's
        // colliding offer. The polite client will roll back its own offer
        // and answer ours, so the pair always converges.
        // In 'stable' state a client's re-offer (screen share, retry after
        // a lost answer) is perfectly valid and must be processed.
        const offerCollision = clientConn.makingOffer || sigState !== 'stable';
        const ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) {
          // Impolite means we do not APPLY the colliding offer now — it does
          // not mean the offer has to be thrown away. Dropping it made the
          // client wait out a 45s retry (or its post-rollback re-negotiate,
          // which under ASMail latency produced yet another collision), so a
          // pair could trade collisions for the whole call. Keep the newest
          // one and replay it the moment signaling is back in 'stable'.
          const previous = clientConn.deferredOffer;
          const supersedesPrevious = !previous?.origin || !incomingOrigin
            || (previous.origin.sessionId !== incomingOrigin.sessionId)
            || (incomingOrigin.version >= previous.origin.version);
          if (supersedesPrevious) {
            clientConn.deferredOffer = {
              offer, origin: incomingOrigin, receivedAt: Date.now(), msgTs,
            };
          }
          console.warn(
            `[Host] Deferring colliding offer from ${clientAddr} until stable (impolite, state: ${sigState}, `
              + `makingOffer: ${clientConn.makingOffer}, offer origin: `
              + `${incomingOrigin ? `${incomingOrigin.sessionId}/${incomingOrigin.version}` : 'n/a'}`
              + `${supersedesPrevious ? '' : ', kept newer deferred offer'})`,
          );
          return;
        }

        // Deduplicate a RETRIED offer: the client's own retry watchdog
        // re-sends the SDP offer whenever it hasn't received a confirmed
        // Answer in time. If we already applied this very offer (signaling
        // is 'stable' and its SDP origin matches), just resend the Answer.
        const isRetriedOffer =
          sigState === 'stable' &&
          clientConn.lastAppliedOfferOrigin !== null &&
          incomingOrigin !== null &&
          incomingOrigin.sessionId === clientConn.lastAppliedOfferOrigin.sessionId &&
          incomingOrigin.version === clientConn.lastAppliedOfferOrigin.version;
        if (isRetriedOffer) {
          console.log(`[Host] Ignoring duplicate (retried) offer from ${clientAddr}, resending existing answer`);
          // A retried offer is a sign of life: the client is still trying.
          armClientConnectDeadline(clientAddr);
          const existingAnswer = clientConn.peerConnection.localDescription;
          if (existingAnswer) {
            // No watcher re-arm: each duplicate offer already triggers its
            // own resend (ack-driven), and scheduling here ran the watcher
            // off counters that were never reset — arbitrary cadence.
            sendAnswerInBackground(clientAddr, {
              type: existingAnswer.type,
              sdp: existingAnswer.sdp,
            }, { armRetryWatcher: false, resend: true });
          }
          return;
        }
      }
    }

    const isNewConnection = !clientConn;
    if (!clientConn) {
      // Create new connection for this client
      const pc = createPeerConnectionForClient(clientAddr);
      // Transfer the streamInfo DataChannel created alongside the pc
      const dc = tempStreamInfoChannels.get(pc) ?? null;
      tempStreamInfoChannels.delete(pc);
      const sigDc = tempSignalingChannels.get(pc) ?? null;
      tempSignalingChannels.delete(pc);
      const setup = pcSetups.get(clientAddr);
      clientConn = {
        clientAddr,
        peerConnection: pc,
        incomingTracks: [],
        outgoingTrackSenders: new Map(),
        streamInfoChannel: dc,
        signalingDataChannel: sigDc,
        makingOffer: false,
        lastAppliedOfferOrigin: null,
        // Zero for a genuine first join; non-zero only when this record
        // replaces one whose LIVE pc we just dropped, so a re-join chase
        // cannot keep resetting the budget it is supposed to be spending.
        recreateCount: carriedRecreateCount,
        pendingCandidates: [],
        stopQualityMonitor: setup?.stopQualityMonitor,
      };
      clients.set(clientAddr, clientConn);
      // Register client in signaling channel so broadcastSignal() can reach it
      console.log(`[Host] Adding client ${clientAddr} to signaling channel known clients`);
      signalingChannel.addClient(clientAddr);

      // Candidates that raced ahead of this offer join the regular pending
      // buffer, flushed below right after setRemoteDescription().
      const early = earlyClientCandidates.get(clientAddr);
      if (early) {
        earlyClientCandidates.delete(clientAddr);
        if ((Date.now() - early.bufferedAt) <= EARLY_CANDIDATES_TTL_MS) {
          clientConn.pendingCandidates.push(...early.list);
        }
      }
    }

    const conn = clientConn!;
    const { peerConnection } = conn;

    console.log(`[Host] Handling SDP Offer from client ${clientAddr}`);

    // A client that never reaches 'connected' and stops offering must not
    // stay forever; every accepted offer restarts its deadline. No-op for a
    // renegotiation offer from an already-connected client.
    armClientConnectDeadline(clientAddr);

    // Earliest point the host knows about this specific client (before
    // setRemoteDescription() below fires 'ontrack' and the participant gets
    // a stream) — lets the connecting banner show progress for this peer.
    onClientConnectionStateChange?.(clientAddr, 'establishing');

    // Apply the client's offer
    await peerConnection.setRemoteDescription(offer);

    // Record this offer's SDP origin so a later retransmission of the SAME
    // offer (client-side retry watchdog) can be reliably recognized as a
    // duplicate — see parseSdpOrigin() and the collision/dedup check above.
    conn.lastAppliedOfferOrigin = parseSdpOrigin(offer.sdp);

    // Flush any ICE candidates that arrived before this offer was applied.
    // They were buffered in handleClientCandidate() because addIceCandidate()
    // requires a remote description to succeed.
    await flushPendingCandidates(conn);

    // Create and send answer
    // NOTE: Existing tracks from other clients are added AFTER the answer,
    // because an SDP answer cannot contain more m-lines than the client's
    // offer. Adding transceivers before createAnswer() would silently drop
    // them from the answer, and the new client would never receive streams
    // from already-connected participants. Instead, we add tracks after the
    // answer and trigger a renegotiation (host-initiated offer).
    //
    // Reserved relay slots, strictly here: between the offer being applied and
    // the answer being created. The m-lines the client offered as 'recvonly'
    // become ours to send on, negotiated empty, and every participant who joins
    // later drops into one with a replaceTrack instead of a renegotiation.
    // Inert for a client that declared none (an older build, or a 1-1 call).
    claimRelaySlots(conn, offer);
    await armEmptyRelaySlots(clientAddr);

    // Pin codecs before answering: setRemoteDescription() above may have
    // created transceivers for m-lines new in the client's offer (its screen
    // share), and those have the full native codec list until pinned.
    applyCodecPreferences(peerConnection, `Host -> Client ${clientAddr} (answer)`);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // The placeholders did their job (msid + ssrc are in the answer now); empty
    // the slots again so nothing but real media ever flows through them.
    await silenceEmptyRelaySlots(clientAddr);

    // Apply video bitrate limits to video senders for this client
    applyBitrateToAllSenders(peerConnection, videoQuality).catch(() => {});

    // The answer rides ASMail with delivery confirmation that can take up to
    // its 12s timeout — none of the local work below depends on it, so the
    // send goes to the background and confirmation only drives the answer
    // retry watcher (see sendAnswerInBackground).
    clearAnswerRetry(clientAddr);
    sendAnswerInBackground(clientAddr, answer);

    clearNegotiationRetry(clientAddr);

    // Perfect Negotiation: arm the native 'negotiationneeded' handler only
    // AFTER the initial answer, so that host's local tracks (added at pc
    // creation) don't trigger a premature offer. Every further addTransceiver
    // (relay tracks, screen share) will fire this event automatically.
    armNegotiationHandler(conn);

    // Map the Host's OWN stream id to the host address, so the client can
    // identify the host's stream (its native UUID travels in SDP msid).
    sendStreamSenderInfo(clientAddr, localStream.id, ownAddr);

    // Add existing tracks from other clients to this new client's connection.
    // This ensures the new client receives streams from already-connected
    // participants. The tracks become active after renegotiation below.
    //
    // clientTracks holds EVERY track a client sent, its screen-share tracks
    // included, but those must not enter the shared VA relay stream:
    // getOrCreateRelayStream() keeps one track per kind, so a screen video
    // used to evict the camera video there. Screen tracks are told apart via
    // appliedStreamTracks (same pattern as restoreClientVaUi) and forwarded
    // separately below, under their own screen key - mirroring the isScreen
    // branch of recreateClientConnection().
    let addedExistingTracks = false;
    const screenTrackIds = new Set<string>();
    for (const applied of appliedStreamTracks.values()) {
      if (isScreenShareAddr(applied.senderAddr)) {
        for (const t of applied.tracks) {
          screenTrackIds.add(t.id);
        }
      }
    }

    for (const [sourceAddr, tracks] of clientTracks.entries()) {
      if (sourceAddr === clientAddr) {
        continue; // Don't send client's own tracks back to them
      }

      // Per kind, never per source: this is the only path by which an
      // already-present participant's media reaches a newcomer, so a source
      // skipped here is skipped for the life of this connection. See
      // kindsAlreadyForwarded for the call it cost.
      const forwarded = kindsAlreadyForwarded(conn.outgoingTrackSenders.get(sourceAddr) ?? []);
      const skippedKinds: string[] = [];

      let usedOwnTransceiver = false;
      for (const track of tracks) {
        if (screenTrackIds.has(track.id)) {
          continue; // Screen tracks are forwarded under their screen key below
        }
        if (forwarded.has(track.kind)) {
          // A re-offer, or the ontrack that overtook us mid-answer: that kind is
          // already on its way to this client on a sender of its own.
          skippedKinds.push(track.kind);
          continue;
        }
        try {
          const proxyStream = getOrCreateRelayStream(sourceAddr, track);

          // A slot first: this is the join path the whole phase is about, and
          // taking it means the client below is NOT re-offered to.
          const assigned = await assignSlot(conn, { ownerKey: sourceAddr, track, purpose: 'va' });
          const sender = assigned ? assigned.sender : addRelayTransceiver(
            peerConnection,
            track,
            proxyStream,
            `Host -> Client ${clientAddr} (existing relay)`,
          ).sender;

          // Store sender for later removal
          let senders = conn.outgoingTrackSenders.get(sourceAddr);
          if (!senders) {
            senders = [];
            conn.outgoingTrackSenders.set(sourceAddr, senders);
          }
          if (!senders.includes(sender)) {
            senders.push(sender);
          }
          // This kind is covered now, so a second track of it in the same list
          // (a stale one from a previous generation) cannot displace it.
          forwarded.add(track.kind);
          if (assigned) {
            sendStreamSenderInfo(
              clientAddr, assigned.streamId, sourceAddr, undefined, { mid: assigned.mid },
            );
          } else {
            usedOwnTransceiver = true;
            addedExistingTracks = true;
          }

          log.info(
            `join relay: ${sourceAddr}'s ${track.kind} -> ${clientAddr} on `
            + `${assigned ? `slot ${assigned.mid}` : 'a transceiver of its own (renegotiating)'}`,
          );
        } catch (err) {
          log.error(`join relay: failed to add ${sourceAddr}'s track to ${clientAddr}`, err);
        }
      }

      // The whole verdict for this source in one line: what the newcomer got,
      // and what it did not. A missing kind here is the signature of the fault
      // this path is now guarded against, and it used to be unobservable.
      log.info(
        `join relay summary: ${clientAddr} <- ${sourceAddr}: `
        + `forwarded=[${[...forwarded].join(',') || 'none'}] `
        + `skipped=[${skippedKinds.join(',') || 'none'}] `
        + `offered=[${tracks.map(t => `${t.kind}/${t.readyState}`).join(',') || 'none'}]`,
      );

      // Send stream-sender-info with the REAL (native) relay stream id,
      // which is exactly what the receiving client will see in ontrack. Slots
      // announced themselves by mid above and are not covered by this one.
      const streamForInfo = relayStreams.get(sourceAddr);
      if (usedOwnTransceiver && streamForInfo) {
        sendStreamSenderInfo(clientAddr, streamForInfo.id, sourceAddr);
      }
    }

    // Ongoing screen shares of OTHER clients, for a client that joined (or
    // re-offered) mid-share: forwarded under the screen key with a proxy
    // stream of their own, never through the VA relay.
    for (const applied of appliedStreamTracks.values()) {
      const screenAddr = applied.senderAddr;
      if (!isScreenShareAddr(screenAddr) || (applied.clientAddr === clientAddr)) {
        continue;
      }
      if (conn.outgoingTrackSenders.has(screenAddr)) {
        continue; // Already forwarding this share (re-offer case)
      }
      const liveTracks = applied.tracks.filter(t => t.readyState === 'live');
      if (liveTracks.length === 0) {
        continue;
      }
      // The cached proxy stream, never a fresh one: its id is what every other
      // viewer already knows and what resendAllStreamSenderInfo will announce
      // later. Minting one here left this client's msid diverged from the
      // mapping it gets told, so the share arrived under an id it could not
      // resolve back to a sender (same reasoning as in recreateClientConnection).
      const proxyStream = getOrCreateScreenRelayStream(screenAddr, liveTracks[0]);
      const screenTitle = clientStreamScreenNames.get(applied.stream.id)
        ?? screenAddrNames.get(screenAddr);
      let reAddedOnOwnTransceiver = false;
      for (const track of liveTracks) {
        try {
          if (!proxyStream.getTracks().includes(track)) {
            proxyStream.addTrack(track);
          }
          const assigned = await assignSlot(conn, { ownerKey: screenAddr, track, purpose: 'screen' });
          const sender = assigned ? assigned.sender : addRelayTransceiver(
            peerConnection,
            track,
            proxyStream,
            `Host -> Client ${clientAddr} (existing screen relay)`,
          ).sender;
          let senders = conn.outgoingTrackSenders.get(screenAddr);
          if (!senders) {
            senders = [];
            conn.outgoingTrackSenders.set(screenAddr, senders);
          }
          if (!senders.includes(sender)) {
            senders.push(sender);
          }
          if (assigned) {
            sendStreamSenderInfo(
              clientAddr, assigned.streamId, screenAddr, screenTitle, { mid: assigned.mid },
            );
          } else {
            reAddedOnOwnTransceiver = true;
          }
          console.log(
            `[Host] Added existing screen from ${screenAddr} to client ${clientAddr} (kind: ${track.kind})`,
          );
        } catch (err) {
          console.error(`[Host] Failed to add existing screen from ${screenAddr} to ${clientAddr}:`, err);
        }
      }
      if (reAddedOnOwnTransceiver) {
        addedExistingTracks = true;
        sendStreamSenderInfo(clientAddr, proxyStream.id, screenAddr, screenTitle);
      }
    }

    // The HOST's own ongoing screen share, for the same reason. The two loops
    // above walk clientTracks / appliedStreamTracks, which hold client media
    // exclusively - the host's own share lives only in outgoingTrackSenders
    // under its 'screen:' key. So every client whose fresh offer we answer
    // (re-offer, reconnect, or a client-side pc recreate) silently lost the
    // host's share, and only a host-driven recreateClientConnection ever put
    // it back. addTrackToClients is reused here for its same-track dedup,
    // stale-sender cleanup, mapping send and debounced renegotiation; onlyAddr
    // keeps all of that scoped to the client we are answering.
    for (const { track, mailerId, srcId, screenName } of (getOwnScreenTracks?.() ?? [])) {
      if (track.readyState === 'ended') {
        continue;
      }
      const screenAddr = buildScreenAddr(mailerId, srcId);
      await addTrackToClients({
        track,
        proxyStream: getOrCreateScreenRelayStream(screenAddr, track),
        senderKey: screenAddr,
        senderAddr: screenAddr,
        onlyAddr: clientAddr,
        screenName: screenName ?? screenAddrNames.get(screenAddr),
        logLabel: `own screen ${screenAddr} (offer catch-up)`,
      });
    }

    // Explicit renegotiation: onnegotiationneeded alone is not reliable after
    // batch addTransceiver following the initial answer (see group-call logs).
    if (addedExistingTracks) {
      scheduleNegotiateWithClient(clientAddr, 'existing tracks for new client');
    }
    console.log(
      `[Host] SDP Answer send initiated to client ${clientAddr}${addedExistingTracks ? ` (explicit renegotiation scheduled for ${clientAddr})` : ''}`,
    );
    // From the first client on, and idempotent: what this host relays is the one
    // thing a live run could never be read back from.
    startRelayMatrixLogging();
    if (isNewConnection) {
      onClientConnected(clientAddr);
    }
  }

  /**
   * Handles ICE candidate from a client.
   *
   * If the client's SDP offer has not been applied yet (no remoteDescription),
   * the candidate is buffered on the ClientConnection and flushed in
   * handleClientOffer() once setRemoteDescription() succeeds. WebRTC requires
   * a remote description before addIceCandidate() can work, so applying early
   * candidates directly only produces errors and (previously) led to them
   * being re-sent over ASMail, adding latency and inbox clutter.
   */
  async function handleClientCandidate(clientAddr: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (isClosed) {
      return;
    }
    const clientConn = clients.get(clientAddr);
    if (!clientConn) {
      // Small ASMail messages overtake the multi-KB offer routinely, so
      // candidates arriving before the ClientConnection exists are kept for
      // it instead of dropped (dropping them left ICE waiting for a re-send).
      let early = earlyClientCandidates.get(clientAddr);
      if (early && ((Date.now() - early.bufferedAt) > EARLY_CANDIDATES_TTL_MS)) {
        earlyClientCandidates.delete(clientAddr);
        early = undefined;
      }
      if (!early) {
        early = { bufferedAt: Date.now(), list: [] };
        earlyClientCandidates.set(clientAddr, early);
      }
      if (early.list.length < MAX_EARLY_CANDIDATES_PER_CLIENT) {
        early.list.push(candidate);
      }
      return;
    }

    if (!clientConn.peerConnection.remoteDescription) {
      clientConn.pendingCandidates.push(candidate);
      return;
    }

    try {
      await clientConn.peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.error(`[Host] Failed to add ICE candidate from ${clientAddr}:`, err);
    }
  }

  /**
   * Flushes ICE candidates buffered on a client connection while its SDP offer
   * had not yet been applied. Called from handleClientOffer() right after
   * setRemoteDescription() succeeds.
   */
  async function flushPendingCandidates(clientConn: ClientConnection): Promise<void> {
    if (clientConn.pendingCandidates.length === 0) {
      return;
    }
    console.log(`[Host] Flushing ${clientConn.pendingCandidates.length} buffered ICE candidate(s) from ${clientConn.clientAddr}`);
    const pending = clientConn.pendingCandidates.splice(0);
    for (const candidate of pending) {
      try {
        await clientConn.peerConnection.addIceCandidate(candidate);
      } catch (err) {
        console.error(`[Host] Failed to add buffered ICE candidate from ${clientConn.clientAddr}:`, err);
      }
    }
  }

  /**
   * Core helper: adds a track to all (or all-but-one) connected clients.
   *
   * Shared by broadcastTrackToOtherClients, broadcastScreenTrackToOtherClients
   * and addOwnScreenTrack — the three functions differ only in how they
   * construct the proxy stream and the sender key, not in the per-client
   * addTransceiver / stale-sender-cleanup / stream-sender-info logic.
   */
  async function addTrackToClients(opts: {
    track: MediaStreamTrack;
    proxyStream: MediaStream;
    senderKey: string;
    senderAddr: string;
    excludeAddr?: string;
    onlyAddr?: string;
    screenName?: string;
    logLabel: string;
  }): Promise<void> {
    if (isClosed) { return; }

    const {
      track, proxyStream, senderKey, senderAddr, excludeAddr, onlyAddr, screenName, logLabel,
    } = opts;
    const actualStreamId = proxyStream.id;
    const clientsNeedingNegotiate: string[] = [];

    // contentHint does not travel over the network, and the host re-encodes
    // what it relays - so a received screen track must be re-marked here for
    // the outgoing encoder (and for the screen bitrate profile keyed off the
    // hint in applyVideoBitrateLimit).
    if (isScreenShareAddr(senderKey) && (track.kind === 'video') && !track.contentHint) {
      track.contentHint = 'detail';
    }

    // Single choke point through which every screen share (host's own and every
    // relayed one) passes: remember the window name so resendAllStreamSenderInfo
    // can re-affirm a lost screen mapping with its title intact.
    if (isScreenShareAddr(senderAddr) && screenName) {
      screenAddrNames.set(senderAddr, screenName);
    }

    for (const [clientAddr, clientConn] of clients.entries()) {
      if (excludeAddr !== undefined && clientAddr === excludeAddr) { continue; }
      if (onlyAddr !== undefined && clientAddr !== onlyAddr) { continue; }

      try {
        const existingSenders = clientConn.outgoingTrackSenders.get(senderKey);

        // A live sender already forwarding THIS very track to this client
        // (a repeated broadcast of the same share, e.g. onClientTrackWithSender
        // followed by correctMisappliedScreen): nothing to change, and
        // removing/re-adding would only cost the viewer a spurious
        // renegotiation and a new stream id.
        // The bridged copy counts as the track itself: a slot carrying relayed
        // audio holds the local stand-in, and failing to recognise it would have
        // this repeat re-assign a slot that is already serving this very source.
        const alreadySending = existingSenders?.find(
          s => !!s.track && (track.readyState === 'live')
            && ((s.track === track) || (audioRelayBridge.originalOf(s.track) === track)),
        );
        if (alreadySending) {
          console.log(`[Host] ${logLabel} already forwarded to ${clientAddr}, skipping`);
          // The mapping still goes out: this repeat may be the one carrying a
          // window name the client never got, and a client that missed the
          // first mapping would otherwise never be told again. An identical
          // repeat is suppressed inside sendStreamSenderInfo anyway.
          const slot = slotOfSender(clientAddr, alreadySending);
          sendStreamSenderInfo(
            clientAddr, slot ? slot.stream.id : actualStreamId, senderAddr, screenName,
            slot ? { mid: slot.declaration.mid } : undefined,
          );
          continue;
        }

        // Re-join case: remove stale senders of the same kind (or with a dead
        // track) that still forward this source to the client.
        if (existingSenders) {
          for (const stale of [...existingSenders]) {
            const staleTrack = stale.track;
            if (staleTrack && (staleTrack.readyState !== 'ended') && (staleTrack.kind !== track.kind)) {
              continue;
            }
            // A slot this very source already holds is left in place: the
            // assignment below replaces its track without touching SDP, which
            // keeps the viewer on the same m-line — releasing it first could
            // migrate the source to a different slot for no reason.
            const staleSlot = slotOfSender(clientAddr, stale);
            if (staleSlot && (staleSlot.owner === senderKey)
              && (staleSlot.declaration.kind === track.kind)) {
              continue;
            }
            stopRelaySender(clientConn, stale);
            existingSenders.splice(existingSenders.indexOf(stale), 1);
            console.log(`[Host] Removed stale ${track.kind} sender for ${senderKey} -> ${clientAddr}`);
          }
        }

        // A reserved slot first, and when there is one this client is NOT
        // renegotiated with at all — the point of the whole mechanism. The old
        // transceiver-per-track path stays as the fallback: no free slot of
        // this kind, a client on an older build, or a host-first pc (recreate)
        // where the client never got to declare any.
        const assigned = await assignSlot(clientConn, {
          ownerKey: senderKey,
          track,
          purpose: isScreenShareAddr(senderKey) ? 'screen' : 'va',
        });
        const sender = assigned ? assigned.sender : addRelayTransceiver(
          clientConn.peerConnection,
          track,
          proxyStream,
          `Host -> Client ${clientAddr} (relay)`,
        ).sender;

        let senders = clientConn.outgoingTrackSenders.get(senderKey);
        if (!senders) {
          senders = [];
          clientConn.outgoingTrackSenders.set(senderKey, senders);
        }
        if (!senders.includes(sender)) {
          senders.push(sender);
        }

        console.log(
          `[Host] Added ${logLabel} to client ${clientAddr} (streamId: ${
            assigned ? assigned.streamId : actualStreamId}, kind: ${track.kind})`,
        );
        sendStreamSenderInfo(
          clientAddr, assigned ? assigned.streamId : actualStreamId, senderAddr, screenName,
          assigned ? { mid: assigned.mid } : undefined,
        );
        if (!assigned) {
          clientsNeedingNegotiate.push(clientAddr);
        }
      } catch (err) {
        console.error(`[Host] Failed to add ${logLabel} to ${clientAddr}:`, err);
      }
    }

    for (const addr of clientsNeedingNegotiate) {
      scheduleNegotiateWithClient(addr, logLabel);
    }
  }

  /**
   * SFU RETRANSMISSION: Broadcasts a VA track from one client to all others.
   */
  function broadcastTrackToOtherClients(
    sourceClientAddr: string,
    track: MediaStreamTrack,

    _originalStream: MediaStream,
  ): void {
    // Fire-and-forget by design: this is an event handler ('ontrack'), and the
    // forwarding it starts now awaits a replaceTrack per client. Failures are
    // reported inside; there is no caller to hand them to.
    void addTrackToClients({
      track,
      proxyStream: getOrCreateRelayStream(sourceClientAddr, track),
      senderKey: sourceClientAddr,
      senderAddr: sourceClientAddr,
      excludeAddr: sourceClientAddr,
      logLabel: `track from ${sourceClientAddr}`,
    });
  }

  /**
   * Broadcasts a screen share track from one client to all others.
   */
  function broadcastScreenTrackToOtherClients(
    sourceClientAddr: string,
    track: MediaStreamTrack,
    _originalStream: MediaStream,
    srcId: string,
    screenName?: string,
  ): void {
    const screenAddr = buildScreenAddr(sourceClientAddr, srcId);
    void addTrackToClients({
      track,
      proxyStream: getOrCreateScreenRelayStream(screenAddr, track),
      senderKey: screenAddr,
      senderAddr: screenAddr,
      excludeAddr: sourceClientAddr,
      screenName,
      logLabel: `screen from ${sourceClientAddr}`,
    });
  }

  /**
   * Collect screen-share addresses owned by a leaving client.
   * Sources: outgoingTrackSenders on every connection + appliedStreamTracks.
   * Idempotent / race-safe: missing maps simply yield an empty contribution.
   */
  function collectOwnedScreenAddrs(clientAddr: string): Set<string> {
    const owned = new Set<string>();

    const consider = (sourceAddr: string) => {
      // Through mayActFor, so ownership of a screen address is decided in one
      // place - and compared canonically: `===` here missed an owner whose
      // address differed only in case.
      if (isScreenShareAddr(sourceAddr) && mayActFor(clientAddr, sourceAddr)) {
        owned.add(sourceAddr);
      }
    };

    for (const [, conn] of clients.entries()) {
      for (const sourceAddr of conn.outgoingTrackSenders.keys()) {
        consider(sourceAddr);
      }
    }

    for (const applied of appliedStreamTracks.values()) {
      if (applied.clientAddr === clientAddr && isScreenShareAddr(applied.senderAddr)) {
        owned.add(applied.senderAddr);
      }
    }

    return owned;
  }

  /**
   * Removes a client and cleans up all their tracks from other connections.
   * Also sends 'participant-left' notification to all remaining clients.
   *
   * IMPORTANT: The broadcast is sent BEFORE removing the client from knownClients
   * so that the signal can reach all remaining clients.
   *
   * Screen shares (`screen:${clientAddr}:${srcId}`) are cleaned together with
   * the VA participant so abnormal exit (crash) does not leave frozen tiles.
   */
  async function removeClient(
    rawClientAddr: string,
    opts?: { notifyDropped?: boolean },
  ): Promise<void> {
    const clientAddr = clientKeyFor(rawClientAddr);
    if (opts?.notifyDropped) {
      // The host is giving up on an unreachable client: tell it so, or its
      // window keeps cycling reconnect offers into the void and, once closed
      // by hand, shows a stale state. Sent BEFORE signalingChannel.removeClient
      // drops the client from knownClients (after that no signal can reach it)
      // and fire-and-forget: its DC is dead by definition here, ASMail is
      // best-effort with a blind repeat, and the client's own reconnect cycle
      // (a fresh offer re-joins as a new client) is the other safety net.
      void Promise.resolve(signalingChannel.sendSignalToClient(clientAddr, {
        type: 'dropped',
        fromAddr: ownAddr,
        toAddr: clientAddr,
      })).catch(err => {
        console.error(`[Host] Failed to send 'dropped' to ${clientAddr}:`, err);
      });
    }
    const clientConn = clients.get(clientAddr);
    if (!clientConn) {
      // No connection record — the client never connected, or an offer-replay
      // resurrected its tile after a removal. Peers may still show it, so the
      // notification and UI cleanup must run anyway; only the PC/track work
      // has nothing to do. An early return here used to cancel the whole
      // removal and leave an eternal "about to start" tile at every peer.
      console.log(`[Host] Removing ghost client ${clientAddr} (no active connection)`);
      clearClientConnectDeadline(clientAddr);
      clearReconnectHintTimer(clientAddr);
      reconnectHintSent.delete(clientAddr);
      // The 'participant-left' below takes the tile down for everyone, so the
      // expiry has nothing left to withdraw.
      clearRejoinNotice(clientAddr);
      earlyClientCandidates.delete(clientAddr);
      try {
        await signalingChannel.broadcastSignal(
          {
            type: 'participant-left',
            fromAddr: ownAddr,
            data: { addr: clientAddr, name: clientAddr },
          },
          clientAddr,
        );
        console.log(`[Host] participant-left broadcast sent for ghost ${clientAddr}`);
      } catch (err) {
        console.error(`[Host] Failed to broadcast participant-left for ghost:`, err);
      }
      signalingChannel.removeClient(clientAddr);
      clearStreamInfoStateFor(clientAddr);
      onClientDisconnected(clientAddr);
      return;
    }

    console.log(`[Host] Removing client ${clientAddr}`);

    // Stop any pending retry watchdogs / scheduled renegotiation for this client.
    disposeNegotiationRetry(clientAddr);
    disposeAnswerRetry(clientAddr);
    clearPendingNegotiate(clientAddr);
    clearClientConnectDeadline(clientAddr);
    earlyClientCandidates.delete(clientAddr);

    // Stop any pending/sent reconnecting hint, and any standing re-join
    // announcement — the participant-left broadcast below supersedes both.
    clearReconnectHintTimer(clientAddr);
    reconnectHintSent.delete(clientAddr);
    clearRejoinNotice(clientAddr);

    // Stop PC setup (grace timer + quality monitor).
    const setup = pcSetups.get(clientAddr);
    if (setup) {
      setup.stopQualityMonitor();
      pcSetups.delete(clientAddr);
    }

    // Screen shares owned by this client (must leave with them on crash/disconnect).
    const ownedScreenAddrs = collectOwnedScreenAddrs(clientAddr);
    if (ownedScreenAddrs.size > 0) {
      console.log(
        `[Host] Client ${clientAddr} owns ${ownedScreenAddrs.size} screen share(s):`,
        [...ownedScreenAddrs],
      );
    }

    // FIRST: Notify remaining clients — screen tiles first, then VA.
    // Must happen BEFORE removing from knownClients.
    for (const screenAddr of ownedScreenAddrs) {
      try {
        await signalingChannel.broadcastSignal(
          {
            type: 'participant-left',
            fromAddr: ownAddr,
            data: { addr: screenAddr, name: screenAddr },
          },
          clientAddr,
        );
        console.log(`[Host] participant-left broadcast sent for screen ${screenAddr}`);
      } catch (err) {
        console.error(`[Host] Failed to broadcast participant-left for ${screenAddr}:`, err);
      }
      // Host UI: drop screen pseudo-participant immediately.
      if (onParticipantLeft) {
        onParticipantLeft(screenAddr);
      }
    }

    try {
      await signalingChannel.broadcastSignal(
        {
          type: 'participant-left',
          fromAddr: ownAddr,
          data: { addr: clientAddr, name: clientAddr },
        },
        clientAddr,
      );
      console.log(`[Host] participant-left broadcast sent for ${clientAddr}`);
    } catch (err) {
      console.error(`[Host] Failed to broadcast participant-left:`, err);
    }

    // Close the peer connection (this also detaches its negotiation handler)
    clientConn.peerConnection.close();
    clients.delete(clientAddr);

    // Remove from signaling channel's known clients list
    signalingChannel.removeClient(clientAddr);
    clearStreamInfoStateFor(clientAddr);
    clientRelaySlots.delete(clientAddr);
    sdpQueues.delete(clientAddr);
    sdpFreshness.delete(clientAddr);
    pcGenPeerTsBaseline.delete(clientAddr);

    // Notify about disconnection (VA tile + store cascade of any leftover screens)
    onClientDisconnected(clientAddr);

    // Remove this client's VA + screen tracks from all other connections
    const sourceAddrsToStrip = [clientAddr, ...ownedScreenAddrs];
    for (const [, otherConn] of clients.entries()) {
      for (const sourceAddr of sourceAddrsToStrip) {
        const senders = otherConn.outgoingTrackSenders.get(sourceAddr);
        if (!senders) {
          continue;
        }
        for (const sender of senders) {
          stopRelaySender(otherConn, sender);
        }
        // Belt to the per-sender braces: a slot whose bookkeeping entry was
        // lost anywhere would otherwise go on relaying a participant who left.
        releaseSlotsFor(otherConn.clientAddr, sourceAddr);
        otherConn.outgoingTrackSenders.delete(sourceAddr);
        // removeTrack() triggers 'negotiationneeded' on each affected PC; a
        // reserved slot is merely emptied and goes back into the free pool, so
        // the departed participant's m-line is what the next joiner reuses.
      }
    }

    // Clean up stored tracks and relay streams (the VA one and the cached
    // proxy of every screen this client owned)
    clientTracks.delete(clientAddr);
    revokeSentStreamInfo(relayStreams.get(clientAddr)?.id);
    relayStreams.delete(clientAddr);
    for (const screenAddr of ownedScreenAddrs) {
      revokeSentStreamInfo(screenRelayStreams.get(screenAddr)?.id);
      screenRelayStreams.delete(screenAddr);
      screenAddrNames.delete(screenAddr);
    }
    clientVaStreamIds.delete(clientAddr);
    clientVaStreams.delete(clientAddr);

    // Drop pending/applied entries belonging to this client
    for (const [streamId, pending] of [...pendingClientTracks.entries()]) {
      if (pending.clientAddr === clientAddr) {
        releasePendingTracks(streamId, `client ${clientAddr} left`);
      }
    }
    for (const [streamId, applied] of [...appliedStreamTracks.entries()]) {
      if (applied.clientAddr === clientAddr) {
        appliedStreamTracks.delete(streamId);
        clientStreamSenderMap.delete(streamId);
        clientStreamScreenNames.delete(streamId);
      }
    }

    console.log(`[Host] Client ${clientAddr} removed completely`);
  }

  /**
   * Notifies all clients that the host is ending the call.
   * Sent via the low-latency signaling DataChannel where open (fire-and-forget,
   * falls back to ASMail internally), so clients can close their call window
   * immediately instead of waiting for the ASMail 'disconnect' system message
   * or an ICE-failure timeout.
   */
  function notifyClientsOfCallEnd(): Promise<void> {
    if (isClosed) {
      return Promise.resolve();
    }
    // Settles once the broadcast is on its way (DC sends, or the ASMail
    // delivery sub-system accepted the fallbacks) — endCall() waits on it
    // (with a cap) before closeSelf(), same as the client's leave notice.
    return signalingChannel.broadcastSignal({
      type: 'disconnect',
      fromAddr: ownAddr,
    }).then(
      () => {},
      err => {
        console.error(`[Host] Failed to broadcast disconnect on call end:`, err);
      },
    );
  }

  /**
   * Closes all client connections.
   */
  function closeAll(): void {
    if (isClosed) {
      return;
    }

    void notifyClientsOfCallEnd();

    isClosed = true;
    stopRelayMatrixLogging();
    audioRelayBridge.close();
    console.log(`[Host] Closing all client connections`);

    for (const [clientAddr, clientConn] of clients.entries()) {
      disposeNegotiationRetry(clientAddr);
      disposeAnswerRetry(clientAddr);
      clearPendingNegotiate(clientAddr);
      clearReconnectHintTimer(clientAddr);
      const setup = pcSetups.get(clientAddr);
      if (setup) {
        setup.stopQualityMonitor();
      }
      clientConn.peerConnection.close();
    }

    for (const clientAddr of [...connectDeadlineTimers.keys()]) {
      clearClientConnectDeadline(clientAddr);
    }
    for (const clientAddr of [...streamInfoBatchers.keys()]) {
      clearStreamInfoStateFor(clientAddr);
    }
    earlyClientCandidates.clear();
    clientRelaySlots.clear();
    disposePlaceholders();
    pcSetups.clear();
    sdpQueues.clear();
    sdpFreshness.clear();
    pcGenPeerTsBaseline.clear();
    departures.clear();
    negotiationRetryWatchers.clear();
    answerRetryWatchers.clear();
    reconnectHintTimers.clear();
    reconnectHintSent.clear();
    // Cancelled, not merely forgotten. A re-join expiry belongs by definition
    // to a client with no connection, so the loop over `clients` above never
    // reaches it: dropping the map alone would leave the timer to fire
    // REJOIN_NOTICE_TTL_MS later and broadcast into closed channels.
    for (const clientAddr of [...rejoinNoticeTimers.keys()]) {
      clearRejoinNotice(clientAddr);
    }
    clients.clear();
    clientTracks.clear();
    relayStreams.clear();
    screenRelayStreams.clear();
    screenAddrNames.clear();
    clientVaStreamIds.clear();
    clientVaStreams.clear();
    for (const streamId of [...pendingClientTracks.keys()]) {
      releasePendingTracks(streamId, 'call is closing');
    }
    for (const streamId of [...pendingTrackTimeouts.keys()]) {
      clearPendingTrackTimeout(streamId);
    }
    pendingClientTracks.clear();
    appliedStreamTracks.clear();
    clientStreamSenderMap.clear();
    clientStreamScreenNames.clear();
    signalingChannel.close();
  }

  /**
   * Diagnostics for track attribution: how many streams are waiting for
   * 'stream-sender-info' right now, and how many were given up on without ever
   * getting it. A non-zero discarded count points at lost mappings, which is
   * what makes a participant's tile appear under a UUID instead of an address.
   */
  function getPendingTracksStats(): { bufferedStreams: number; discardedStreams: number } {
    return {
      bufferedStreams: pendingClientTracks.size,
      discardedStreams: discardedPendingStreams,
    };
  }

  /**
   * Returns the number of connected clients.
   */
  function getClientCount(): number {
    return clients.size;
  }

  /**
   * Checks if a new client can be accepted.
   * Respects MAX_CALL_PARTICIPANTS limit (includes Host).
   */
  function canAcceptNewClient(): boolean {
    // clients.size = number of clients
    // +1 for the host
    // Must be less than MAX_CALL_PARTICIPANTS
    return clients.size + 1 < MAX_CALL_PARTICIPANTS;
  }

  /**
   * Handles stream-state-changed signal from a client.
   * Updates the store and broadcasts to all other clients.
   */
  async function handleStreamStateChanged(clientAddr: string, state: StreamStateInfo): Promise<void> {
    console.log(`[Host] Stream state changed from ${clientAddr}: audio=${state.audio}, video=${state.video}`);

    // Notify the callback (use-in-calls.ts will update the store)
    if (onStreamStateChanged) {
      onStreamStateChanged(clientAddr, state);
    }

    // Broadcast to all other clients so their UI updates
    await signalingChannel.broadcastSignal(
      {
        type: 'stream-state-changed',
        fromAddr: clientAddr,
        data: state,
      },
      clientAddr,
    );
  }

  /**
   * Re-sends the offer currently pending for a client, throttled. Used when the
   * client demonstrably answered an older offer, i.e. the current one did not
   * reach it. The retry watcher is deliberately left alone: it stays as the
   * slow-path safety net, while this is the immediate, ack-driven recovery.
   */
  function resendCurrentOfferToClient(clientAddr: string, reason: string): void {
    const conn = clients.get(clientAddr);
    if (!conn || isClosed || (conn.peerConnection.signalingState !== 'have-local-offer')) {
      return;
    }
    const desc = conn.peerConnection.localDescription;
    if (!desc) {
      return;
    }
    const now = Date.now();
    const since = now - (conn.lastSupersededReofferAt ?? 0);
    // The 10s throttle exists to keep multi-KB offers from storming ASMail.
    // Over an open DC a re-send is local and cheap, and the wait is pure
    // stall: with an ASMail round trip near the throttle itself, the pair can
    // trade superseded answers without ever converging.
    const dcOpen = conn.signalingDataChannel?.readyState === 'open';
    const minInterval = dcOpen
    ? SUPERSEDED_REOFFER_MIN_INTERVAL_DC_MILLIS
    : SUPERSEDED_REOFFER_MIN_INTERVAL_MILLIS;
    if (since < minInterval) {
      console.log(
        `[Host] Skipping offer re-send to ${clientAddr} (${reason}): last one ${since}ms ago`,
      );
      return;
    }
    conn.lastSupersededReofferAt = now;
    console.log(`[Host] Re-sending current offer to ${clientAddr} now (${reason})`);
    signalingChannel.sendSignalToClient(clientAddr, {
      type: 'offer',
      fromAddr: ownAddr,
      toAddr: clientAddr,
      data: desc.toJSON(),
    }).catch(err => {
      console.error(`[Host] Failed to re-send offer to ${clientAddr}:`, err);
    });
  }

  /**
   * Handles SDP Answer from a client (for renegotiation).
   * This is called when client responds to our renegotiation offer.
   */
  async function handleClientAnswer(clientAddr: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const clientConn = clients.get(clientAddr);
    if (!clientConn || isClosed) {
      return;
    }

    const { peerConnection } = clientConn;

    // Perfect Negotiation: an answer is only valid while our own offer is
    // pending. Stale answers (duplicates / answers to superseded offers,
    // ASMail may deliver signals out of order) are silently dropped.
    if (peerConnection.signalingState !== 'have-local-offer') {
      console.debug(`[Host] Ignoring stale answer from ${clientAddr}: state is ${peerConnection.signalingState}`);
      return;
    }

    // Correlate: an answer to a superseded offer applies cleanly to a
    // recreated pc and silently pairs it with the client's dead pc generation
    // (see AnswerToRef). Absent answerTo (older peer) is accepted as before.
    const answerTo = (answer as AnswerSignalPayload).answerTo;
    if (answerTo) {
      const ownOffer = parseSdpOrigin(peerConnection.localDescription?.sdp);
      if (ownOffer && (answerTo.sessionId !== ownOffer.sessionId
        || answerTo.version !== ownOffer.version)) {
        console.warn(
          `[Host] Ignoring answer from ${clientAddr} to a superseded offer `
            + `(answerTo ${answerTo.sessionId}/${answerTo.version}, `
            + `current offer ${ownOffer.sessionId}/${ownOffer.version}); waiting for the right one`,
        );
        // The client answered an offer we have since replaced, which means it
        // never saw the current one — over ASMail that offer was very likely
        // lost or overtaken. Waiting for the retry watcher (45s, and disarmed
        // entirely once the signaling DC is open) left the pair stalled for
        // most of a minute; re-send the current offer right away instead.
        resendCurrentOfferToClient(clientAddr, 'client answered a superseded offer');
        return;
      }
    }

    console.log(`[Host] Applying renegotiation answer from ${clientAddr}`);
    await applyAnswerWithRecovery(peerConnection, answer, {
      label: `[Host] Client ${clientAddr}`,
      onRollbackReoffer: () => negotiateWithClient(clientAddr),
      onRecreate: () => recreateClientConnection(clientAddr),
    });

    // Answer applied (or recovery started) — stop the retry watchdog for this cycle.
    // If recovery re-offers, negotiateWithClient will re-arm the watcher.
    clearNegotiationRetry(clientAddr);
  }

  // Register handler for incoming signals from clients
  signalingChannel.registerClientHandler('*', (signal, authenticatedFrom) => {
    if (isClosed) { return; }

    // The channel the signal arrived on, never `signal.fromAddr`. The body is
    // written by the sender, and reading the actor out of it let a connected
    // participant name another one and have every branch below act on that
    // participant's connection (reported 2026-09-09). The channel reconciles
    // the two before calling us, so this is also what the field now holds -
    // taking the argument is what keeps the next branch from copying the old
    // pattern back in.
    const clientAddr = authenticatedFrom;

    switch (signal.type) {
      // Offers and answers of ONE client run through that client's serial
      // queue: an ASMail batch routinely delivers two, and concurrent handlers
      // sample signalingState before the other has finished mutating it (see
      // createSerialTaskQueue). Different clients stay independent.
      case 'offer':
        if (isStaleClientSdp(clientAddr, signal, 'offer')) { break; }
        sdpQueueFor(clientAddr).run(
          () => handleClientOffer(clientAddr, signal.data as RTCSessionDescriptionInit, signal.msgTs),
        ).catch(err => {
          console.error(`[Host] Unhandled error in handleClientOffer for ${clientAddr}:`, err);
          // A wrong-state error is a bookkeeping race, not a broken
          // connection — recreating on it destroys a perfectly good pc and
          // feeds the mutual-recreate loop (our fresh pc offers a new SDP
          // session, the client recreates to answer it, its offer is a new
          // session to us, and so on). With the queue above these should not
          // happen at all; if one still does, logging is the correct
          // response. Every other failure (setRemoteDescription/createAnswer/
          // setLocalDescription, the "add existing tracks" loop) does leave
          // the connection half-initialized and still warrants a recreate.
          if ((err as { name?: string })?.name === 'InvalidStateError') {
            console.warn(
              `[Host] Ignoring InvalidStateError from ${clientAddr}'s offer (signalling race, no recreate)`,
            );
            return;
          }
          recreateClientConnection(clientAddr).catch(recreateErr => {
            console.error(
              `[Host] Failed to recover connection for ${clientAddr} after offer handling error:`,
              recreateErr,
            );
          });
        });
        break;
      case 'answer':
        // Renegotiation answer from client
        if (isStaleClientSdp(clientAddr, signal, 'answer')) { break; }
        sdpQueueFor(clientAddr).run(
          () => handleClientAnswer(clientAddr, signal.data as RTCSessionDescriptionInit),
        ).catch(err => {
          console.error(`[Host] Unhandled error in handleClientAnswer for ${clientAddr}:`, err);
        });
        break;
      case 'candidates': {
        // Batched ASMail candidates: applied one by one — handleClientCandidate
        // covers both pre-offer buffers (earlyClientCandidates, per-connection
        // pendingCandidates) and catches per-item errors.
        const batch = (signal.data as CandidatesBatchPayload)?.candidates ?? [];
        console.log(`[Host] Received batch of ${batch.length} ICE candidate(s) from ${clientAddr}`);
        (async () => {
          for (const c of batch) {
            await handleClientCandidate(clientAddr, c);
          }
        })().catch(err => {
          console.error(`[Host] Unhandled error applying candidates batch from ${clientAddr}:`, err);
        });
        break;
      }
      case 'candidate':
        handleClientCandidate(clientAddr, signal.data as RTCIceCandidateInit).catch(err => {
          console.error(`[Host] Unhandled error in handleClientCandidate for ${clientAddr}:`, err);
        });
        break;
      case 'stream-state-changed':
        handleStreamStateChanged(clientAddr, signal.data as StreamStateInfo);
        break;
      case 'request-stream-info':
        console.log(`[Host] ${clientAddr} asked for stream mappings to be re-sent`);
        // Forced past the duplicate suppression: the client has just told us it
        // is missing a mapping, so a "we already sent that" skip would leave it
        // showing a raw stream id forever.
        resendAllStreamSenderInfo(clientAddr, { force: true });
        break;
      case 'stream-sender-info':
        {
          const senderInfo = signal.data as {
            streamId: string;
            senderAddr: string;
            screenName?: string;
          };
          // The actor is in the payload here, so fixing the envelope is not
          // enough: a client claiming somebody else's address for its own
          // stream would have its camera shown as that participant's tile,
          // here and on every other client (applyClientTrack →
          // broadcastTrackToOtherClients). A client may name itself and its
          // own screen shares, and nothing else.
          if (!mayActFor(clientAddr, senderInfo?.senderAddr)) {
            console.warn(
              `[Host] ${clientAddr} claims stream ${senderInfo?.streamId} belongs to `
                + `${senderInfo?.senderAddr}; ignoring`,
            );
            break;
          }
          handleClientStreamSenderInfo(
            clientAddr,
            senderInfo.streamId,
            senderInfo.senderAddr,
            senderInfo.screenName,
          );
        }
        break;
      case 'participant-left':
        {
          const participantInfo = signal.data as { addr: string; name: string };
          // Same payload-borne actor as in 'stream-sender-info' above: without
          // this a participant could announce another one's departure and have
          // the host relay it to everyone, clearing the victim's tile for the
          // whole call. Its own screen shares are the one other thing it may
          // legitimately report leaving.
          if (!mayActFor(clientAddr, participantInfo?.addr)) {
            console.warn(
              `[Host] ${clientAddr} reports ${participantInfo?.addr} as left; ignoring`,
            );
            break;
          }
          console.log(`[Host] Received participant-left from ${clientAddr}: ${participantInfo.addr}`);
          // Notify the app layer so the participant (incl. screen: pseudo-
          // participants) is removed from the host's store/UI.
          if (onParticipantLeft) {
            onParticipantLeft(participantInfo.addr);
          }
          // Relay participant-left to all other clients
          signalingChannel.broadcastSignal(
            {
              type: 'participant-left',
              fromAddr: clientAddr,
              data: participantInfo,
            },
            clientAddr,
          );
          // If it's a screen address, clean up its senders from other clients
          // and drop local attribution bookkeeping. VA tile must stay intact.
          if (isScreenShareAddr(participantInfo.addr)) {
            const screenAddr = participantInfo.addr;
            revokeSentStreamInfo(screenRelayStreams.get(screenAddr)?.id);
            screenRelayStreams.delete(screenAddr);
            screenAddrNames.delete(screenAddr);
            for (const [, cConn] of clients.entries()) {
              releaseSlotsFor(cConn.clientAddr, screenAddr);
              const existingSenders = cConn.outgoingTrackSenders.get(screenAddr);
              if (existingSenders) {
                for (const s of [...existingSenders]) {
                  stopRelaySender(cConn, s);
                }
                cConn.outgoingTrackSenders.delete(screenAddr);
                console.log(`[Host] Removed screen senders for ${screenAddr} from client connection`);
              }
            }

            for (const [streamId, applied] of [...appliedStreamTracks.entries()]) {
              if (applied.senderAddr === screenAddr) {
                appliedStreamTracks.delete(streamId);
                clientStreamSenderMap.delete(streamId);
                clientStreamScreenNames.delete(streamId);
                pendingClientTracks.delete(streamId);
                clearPendingTrackTimeout(streamId);
              }
            }

            // Ensure host UI still shows the sharer's camera after screen stop.
            restoreClientVaUi(clientAddr);
          }
        }
        break;
      case 'disconnect':
        console.log(`[Host] Received disconnect from client ${clientAddr}`);
        void removeClient(clientAddr);
        break;
    }
  });

  /**
   * Adds the host's own screen share track to all connected clients.
   * Used when the host initiates screen sharing (not a client).
   *
   * This is analogous to broadcastScreenTrackToOtherClients but the source
   * is the host itself (ownAddr), not a remote client.
   */
  function addOwnScreenTrack(
    track: MediaStreamTrack,
    _screenStream: MediaStream,
    mailerId: string,
    srcId: string,
    screenName?: string,
  ): void {
    if (isClosed) {
      return;
    }

    const screenAddr = buildScreenAddr(mailerId, srcId);
    void addTrackToClients({
      track,
      proxyStream: getOrCreateScreenRelayStream(screenAddr, track),
      senderKey: screenAddr,
      senderAddr: screenAddr,
      screenName,
      logLabel: `own screen ${screenAddr}`,
    });
  }

  /**
   * Removes host's own screen share track from all connected clients.
   * Finds sender's by key screen:${mailerId}:${srcId} and removes them.
   */
  function removeOwnScreenTrack(mailerId: string, srcId: string): void {
    if (isClosed) {
      return;
    }

    const senderKey = buildScreenAddr(mailerId, srcId);
    console.log(`[Host] Removing own screen track: ${senderKey}`);
    revokeSentStreamInfo(screenRelayStreams.get(senderKey)?.id);
    screenRelayStreams.delete(senderKey);
    screenAddrNames.delete(senderKey);

    for (const [clientAddr, clientConn] of clients.entries()) {
      releaseSlotsFor(clientAddr, senderKey);
      const senders = clientConn.outgoingTrackSenders.get(senderKey);
      if (senders) {
        for (const sender of senders) {
          stopRelaySender(clientConn, sender);
        }
        clientConn.outgoingTrackSenders.delete(senderKey);
        console.log(`[Host] Removed screen track ${senderKey} from client ${clientAddr}`);

        // Removal is signalled automatically via 'negotiationneeded'.
      }
    }

    // Notify all clients that this screen share participant has been removed
    signalingChannel
      .broadcastSignal({
        type: 'participant-left',
        fromAddr: ownAddr,
        data: { addr: senderKey, name: senderKey },
      })
      .catch(err => {
        console.error(`[Host] Failed to broadcast screen-share-removed for ${senderKey}:`, err);
      });
  }

  /**
   * Resolve an incoming client track to VA or screen-share (or buffer until
   * stream-sender-info arrives). ASMail does not guarantee that
   * stream-sender-info is processed before the SDP offer/ontrack.
   */
  function resolveIncomingClientTrack(
    clientAddr: string,
    track: MediaStreamTrack,
    stream: MediaStream,
  ): void {
    const streamId = stream.id;

    if (clientStreamSenderMap.has(streamId)) {
      const senderAddr = clientStreamSenderMap.get(streamId)!;
      console.log(`[Host] Resolved track from ${clientAddr} via stream-sender-info: ${senderAddr}`);
      applyClientTrack(clientAddr, track, stream, senderAddr);
      return;
    }

    const knownVaStreamId = clientVaStreamIds.get(clientAddr);

    // First media from this client, or more tracks on the known VA stream → VA.
    if (!knownVaStreamId || knownVaStreamId === streamId) {
      if (!knownVaStreamId) {
        clientVaStreamIds.set(clientAddr, streamId);
        clientVaStreams.set(clientAddr, stream);
      } else if (!clientVaStreams.has(clientAddr)) {
        clientVaStreams.set(clientAddr, stream);
      }
      console.log(
        `[Host] No stream-sender-info for ${streamId}, treating as VA from ${clientAddr}`,
      );
      applyClientTrack(clientAddr, track, stream, clientAddr);
      return;
    }

    // New stream.id while VA is already known — likely screen share whose
    // stream-sender-info is still in flight. Buffer; do not touch VA UI.
    console.log(
      `[Host] Buffering track streamId=${streamId} from ${clientAddr} until stream-sender-info`,
    );
    let pending = pendingClientTracks.get(streamId);
    if (!pending) {
      evictOldestPendingStreamOfClientIfNeeded(clientAddr);
      pending = { clientAddr, bufferedAt: Date.now(), tracks: [] };
      pendingClientTracks.set(streamId, pending);
    }
    if (!pending.tracks.some(p => p.track.id === track.id)) {
      pending.tracks.push({ track, stream });
    }
    schedulePendingTrackTimeout(streamId, clientAddr);
  }

  /**
   * Keeps the buffer of one client within MAX_PENDING_STREAMS_PER_CLIENT by
   * releasing its oldest entry.
   */
  function evictOldestPendingStreamOfClientIfNeeded(clientAddr: string): void {
    const ofClient = [...pendingClientTracks.entries()].filter(([, p]) => p.clientAddr === clientAddr);
    if (ofClient.length < MAX_PENDING_STREAMS_PER_CLIENT) {
      return;
    }

    ofClient.sort((a, b) => a[1].bufferedAt - b[1].bufferedAt);
    const [oldestStreamId] = ofClient[0];
    discardPendingTracks(
      oldestStreamId,
      `client ${clientAddr} has ${ofClient.length} streams buffered, over the ${MAX_PENDING_STREAMS_PER_CLIENT} limit`,
    );
  }

  /**
   * Releases buffered tracks of a stream. The tracks are stopped rather than
   * merely dropped: they are the only reference keeping a decoder alive for
   * media nobody is going to display.
   */
  function releasePendingTracks(streamId: string, reason: string): number {
    const pending = pendingClientTracks.get(streamId);
    if (!pending) {
      return 0;
    }

    pendingClientTracks.delete(streamId);
    clearPendingTrackTimeout(streamId);
    for (const { track } of pending.tracks) {
      try {
        track.stop();
      } catch (err) {
        console.warn(`[Host] Failed to stop buffered track of streamId=${streamId}:`, err);
      }
    }
    console.log(
      `[Host] Released ${pending.tracks.length} buffered track(s) of streamId=${streamId} ` +
        `from ${pending.clientAddr}: ${reason}`,
    );
    return pending.tracks.length;
  }

  /**
   * Same, for a stream whose sender never became known — an attribution failure
   * rather than routine cleanup, so it is counted and logged as an error.
   */
  function discardPendingTracks(streamId: string, reason: string): void {
    const pending = pendingClientTracks.get(streamId);
    if (!pending) {
      return;
    }

    const clientAddr = pending.clientAddr;
    const released = releasePendingTracks(streamId, reason);
    discardedPendingStreams += 1;
    console.error(
      `[Host] Gave up on ${released} track(s) of streamId=${streamId} from ${clientAddr} ` +
        `without attribution: ${reason}`,
    );
  }

  function schedulePendingTrackTimeout(streamId: string, clientAddr: string): void {
    if (pendingTrackTimeouts.has(streamId)) {
      return;
    }
    const timer = setTimeout(() => {
      pendingTrackTimeouts.delete(streamId);
      if (!pendingClientTracks.has(streamId)) {
        return;
      }
      // Still no mapping. Attribution may yet arrive, so the tracks are kept for
      // now (applying them as VA would put them on the wrong tile) — but not
      // indefinitely: the second timer gives up on them for good.
      console.warn(
        `[Host] Pending tracks for streamId=${streamId} from ${clientAddr} still waiting for stream-sender-info`,
      );
      const discardTimer = setTimeout(() => {
        pendingTrackTimeouts.delete(streamId);
        discardPendingTracks(
          streamId,
          `no stream-sender-info within ${PENDING_TRACK_DISCARD_MS}ms`,
        );
      }, PENDING_TRACK_DISCARD_MS - PENDING_TRACK_WARN_MS);
      pendingTrackTimeouts.set(streamId, discardTimer);
    }, PENDING_TRACK_WARN_MS);
    pendingTrackTimeouts.set(streamId, timer);
  }

  function clearPendingTrackTimeout(streamId: string): void {
    const timer = pendingTrackTimeouts.get(streamId);
    if (timer) {
      clearTimeout(timer);
      pendingTrackTimeouts.delete(streamId);
    }
  }

  /**
   * Apply a resolved client track to UI + SFU, recording attribution for
   * possible late-correction.
   */
  function applyClientTrack(
    clientAddr: string,
    track: MediaStreamTrack,
    stream: MediaStream,
    senderAddr: string,
  ): void {
    const streamId = stream.id;
    let entry = appliedStreamTracks.get(streamId);
    if (!entry) {
      entry = { clientAddr, senderAddr, stream, tracks: [] };
      appliedStreamTracks.set(streamId, entry);
    }
    entry.senderAddr = senderAddr;
    entry.stream = stream;
    if (!entry.tracks.includes(track)) {
      entry.tracks.push(track);
    }

    if (!isScreenShareAddr(senderAddr) && senderAddr === clientAddr) {
      if (!clientVaStreamIds.has(clientAddr)) {
        clientVaStreamIds.set(clientAddr, streamId);
      }
      if (!clientVaStreams.has(clientAddr) || clientVaStreams.get(clientAddr)?.id === streamId) {
        clientVaStreams.set(clientAddr, stream);
      }
    }

    onClientTrackWithSender(clientAddr, track, stream, senderAddr);
  }

  /**
   * Handle stream-sender-info from a client: store mapping, flush pending
   * tracks, and late-correct if the stream was already applied as VA.
   */
  function handleClientStreamSenderInfo(
    clientAddr: string,
    streamId: string,
    senderAddr: string,
    screenName?: string,
  ): void {
    console.log(`[Host] Stream sender info from ${clientAddr}: ${streamId} -> ${senderAddr}`);
    clientStreamSenderMap.set(streamId, senderAddr);
    if (screenName) {
      clientStreamScreenNames.set(streamId, screenName);
    }
    if (onStreamSenderInfo) {
      onStreamSenderInfo(streamId, senderAddr, screenName);
    }

    const pending = pendingClientTracks.get(streamId);
    if (pending) {
      pendingClientTracks.delete(streamId);
      clearPendingTrackTimeout(streamId);
      for (const p of pending.tracks) {
        applyClientTrack(pending.clientAddr, p.track, p.stream, senderAddr);
      }
      return;
    }

    const applied = appliedStreamTracks.get(streamId);
    if (applied && applied.senderAddr !== senderAddr && isScreenShareAddr(senderAddr)) {
      console.log(
        `[Host] Late-correcting stream ${streamId} from ${applied.senderAddr} to ${senderAddr}`,
      );
      correctMisappliedScreen(applied, senderAddr, screenName);
    }
  }

  /**
   * Track was applied as VA before stream-sender-info identified it as screen.
   * Move UI/SFU attribution to screen: and restore the real VA tile if possible.
   */
  function correctMisappliedScreen(
    applied: { clientAddr: string; senderAddr: string; stream: MediaStream; tracks: MediaStreamTrack[] },
    screenAddr: string,
    _screenName?: string,
  ): void {
    const { clientAddr, stream, tracks } = applied;
    const streamId = stream.id;

    applied.senderAddr = screenAddr;
    appliedStreamTracks.set(streamId, applied);

    if (clientVaStreamIds.get(clientAddr) === streamId) {
      clientVaStreamIds.delete(clientAddr);
      clientVaStreams.delete(clientAddr);
    }

    // Drop screen tracks from the VA relay stream if they were added there.
    const relay = relayStreams.get(clientAddr);
    if (relay) {
      for (const t of tracks) {
        if (relay.getTracks().includes(t)) {
          relay.removeTrack(t);
        }
      }
    }

    // Remove mis-forwarded senders under the VA key from other clients.
    for (const [otherAddr, cConn] of clients.entries()) {
      if (otherAddr === clientAddr) { continue; }
      const vaSenders = cConn.outgoingTrackSenders.get(clientAddr);
      if (!vaSenders) { continue; }
      for (const s of [...vaSenders]) {
        if (s.track && tracks.some(t => t.id === s.track?.id)) {
          stopRelaySender(cConn, s);
          const idx = vaSenders.indexOf(s);
          if (idx !== -1) { vaSenders.splice(idx, 1); }
        }
      }
    }

    const srcId = extractSrcIdFromScreenAddr(screenAddr);
    for (const t of tracks) {
      console.log(`[Host] Re-applying as SCREEN SHARE: ${screenAddr}, kind: ${t.kind}`);
      onClientTrack(screenAddr, t, stream);
      broadcastScreenTrackToOtherClients(clientAddr, t, stream, srcId);
    }

    restoreClientVaUi(clientAddr);
  }

  /**
   * Re-push the client's camera/mic stream to the host UI after a screen-share
   * mis-attribution was corrected (or when rebuilding after stop).
   */
  function restoreClientVaUi(clientAddr: string): void {
    const vaStream = clientVaStreams.get(clientAddr);
    if (vaStream) {
      const live = vaStream.getTracks().filter(t => t.readyState === 'live');
      if (live.length > 0) {
        console.log(`[Host] Restoring VA stream for ${clientAddr}`);
        onClientTrack(clientAddr, live[0], vaStream);
        return;
      }
    }

    const allTracks = clientTracks.get(clientAddr) || [];
    const screenTrackIds = new Set<string>();
    for (const applied of appliedStreamTracks.values()) {
      if (applied.clientAddr === clientAddr && isScreenShareAddr(applied.senderAddr)) {
        for (const t of applied.tracks) {
          screenTrackIds.add(t.id);
        }
      }
    }
    const vaTracks = allTracks.filter(t => t.readyState === 'live' && !screenTrackIds.has(t.id));
    if (vaTracks.length === 0) {
      return;
    }

    const rebuilt = new MediaStream(vaTracks);
    clientVaStreams.set(clientAddr, rebuilt);
    clientVaStreamIds.set(clientAddr, rebuilt.id);
    console.log(`[Host] Rebuilt VA stream for ${clientAddr} with ${vaTracks.length} track(s)`);
    onClientTrack(clientAddr, vaTracks[0], rebuilt);
  }

  /**
   * Process a client track after resolving its sender address via stream-sender-info.
   * Determines if it's screen share or VA and broadcasts accordingly.
   */
  function onClientTrackWithSender(
    trackClientAddr: string,
    track: MediaStreamTrack,
    stream: MediaStream,
    senderAddr: string,
  ): void {
    if (isScreenShareAddr(senderAddr)) {
      const srcId = extractSrcIdFromScreenAddr(senderAddr);
      const screenName = clientStreamScreenNames.get(stream.id);
      console.log(`[Host] Received SCREEN SHARE track from client ${trackClientAddr} (${senderAddr})`);
      onClientTrack(senderAddr, track, stream);
      broadcastScreenTrackToOtherClients(trackClientAddr, track, stream, srcId, screenName);
    } else {
      console.log(`[Host] Received VA track from client ${trackClientAddr} (${senderAddr})`);
      onClientTrack(senderAddr, track, stream);
      broadcastTrackToOtherClients(trackClientAddr, track, stream);
    }
  }

  return {
    announceRejoiningPeer,
    handleClientOffer,
    handleClientCandidate,
    broadcastTrackToOtherClients,
    addOwnScreenTrack,
    removeOwnScreenTrack,
    removeClient,
    isStaleClientDisconnect,
    notifyClientsOfCallEnd,
    closeAll,
    getClientCount,
    canAcceptNewClient,
    getPendingTracksStats,
  };
}
