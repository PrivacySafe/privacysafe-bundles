/*
  Copyright (C) 2026 3NSoft Inc.

  This program is free software: you can redistribute it and/or modify it under
  the terms of the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful, but
  WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
  See the GNU General Public License for more details.

  You should have received a copy of the GNU General Public License along with
  this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * WebRTC Utility Functions — shared between client and host channels.
 *
 * Extracted from the former webrtc-peer-channel.ts to reduce file size and enable reuse.
 */

import type { ConnectionStatus } from '@video/common/types/peer.types';
import type { VideoQualityConfig } from '@video/common/types/star.types';
import { getSimulcastLayerFor, SCREEN_SHARE_QUALITY } from './star-constants';
import { makeLogger } from '@shared/logger';

/**
 * Quality counters, in the log that outlives the call window.
 *
 * The rest of this file logs to `console`, which the call window takes with it
 * when it closes; these lines are the record of whether media actually moved.
 */
const log = makeLogger('CallQuality');

/**
 * The relay bridge speaks in the same lasting log, for the same reason.
 *
 * Whether the bridge was built, and what state its AudioContext is in, decides
 * whether a relayed participant is heard at all — and a suspended context is
 * silence behind counters that all look healthy. That verdict cannot live in
 * `console`, which dies with the call window.
 */
const relayLog = makeLogger('AudioRelay');

// =============================================================================
// Connection State Helpers
// =============================================================================

/**
 * Maps RTCPeerConnection state to our ConnectionStatus type.
 */
export function mapConnectionState(state: RTCPeerConnectionState): ConnectionStatus {
  switch (state) {
    case 'new':
      return 'initializing';
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'disconnected':
      return 'disconnected';
    case 'failed':
      return 'failed';
    case 'closed':
      return 'disconnected';
    default:
      return 'initializing';
  }
}

/**
 * Extracts sender address from stream ID.
 * In Star architecture, stream.id is set to the sender's address by the Host.
 */
export function extractSenderFromStream(stream: MediaStream): string {
  return stream.id;
}

// =============================================================================
// SDP Helpers
// =============================================================================

/**
 * Parses the "o=" (origin) line of an SDP to extract sessionId and version.
 * Used to deduplicate retried offers (same offer re-sent by watchdog).
 */
export function parseSdpOrigin(sdp: string | undefined): { sessionId: string; version: number } | null {
  if (!sdp) {
    return null;
  }
  const match = /^o=\S+ (\S+) (\d+) /m.exec(sdp);
  if (!match) {
    return null;
  }
  const version = Number(match[2]);
  if (Number.isNaN(version)) {
    return null;
  }
  return { sessionId: match[1], version };
}

/**
 * Per-peer freshness watermarks for SDP, kept SEPARATELY for offers and answers.
 *
 * ASMail neither orders nor deduplicates, so a superseded copy can land after a
 * newer one and must be dropped: at best it is a duplicate, at worst its
 * unfamiliar session id reads as "the peer recreated its pc" and costs a working
 * connection.
 *
 * Splitting the watermark by kind is the correction: offers and answers are
 * independent streams, and a shared high-water mark made one kill the other.
 * Observed on 2026-08-12 as `Ignoring stale answer from host: sent 6ms before the
 * newest one already processed` — the peer sent an answer and its own offer
 * milliseconds apart, ASMail reordered them, the offer raised the bar, and the
 * answer the pc was waiting for right then was thrown away, costing a 45-60s
 * retry cycle. Answers have their own, stronger correlation anyway (`answerTo`),
 * so nothing is lost by not ranking them against offers.
 *
 * `highWater()` spans all kinds and advances even on a signal reported stale: it
 * is the peer's clock as we last saw it, used as the baseline of a pc generation.
 */
export interface SdpFreshnessGate {
  isStale(kind: string, msgTs: number | undefined, describe: (behindMs: number) => string): boolean;
  highWater(): number;
}

export function createSdpFreshnessGate(): SdpFreshnessGate {
  const newestByKind = new Map<string, number>();
  let highest = 0;
  return {
    isStale(kind, msgTs, describe) {
      // No stamp: a peer on an older build, which keeps the previous behaviour.
      if (msgTs === undefined) {
        return false;
      }
      const newest = newestByKind.get(kind) ?? 0;
      if (msgTs < newest) {
        console.log(describe(newest - msgTs));
        highest = Math.max(highest, newest);
        return true;
      }
      newestByKind.set(kind, msgTs);
      highest = Math.max(highest, msgTs);
      return false;
    },
    highWater: () => highest,
  };
}

export type SdpMediaDirection = 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';

/**
 * Reads the negotiated direction of every m-line of an SDP, keyed by its mid.
 *
 * Needed because the transceiver API cannot tell apart "the peer offers a slot
 * for us to send into" from "the peer offers its own camera": a transceiver the
 * browser created from a remote offer looks identical in both cases
 * (`direction === 'recvonly'`, `currentDirection === null`). Turning the wrong
 * one into a sender silences that peer's media for the life of the connection,
 * so the direction stated in the SDP is what a relay slot claim is checked
 * against.
 *
 * Per RFC 4566 a media section with no direction attribute is `sendrecv`.
 */
export function sdpDirectionsByMid(sdp: string | undefined): Map<string, SdpMediaDirection> {
  const byMid = new Map<string, SdpMediaDirection>();
  if (!sdp) {
    return byMid;
  }
  let mid: string | undefined = undefined;
  let direction: SdpMediaDirection = 'sendrecv';
  const flush = () => {
    if (mid !== undefined) {
      byMid.set(mid, direction);
    }
  };
  for (const rawLine of sdp.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('m=')) {
      flush();
      mid = undefined;
      direction = 'sendrecv';
    } else if (line.startsWith('a=mid:')) {
      mid = line.slice('a=mid:'.length);
    } else if (line === 'a=sendrecv' || line === 'a=sendonly' || line === 'a=recvonly' || line === 'a=inactive') {
      direction = line.slice('a='.length) as SdpMediaDirection;
    }
  }
  flush();
  return byMid;
}

// =============================================================================
// ICE / Connection Recovery
// =============================================================================

/**
 * Attempts an ICE restart on the given RTCPeerConnection.
 * Returns true if restartIce() was called successfully.
 */
export function attemptIceRestart(pc: RTCPeerConnection, label: string): boolean {
  try {
    pc.restartIce();
    console.log(`[ICE Restart] ${label}: restartIce() called successfully`);
    return true;
  } catch (err) {
    console.warn(`[ICE Restart] ${label}: restartIce() failed (browser may not support it):`, err);
    return false;
  }
}

/**
 * Attempts an ICE restart AND makes sure a restart offer can actually be made.
 *
 * restartIce() only queues a 'negotiationneeded' event, and both channels'
 * negotiate paths refuse to offer unless signalingState is 'stable'. So a
 * connection stranded in 'have-local-offer' (its renegotiation offer sent but
 * never answered — the very situation a broken transport produces) would log a
 * successful restart while never generating the restart offer. Roll the
 * stranded offer back and re-negotiate; the fresh offer then carries the new
 * ICE credentials.
 */
export function attemptIceRestartWithRecovery(
  pc: RTCPeerConnection,
  label: string,
  requestRenegotiate?: () => void,
  strandedOfferAgeMillis?: () => number | null,
): void {
  if (!attemptIceRestart(pc, label)) {
    return;
  }
  if (pc.signalingState !== 'have-local-offer' || !requestRenegotiate) {
    // 'stable': the queued 'negotiationneeded' produces the restart offer on
    // its own. 'have-remote-offer': our answer completes first, and the
    // pending restart re-fires 'negotiationneeded' once back in 'stable'.
    return;
  }
  // An offer is only "stranded" once an answer can no longer reasonably be in
  // flight. Over ASMail one-way delivery runs 5-12s, so rolling back after a
  // second or two would discard an answer that is still on its way and mint a
  // competing offer — with the impolite host dropping it as a collision, that
  // is a glare generator rather than a recovery. Wait out the first slow
  // retry interval before treating the offer as lost.
  const offerAge = strandedOfferAgeMillis?.() ?? null;
  if (offerAge !== null && offerAge < STRANDED_OFFER_ROLLBACK_AGE_MILLIS) {
    console.log(
      `[ICE Restart] ${label}: local offer is only ${offerAge}ms old; leaving it in flight ` +
        `(rollback only past ${STRANDED_OFFER_ROLLBACK_AGE_MILLIS}ms)`,
    );
    return;
  }
  pc.setLocalDescription({ type: 'rollback' }).then(
    () => {
      console.log(
        `[ICE Restart] ${label}: rolled back stranded local offer to re-offer with fresh ICE credentials`,
      );
      requestRenegotiate();
    },
    err => {
      console.warn(`[ICE Restart] ${label}: rollback of stranded local offer failed:`, err);
    },
  );
}

// =============================================================================
// Quality Monitoring
// =============================================================================

/**
 * Re-sources relayed audio locally, because a remote audio track handed to
 * `replaceTrack()` sends NOTHING.
 *
 * Measured, not inferred (Suite 15, "relays a client's live audio into another
 * client's reserved slot"), on one connected pair with four audio m-lines:
 *
 *   host's own mic, ordinary m-line ......... 1012 packets
 *   LOCAL track into an emptied slot ........ 1007 packets
 *   RELAYED track into a slot, placeholder kept .. 0
 *   RELAYED track into an emptied slot ........... 0   <- what the host did
 *   RELAYED track re-sourced through here ... 1007 packets
 *
 * The track is `live` and unmuted, the m-lines are recvonly/sendonly as intended,
 * and the receiver stays `muted` for good. Slots, the placeholder and the
 * emptying step are all exonerated by the second and last rows: the one thing
 * Chromium refuses is a remote-sourced audio track as a sender's source when it
 * arrives via replaceTrack. Video has no such trouble, which is exactly why the
 * group call of 2026-08-19 could see everyone and hear only the host.
 *
 * A WebAudio graph is what breaks the provenance: the remote track feeds a source
 * node, a destination node produces a track that is locally generated as far as
 * the sender is concerned, and that one flows. One bridge per remote track, so a
 * participant relayed to five people is decoded once; the local copy is shared by
 * every sender, as local tracks always may be.
 */
export interface AudioRelayBridge {
  /**
   * A locally-sourced stand-in for `track`, created once per track. Returns the
   * track itself if it is not remote-sourced, and `null` if WebAudio is
   * unavailable — the caller then has to fall back on a renegotiated
   * transceiver, which does not go through replaceTrack and is unaffected.
   */
  localCopyOf(track: MediaStreamTrack): MediaStreamTrack | null;
  /** The remote track a local copy stands for, if this is one of ours. */
  originalOf(track: MediaStreamTrack): MediaStreamTrack | undefined;
  /** Drops the bridge for a track that ended, freeing its nodes. */
  release(track: MediaStreamTrack): void;
  /** Tears down every bridge and the shared AudioContext. */
  close(): void;
}

/**
 * Per-tick growth of a cumulative audio-energy counter, as a log field.
 *
 * `totalAudioEnergy` is the only number that separates a relayed voice from
 * relayed silence: packets flow at the same rate either way, and the momentary
 * `audioLevel` reads 0.000 through speech quiet enough to matter — measured in
 * the live run of 2026-08-20, where a whole talking window showed 2e-4 of energy
 * per 5s tick against a level that never left three zeros. Hence the exponent
 * form: 2e-4 and 1e-1 read the same way, and nothing collapses into "+0.0000",
 * which cannot be told apart from "below the printed resolution".
 *
 * `-` means the counter is absent (no inbound-rtp yet), `?` that this is the
 * first tick and there is nothing to subtract from.
 */
export function audioEnergyGrowth(now: number | undefined, before: number | undefined): string {
  if (now === undefined) {
    return '-';
  }
  return before === undefined ? '?' : `+${(now - before).toExponential(1)}`;
}

export function createAudioRelayBridge(label: string): AudioRelayBridge {
  let ctx: AudioContext | null = null;
  const bridges = new Map<
    MediaStreamTrack,
    {
      copy: MediaStreamTrack;
      source: MediaStreamAudioSourceNode;
      destination: MediaStreamAudioDestinationNode;
    }
  >();
  const originals = new Map<MediaStreamTrack, MediaStreamTrack>();

  /**
   * Every state the graph goes through, said out loud.
   *
   * A context that starts (or falls back) `suspended` produces no samples, so
   * the relayed voice is silence while packets keep flowing at the usual rate -
   * indistinguishable, in a log, from a working relay. Android's WebView holds
   * the context suspended until a user gesture, which makes these transitions
   * the first thing to read when a host there is heard by nobody.
   */
  function watchContextState(context: AudioContext): void {
    relayLog.info(`${label}: audio context created ${context.state}`);
    context.addEventListener('statechange', () => {
      relayLog.info(`${label}: audio context is ${context.state}`);
    });
  }

  function release(track: MediaStreamTrack): void {
    const bridge = bridges.get(track);
    if (!bridge) {
      return;
    }
    bridges.delete(track);
    originals.delete(bridge.copy);
    try {
      bridge.source.disconnect();
      bridge.copy.stop();
    } catch {
      // A graph already torn down by the context closing.
    }
  }

  return {
    localCopyOf(track: MediaStreamTrack): MediaStreamTrack | null {
      if (track.kind !== 'audio') {
        return track;
      }
      const existing = bridges.get(track);
      if (existing) {
        return existing.copy;
      }
      try {
        if (!ctx) {
          ctx = new AudioContext();
          watchContextState(ctx);
        }
        // Suspended by autoplay policy, the graph produces no samples at all -
        // the very failure this bridge exists to fix. Nothing to await: resuming
        // is quick and the sender tolerates the first moments being quiet.
        if (ctx.state === 'suspended') {
          void ctx
            .resume()
            .catch(err =>
              relayLog.error(
                `${label}: audio context refused to resume - relayed audio is silence ` +
                  `until a user gesture wakes it`,
                err,
              ),
            );
        }
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        const destination = ctx.createMediaStreamDestination();
        source.connect(destination);
        const copy = destination.stream.getAudioTracks()[0];
        if (!copy) {
          return null;
        }
        bridges.set(track, { copy, source, destination });
        originals.set(copy, track);
        // The bridge outlives nothing: when the relayed track ends, its graph is
        // pure overhead and its local copy is silence on somebody's m-line.
        track.addEventListener('ended', () => release(track), { once: true });
        relayLog.info(`${label}: bridged a relayed audio track (ctx ${ctx.state})`);
        return copy;
      } catch (err) {
        relayLog.error(`${label}: could not bridge a relayed audio track`, err);
        return null;
      }
    },
    originalOf(track: MediaStreamTrack): MediaStreamTrack | undefined {
      return originals.get(track);
    },
    release,
    close(): void {
      for (const track of [...bridges.keys()]) {
        release(track);
      }
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}

/**
 * Whether an `outbound-rtp` stat belongs to a sender whose track is in the given
 * set.
 *
 * Needed to tell "this sender is failing to encode" from "this sender has
 * nothing to encode" — an empty relay slot is permanently the latter, and
 * counting it as a stall made the warning fire on every tick of every call.
 *
 * The obvious test, `mediaSourceId === undefined`, does NOT work: Chromium keeps
 * reporting the id of the media source a sender used to have after
 * `replaceTrack(null)` (measured, Suite 15). What does hold is the round trip —
 * resolve the media source and check its track is one of the ids handed in.
 * A detached track fails at one step or the other.
 *
 * The set is the caller's choice of what counts, hence the parameter name: the
 * quality monitor passes encodableSenderTrackIds(), which is narrower than "has
 * a track attached".
 */
export function outboundHasLiveTrack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report: any,
  stats: RTCStatsReport,
  eligibleTrackIds: Set<string>,
): boolean {
  const sourceId = report?.mediaSourceId as string | undefined;
  if (!sourceId) {
    return false;
  }
  const source = stats.get(sourceId) as { trackIdentifier?: string } | undefined;
  return !!source?.trackIdentifier && eligibleTrackIds.has(source.trackIdentifier);
}

/**
 * Ids of tracks on this pc's senders that CAN be producing RTP right now.
 *
 * "Attached" is not the same as "expected to encode", and conflating them is
 * what made the quality monitor cry wolf. Three states are attached but silent
 * by definition, and all three are ordinary in a relaying host:
 *
 * - `readyState !== 'live'` — an `ended` track, e.g. the relay of a participant
 *   who has just left, still on the sender until renegotiation removes the slot;
 * - `muted` — a remote track that has not yet had RTP flow through it (a client
 *   that joined a moment ago), which is precisely "nothing to encode yet";
 * - `!enabled` — a participant whose camera is off.
 *
 * Each of these printed `N video sender(s) encoded no frames` on every tick,
 * dozens of times per call, drowning out the one case the warning exists for: a
 * screen share whose m-line never finished negotiating, where the track IS live,
 * unmuted and enabled and still no frames come out.
 *
 * A locally captured screen track passes all three, so the target detection is
 * untouched.
 */
export function encodableSenderTrackIds(pc: RTCPeerConnection): Set<string> {
  const ids = new Set<string>();
  for (const sender of pc.getSenders()) {
    const track = sender.track;
    if (!track?.id || track.readyState !== 'live' || track.muted || !track.enabled) {
      continue;
    }
    ids.add(track.id);
  }
  return ids;
}

/**
 * Runs periodic WebRTC getStats() quality monitoring on a peer connection.
 * Logs packet loss, RTT, jitter, and bandwidth estimates every 5 seconds.
 * Fires onQualityDegraded when packet loss exceeds 10% threshold.
 */
export function startQualityMonitor(
  pc: RTCPeerConnection,
  label: string,
  onQualityDegraded?: () => void,
): () => void {
  const INTERVAL = 5000;
  const CRITICAL_LOSS = 0.1;
  let degradedFired = false;
  // framesEncoded per outbound video ssrc from the previous tick: a live
  // video sender whose counter does not move is sending no frames - the exact
  // signature of a screen share whose m-line never finished negotiating.
  const lastFramesEncoded = new Map<number, number>();
  // The same, for audio, and it is a separate map for a plain reason: audio has
  // no frame counter, so its liveness is packetsSent. Audio was left out of this
  // monitor entirely until the group call of 2026-08-19, where the last
  // participant to join heard one of the others not at all - a relay carrying no
  // RTP, which is exactly the condition the video half of this function was
  // written to catch, on the one kind it did not watch.
  const lastAudioPacketsSent = new Map<number, number>();
  const lastAudioPacketsReceived = new Map<number, number>();
  let audioWasEncodable = new Set<number>();
  // Which ssrcs were encodable on the PREVIOUS tick. A sender is only reported
  // as stalled when it was encodable then and still is now: the frame counter of
  // the tick a track became encodable in has nothing to be compared against, and
  // counting that tick reported every camera unmute and every relay slot fill as
  // a stall. One tick of hysteresis costs 5s of detection latency on a condition
  // that lasts until renegotiation fixes it.
  let wasEncodable = new Set<number>();
  /** Sum of this peer's audio-source energy at the previous tick. */
  let lastAudioSourceEnergy: number | undefined = undefined;

  const id = setInterval(async () => {
    try {
      const stats = await pc.getStats();
      // Not "tracks attached" but "tracks that can be producing RTP": ended,
      // muted and disabled tracks are attached and silent by definition. See
      // encodableSenderTrackIds.
      const encodableTrackIds = encodableSenderTrackIds(pc);
      let totalLost = 0;
      let totalRecv = 0;
      let minRtt = Infinity;
      let maxJitter = 0;
      let outBytes = 0;
      let outFrames = 0;
      let stalledSenders = 0;
      // Outbound video senders with nothing encodable on them: empty relay
      // slots, a camera that is off, the relay of a participant who left. Not a
      // problem, but the number belongs in the log - it is what tells "quiet
      // because there is nothing to send" from "quiet and should not be".
      let idleSenders = 0;
      const encodableNow = new Set<number>();
      const audioEncodableNow = new Set<number>();
      const seenSsrcs = new Set<number>();
      const seenAudioOutSsrcs = new Set<number>();
      let audioOutPackets = 0;
      let audioInPackets = 0;
      let audioInDelta = 0;
      let silentAudioSenders = 0;
      let idleAudioSenders = 0;
      let audioReceivers = 0;
      let silentAudioReceivers = 0;
      // Energy of every audio source this peer produces: its microphone, and on
      // a host also the bridged copies of what it relays. Reported from the side
      // that generates the sound, because that is the only side where Chromium
      // fills it in - `totalAudioEnergy` on the receiving end exists only for
      // audio actually played out, so a relayed track feeding nothing but the
      // relay bridge reports zero (measured, Suite 15). Pairing this line with
      // the peer's own is what separates "nobody spoke" from "the bridge is dead".
      let audioSourceEnergy = 0;

      stats.forEach(r => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          totalLost += r.packetsLost ?? 0;
          totalRecv += (r.packetsReceived ?? 0) + (r.packetsLost ?? 0);
          if (r.jitter > maxJitter) {
            maxJitter = r.jitter;
          }
        }
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          outBytes += r.bytesSent ?? 0;
          outFrames += r.framesEncoded ?? 0;
          seenSsrcs.add(r.ssrc);
          const prev = lastFramesEncoded.get(r.ssrc);
          if (outboundHasLiveTrack(r, stats, encodableTrackIds)) {
            encodableNow.add(r.ssrc);
            if (
              wasEncodable.has(r.ssrc) &&
              prev !== undefined &&
              (r.framesEncoded ?? 0) <= prev &&
              r.active !== false
            ) {
              stalledSenders += 1;
            }
          } else {
            idleSenders += 1;
          }
          lastFramesEncoded.set(r.ssrc, r.framesEncoded ?? 0);
        }
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          audioReceivers += 1;
          const received = r.packetsReceived ?? 0;
          audioInPackets += received;
          const prev = lastAudioPacketsReceived.get(r.ssrc);
          if (prev !== undefined) {
            const delta = received - prev;
            audioInDelta += delta;
            // A receiver that had already started and then stopped: not "waiting
            // for the sender", which is what an unfilled slot looks like, but a
            // stream that went quiet with nobody reporting it.
            if (delta <= 0 && prev > 0) {
              silentAudioReceivers += 1;
            }
          }
          lastAudioPacketsReceived.set(r.ssrc, received);
        }
        if (r.type === 'outbound-rtp' && r.kind === 'audio') {
          const sent = r.packetsSent ?? 0;
          audioOutPackets += sent;
          seenAudioOutSsrcs.add(r.ssrc);
          const prev = lastAudioPacketsSent.get(r.ssrc);
          if (outboundHasLiveTrack(r, stats, encodableTrackIds)) {
            audioEncodableNow.add(r.ssrc);
            // Same hysteresis as video: the tick a track becomes encodable in has
            // no previous counter to be compared against.
            if (audioWasEncodable.has(r.ssrc) && prev !== undefined && sent <= prev && r.active !== false) {
              silentAudioSenders += 1;
            }
          } else {
            idleAudioSenders += 1;
          }
          lastAudioPacketsSent.set(r.ssrc, sent);
        }
        if (r.type === 'media-source' && r.kind === 'audio') {
          audioSourceEnergy += (r as unknown as { totalAudioEnergy?: number }).totalAudioEnergy ?? 0;
        }
        if (r.type === 'candidate-pair' && r.state === 'succeeded') {
          if (r.currentRoundTripTime && r.currentRoundTripTime < minRtt) {
            minRtt = r.currentRoundTripTime;
          }
        }
      });

      // The ssrcs of m-lines that have since been removed would otherwise sit in
      // here for the life of the call, and a recycled ssrc would be compared
      // against a stranger's frame count.
      for (const ssrc of [...lastFramesEncoded.keys()]) {
        if (!seenSsrcs.has(ssrc)) {
          lastFramesEncoded.delete(ssrc);
        }
      }
      for (const ssrc of [...lastAudioPacketsSent.keys()]) {
        if (!seenAudioOutSsrcs.has(ssrc)) {
          lastAudioPacketsSent.delete(ssrc);
        }
      }
      wasEncodable = encodableNow;
      audioWasEncodable = audioEncodableNow;

      const lossRate = totalRecv > 0 ? totalLost / totalRecv : 0;
      // Through the logger, not the console: a call window's console is gone the
      // moment the call ends, and these counters are the only record of whether
      // media actually moved (see log-relay.ts).
      log.info(
        `${label}: loss=${(lossRate * 100).toFixed(1)}% ` +
          `rtt=${minRtt !== Infinity ? Math.round(minRtt * 1000) + 'ms' : 'N/A'} ` +
          `jitter=${maxJitter.toFixed(3)}s ` +
          `out(video)=${outBytes}B/${outFrames}f idle=${idleSenders} ` +
          `audio(out)=${audioOutPackets}pkt idle=${idleAudioSenders} ` +
          `nrg=${audioEnergyGrowth(audioSourceEnergy, lastAudioSourceEnergy)} ` +
          `audio(in)=${audioInPackets}pkt/+${audioInDelta} on ${audioReceivers} receiver(s)`,
      );
      lastAudioSourceEnergy = audioSourceEnergy;
      if (stalledSenders > 0) {
        log.warn(
          `${label}: ${stalledSenders} video sender(s) encoded no frames in the last ` +
            `${INTERVAL}ms - live track with no RTP (unfinished negotiation?)`,
        );
      }
      if (silentAudioSenders > 0) {
        log.warn(
          `${label}: ${silentAudioSenders} audio sender(s) sent no packets in the last ` +
            `${INTERVAL}ms - live track with no RTP (a relay slot that never started?)`,
        );
      }
      if (silentAudioReceivers > 0) {
        log.warn(
          `${label}: ${silentAudioReceivers} audio receiver(s) that had been receiving ` +
            `got nothing in the last ${INTERVAL}ms`,
        );
      }

      if (lossRate > CRITICAL_LOSS && !degradedFired) {
        degradedFired = true;
        console.warn(`[Quality] ${label}: CRITICAL loss > ${CRITICAL_LOSS * 100}%`);
        onQualityDegraded?.();
      } else if (lossRate <= CRITICAL_LOSS / 2) {
        degradedFired = false;
      }
    } catch {
      // ignore transient stats errors
    }
  }, INTERVAL);

  return () => clearInterval(id);
}

// =============================================================================
// Diagnostic Logging
// =============================================================================

/**
 * Diagnostic helper: logs the currently selected (nominated) ICE candidate
 * pair for a peer connection via getStats().
 */
export async function logSelectedCandidatePair(pc: RTCPeerConnection, label: string): Promise<void> {
  try {
    const stats = await pc.getStats();
    let pairStats: RTCIceCandidatePairStats | undefined;

    stats.forEach(report => {
      if (report.type === 'transport') {
        const transportReport = report as RTCTransportStats;
        if (transportReport.selectedCandidatePairId) {
          const pair = stats.get(transportReport.selectedCandidatePairId);
          if (pair) {
            pairStats = pair as RTCIceCandidatePairStats;
          }
        }
      }
    });

    if (!pairStats) {
      stats.forEach(report => {
        if (report.type === 'candidate-pair') {
          const pair = report as RTCIceCandidatePairStats;
          if (pair.state === 'succeeded' && pair.nominated) {
            pairStats = pair;
          }
        }
      });
    }

    if (!pairStats) {
      console.log(`[ICE Stats] ${label}: no succeeded/nominated candidate pair found yet`);
      return;
    }

    const localCandidate = pairStats.localCandidateId ? stats.get(pairStats.localCandidateId) : undefined;
    const remoteCandidate = pairStats.remoteCandidateId ? stats.get(pairStats.remoteCandidateId) : undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const describeCandidate = (c: any): string => {
      if (!c) {
        return 'unknown';
      }
      const addr = c.address ?? c.ip ?? 'unknown-ip';
      const parts = [
        `type=${c.candidateType ?? '?'}`,
        `addr=${addr}`,
        `port=${c.port ?? '?'}`,
        `proto=${c.protocol ?? '?'}`,
      ];
      if (c.url) {
        parts.push(`server=${c.url}`);
      }
      if (c.relayProtocol) {
        parts.push(`relayProto=${c.relayProtocol}`);
      }
      return parts.join(' ');
    };

    console.log(
      `[ICE Stats] ${label}: local(${describeCandidate(localCandidate)}) <-> remote(${describeCandidate(remoteCandidate)})`,
    );
  } catch (err) {
    console.warn(`[ICE Stats] ${label}: failed to read getStats()`, err);
  }
}

/**
 * Diagnostic helper: describes a locally-gathered ICE candidate.
 */
export function describeIceCandidate(candidate: RTCIceCandidate): string {
  const type = candidate.type ?? 'unknown';
  const origin = type === 'srflx' ? 'STUN' : type === 'relay' ? 'TURN' : type === 'host' ? 'local' : 'unknown';
  const parts = [
    `origin=${origin}`,
    `type=${type}`,
    `address=${candidate.address ?? 'unknown'}`,
    `port=${candidate.port ?? 'unknown'}`,
    `protocol=${candidate.protocol ?? 'unknown'}`,
  ];
  if (candidate.relatedAddress) {
    parts.push(`relatedAddress=${candidate.relatedAddress}`);
  }
  if (candidate.relatedPort != null) {
    parts.push(`relatedPort=${candidate.relatedPort}`);
  }
  return parts.join(' ');
}

// =============================================================================
// Track diagnostics
// =============================================================================

/**
 * Logs a received track's muted state and its mute/unmute flips.
 *
 * A remote track starts muted and only unmutes when RTP actually flows, so
 * this is what tells "the track arrived but no frames ever came" (a sender
 * whose negotiation never finished - black tile) apart from "the stream was
 * never attached to the <video>". Without it the two are indistinguishable in
 * logs.
 */
export function logTrackMuteState(track: MediaStreamTrack, label: string, from: string): void {
  console.log(
    `${label}: track ${track.kind} from ${from} arrived ${track.muted ? 'MUTED (no RTP yet)' : 'unmuted'}`,
  );
  // addEventListener, never onmute/onunmute assignment: a relay slot's receiver
  // track is watched for exactly these events to learn that media started
  // flowing into it, and an assignment here would silently overwrite that
  // listener - leaving the slot's tile empty for the rest of the call.
  track.addEventListener('mute', () => {
    console.warn(`${label}: track ${track.kind} from ${from} muted (RTP stopped)`);
  });
  track.addEventListener('unmute', () => {
    console.log(`${label}: track ${track.kind} from ${from} unmuted (RTP flowing)`);
  });
}

// =============================================================================
// Bitrate / Simulcast
// =============================================================================

/**
 * Applies video bitrate and framerate limits to an RTCRtpSender.
 *
 * A sender whose track carries a 'detail'/'text' contentHint is a screen
 * share (own-screen-share.ts sets the hint before the track reaches any PC,
 * and the host re-marks relayed screen tracks): it gets the screen profile
 * and 'maintain-resolution', not the camera cap passed in - which used to
 * starve a native-resolution window capture down to the camera's 500 Kbps.
 */
export async function applyVideoBitrateLimit(sender: RTCRtpSender, quality: VideoQualityConfig): Promise<void> {
  if (!sender.track || sender.track.kind !== 'video') {
    return;
  }
  const hint = sender.track.contentHint;
  const isScreenContent = hint === 'detail' || hint === 'text';
  const effectiveQuality = isScreenContent ? SCREEN_SHARE_QUALITY : quality;
  try {
    const params = sender.getParameters();
    if (params.encodings && params.encodings.length > 0) {
      params.encodings.forEach(enc => {
        enc.maxBitrate = effectiveQuality.bitrate;
        enc.maxFramerate = effectiveQuality.framerate;
      });
      if (isScreenContent) {
        params.degradationPreference = 'maintain-resolution';
      }
      await sender.setParameters(params);
    }
  } catch (err) {
    console.warn(`[VideoBitrate] Failed to set parameters:`, err);
  }
}

/**
 * Applies video bitrate limits to all video senders in an RTCPeerConnection.
 */
export async function applyBitrateToAllSenders(pc: RTCPeerConnection, quality: VideoQualityConfig): Promise<void> {
  const senders = pc.getSenders();
  for (const sender of senders) {
    await applyVideoBitrateLimit(sender, quality).catch(() => {});
  }
}

/**
 * Applies simulcast layer selection to all video senders in an RTCPeerConnection.
 *
 * Screen-share senders are naturally exempt: they are added with a single
 * encoding, and the `length > 1` check below only touches simulcast (camera)
 * senders. Deliberate - deactivating a screen sender's only encoding would
 * stop the share.
 */
export async function applySimulcastLayers(pc: RTCPeerConnection, participantCount: number): Promise<void> {
  const activeLayer = getSimulcastLayerFor(participantCount);
  const senders = pc.getSenders();
  for (const sender of senders) {
    if (!sender.track || sender.track.kind !== 'video') {
      continue;
    }
    try {
      const params = sender.getParameters();
      if (params.encodings && params.encodings.length > 1) {
        let changed = false;
        params.encodings.forEach((enc, idx) => {
          const shouldBeActive = idx === activeLayer;
          if (enc.active !== shouldBeActive) {
            enc.active = shouldBeActive;
            changed = true;
          }
        });
        if (changed) {
          await sender.setParameters(params);
        }
      }
    } catch (err) {
      console.warn(`[Simulcast] Failed to set simulcast layers:`, err);
    }
  }
}

// =============================================================================
// Codec Preferences (collision fix)
// =============================================================================

/**
 * Applies codec preferences to all transceivers on an RTCPeerConnection to
 * eliminate payload-type (PT) codec collisions (e.g. the observed
 * "BUNDLE group contains a codec collision" for duplicate PT 49/119).
 *
 * Root cause: a codec that `getCapabilities()` lists once per profile (H265,
 * H264) gets the same payload type assigned to two of its profiles across
 * m-lines inside a BUNDLE, and the SDP is then rejected outright.
 * `RTCRtpTransceiver.setCodecPreferences()` lets us pin an explicit codec list
 * per transceiver, so only one profile of each codec is ever offered.
 *
 * Strategy — see `buildPreferredCodecs()`:
 *  - For video: VP8 (widely compatible, good for simulcast), then VP9, H264,
 *    AV1 — one entry each, matching the simulcast setup used elsewhere in the
 *    app; plus at most one RTX / RED / ULPFEC.
 *  - For audio: Opus, then G.722, PCMU, PCMA; plus at most one CN and one
 *    telephone-event.
 *  - Nothing else is offered, and if none of the preferred codecs is available
 *    the browser's own choice is left alone.
 *
 * Safe to call after transceivers are created (before or after
 * setLocalDescription). No-op on browsers without setCodecPreferences.
 *
 * @param pc - The RTCPeerConnection whose transceivers to configure.
 * @param label - Label for diagnostic logging.
 */
export function applyCodecPreferences(pc: RTCPeerConnection, label: string): void {
  const transceivers = pc.getTransceivers();
  for (const transceiver of transceivers) {
    // setCodecPreferences requires a non-stopped transceiver. The `stopped`
    // property exists at runtime but is not in the project's TS lib version,
    // so we read it defensively.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((transceiver as any).stopped) {
      continue;
    }

    // Determine the media kind. For recvonly transceivers created via
    // addTransceiver('audio'/'video') the receiver.track.kind is set even
    // before any remote track arrives. For sendonly transceivers the
    // sender.track.kind is authoritative. Fall back across both.
    const kind = transceiver.receiver.track?.kind ?? transceiver.sender.track?.kind;
    if (kind !== 'audio' && kind !== 'video') {
      continue;
    }

    const caps = RTCRtpSender.getCapabilities(kind);
    if (!caps || !caps.codecs || caps.codecs.length === 0) {
      continue;
    }

    const preferred = buildPreferredCodecs(caps.codecs, kind);
    if (preferred.length === 0) {
      continue;
    }

    try {
      transceiver.setCodecPreferences(preferred);
    } catch (err) {
      console.warn(`[CodecPrefs] ${label}: setCodecPreferences failed for ${kind} transceiver:`, err);
    }
  }
  console.log(`[CodecPrefs] ${label}: applied codec preferences to ${transceivers.length} transceiver(s)`);
}

/** Media codecs offered, best first. Anything not listed is not offered. */
const PREFERRED_VIDEO_CODECS = ['video/vp8', 'video/vp9', 'video/h264', 'video/av1'];
const PREFERRED_AUDIO_CODECS = ['audio/opus', 'audio/g722', 'audio/pcmu', 'audio/pcma'];

/** Non-media entries kept, at most one of each. */
const AUX_VIDEO_CODECS = ['video/rtx', 'video/red', 'video/ulpfec'];
const AUX_AUDIO_CODECS = ['audio/cn', 'audio/telephone-event'];

/**
 * Builds a preference-ordered list of codec capabilities for a given media
 * kind: **one entry per codec**, in the order above, plus at most one of each
 * auxiliary entry. Everything else is left out.
 *
 * One entry per codec is the whole point. `getCapabilities()` lists a codec
 * once per profile - H265 at `level-id` 186 and 180, H264 at `profile-level-id`
 * 64001f and 640034 - and handing several profiles of one codec to
 * `setCodecPreferences()` is what produces the payload-type collision this
 * function exists to prevent:
 *
 *   "A BUNDLE group contains a codec collision between
 *    {payload_type: 49, mime_type: video/H265, parameters: {level-id: 186}} and
 *    {payload_type: 49, mime_type: video/H265, parameters: {level-id: 180}}"
 *
 * The SDP carrying such a group is rejected with INVALID_PARAMETER, and the
 * failure is quiet: `applyAnswerWithRecovery()` rolls the offer back and
 * re-sends it, so the call just never connects.
 *
 * De-duplicating by (mimeType + sdpFmtpLine), as this did before, keeps every
 * profile - each is a distinct pair - which is exactly the case that breaks.
 *
 * Returns an empty list when no preferred media codec is available, so the
 * caller skips `setCodecPreferences()` and leaves the browser's own choice
 * alone rather than imposing a list of leftovers.
 */
export function buildPreferredCodecs(codecs: RTCRtpCodec[], kind: 'audio' | 'video'): RTCRtpCodec[] {
  const preferredOrder = kind === 'video' ? PREFERRED_VIDEO_CODECS : PREFERRED_AUDIO_CODECS;
  const auxOrder = kind === 'video' ? AUX_VIDEO_CODECS : AUX_AUDIO_CODECS;

  const firstOfEach = (mimeTypes: string[]) =>
    mimeTypes
      .map(wanted => codecs.find(c => (c.mimeType ?? '').toLowerCase() === wanted))
      .filter((c): c is RTCRtpCodec => !!c);

  const primary = firstOfEach(preferredOrder);
  if (primary.length === 0) {
    return [];
  }

  return [...primary, ...firstOfEach(auxOrder)];
}

// =============================================================================
// Shared Constants
// =============================================================================

/**
 * Grace period (ms) given to an RTCPeerConnection sitting in the transient
 * 'disconnected' state before we treat it as a real failure.
 *
 * Must cover a full ICE-restart offer/answer round trip over ASMail, the
 * signalling path in effect whenever the low-latency DataChannel is down
 * (and during a transport break it effectively always is, since it rides the
 * same transport). One-way ASMail delivery has been observed above 10s, so an
 * 8s grace made recovery impossible by construction: every transient
 * 'disconnected' tore the call down before the restart offer could even
 * arrive.
 */
export const DISCONNECT_GRACE_MILLIS = 30_000;

/**
 * Maximum number of RTCPeerConnection recreations per client before giving up.
 *
 * Counted per connection and reset once the connection reaches 'connected'
 * (host: on the client's pc; client: on its own pc and on every new reconnect
 * cycle), so a long call with recreations spread far apart is not penalised.
 */
export const MAX_RECREATE_COUNT = 2;

/**
 * Age (ms) a local offer must reach before an ICE restart is allowed to roll it
 * back. Matches the first slow retry delay: below it an answer over ASMail can
 * still legitimately be in flight.
 */
export const STRANDED_OFFER_ROLLBACK_AGE_MILLIS = 45_000;

/**
 * Minimum interval (ms) between the immediate "peer answered a superseded
 * offer" re-sends of our current offer. Without it, a burst of stale answers
 * (each retry of the peer's answer counts) would turn into an ASMail send
 * storm — the very thing that makes the server return 500s.
 */
export const SUPERSEDED_REOFFER_MIN_INTERVAL_MILLIS = 10_000;

/**
 * The same, for a peer reachable over an open signalling DataChannel. The
 * storm the 10s throttle guards against is an ASMail one; a DC re-send is
 * local and cheap, and waiting out a full ASMail round trip before it merely
 * prolongs a stall the re-send exists to break.
 */
export const SUPERSEDED_REOFFER_MIN_INTERVAL_DC_MILLIS = 1_000;

// =============================================================================
// Serial Task Queue
// =============================================================================

/**
 * Runs tasks strictly one after another, in submission order.
 *
 * Incoming SDP must never be processed concurrently. ASMail delivers offers in
 * batches, so two of them routinely land in the same tick; each handler awaits
 * (rollback, setRemoteDescription, createAnswer, setLocalDescription) and the
 * two interleave. The classic outcome: offer A rolls back and reaches 'stable'
 * while offer B, which sampled 'have-remote-offer' earlier, then calls
 * setLocalDescription and dies with "Called in wrong signalingState: stable".
 * On the host that exception used to be caught as a broken connection and
 * answered with a full pc recreate — a pure bookkeeping race promoted into a
 * teardown, which is exactly what feeds the mutual-recreate livelock.
 *
 * A rejected task is reported to its own caller only; the chain keeps running.
 */
export function createSerialTaskQueue(): {
  run: <T>(task: () => Promise<T>) => Promise<T>;
} {
  let tail: Promise<unknown> = Promise.resolve();

  function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    // The chain must not inherit this task's rejection, or every later task
    // would be skipped; the caller still sees it through `result`.
    tail = result.catch(() => undefined);
    return result;
  }

  return { run };
}

// =============================================================================
// Unified Retry Watcher
// =============================================================================

/**
 * Configuration for the unified retry watcher.
 * Used by both client (offer retry) and host (renegotiation retry) to avoid
 * duplicating the slow/fast retry logic.
 */
export interface RetryWatcherOptions {
  /** Label for logging */
  label: string;
  /** Max slow retry attempts */
  maxRetries: number;
  /** Slow retry delays (indexed by attempt number) */
  retryDelays: number[];
  /** Max fast retry attempts (delivery not confirmed) */
  maxFastRetries: number;
  /** Fast retry delay (ms) */
  fastRetryDelay: number;
  /** Called to check if retry should be skipped (e.g. already answered) */
  shouldSkip: () => boolean;
  /** Called to perform the actual retry (re-send the offer/description) */
  retry: () => Promise<boolean>;
  /** Called when all retries are exhausted (give up / recreate) */
  onExhausted: () => void;
  /**
   * Extra context appended to every "Scheduling retry" line, e.g.
   * `signalingState=have-local-offer connectionState=connecting leg=initial`.
   *
   * Diagnostics, but the kind without which a log of a group call is unreadable:
   * `Scheduling retry 3/3` says nothing about WHICH negotiation is retrying, and
   * an initial offer and a renegotiation offer for a screen share produce the
   * identical line. `pc.currentRemoteDescription === null` is what tells them
   * apart, and only the caller can look at the pc.
   */
  describeState?: () => string;
}

/**
 * Creates a unified retry watcher that handles both slow (watchdog) and fast
 * (delivery-not-confirmed) retry paths. Replaces the duplicated
 * scheduleOfferRetry (client) and scheduleNegotiationRetry (host) logic.
 *
 * Returns a function to (re)schedule the retry, and a clear() function.
 */
export function createRetryWatcher(opts: RetryWatcherOptions): {
  schedule: (fastRetry?: boolean) => void;
  clear: () => void;
  resetCounters: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  let fastRetryCount = 0;

  function clear(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function resetCounters(): void {
    retryCount = 0;
    fastRetryCount = 0;
  }

  function schedule(fastRetry = false): void {
    clear();

    if (opts.shouldSkip()) {
      return;
    }

    if (fastRetry && fastRetryCount >= opts.maxFastRetries) {
      console.warn(`${opts.label}: Fast retry budget exhausted, falling back to normal retry`);
      fastRetry = false;
    }

    if (!fastRetry && retryCount >= opts.maxRetries) {
      console.warn(`${opts.label}: Retry budget exhausted after ${opts.maxRetries} attempts`);
      opts.onExhausted();
      return;
    }

    const delay = fastRetry
      ? opts.fastRetryDelay
      : (opts.retryDelays[retryCount] ?? opts.retryDelays[opts.retryDelays.length - 1]);

    let state: string;
    try {
      const described = opts.describeState?.();
      state = described ? ` [${described}]` : '';
    } catch {
      // Diagnostics must never be able to cancel a retry.
      state = ' [state unavailable]';
    }
    console.log(
      fastRetry
        ? `${opts.label}: Scheduling FAST retry ${fastRetryCount + 1}/${opts.maxFastRetries} in ${delay}ms${state}`
        : `${opts.label}: Scheduling retry ${retryCount + 1}/${opts.maxRetries} in ${delay}ms${state}`,
    );

    timer = setTimeout(async () => {
      if (opts.shouldSkip()) {
        resetCounters();
        return;
      }

      if (fastRetry) {
        fastRetryCount++;
      } else {
        retryCount++;
      }

      try {
        const delivered = await opts.retry();
        schedule(!delivered);
      } catch (err) {
        console.error(`${opts.label}: Retry failed:`, err);
        schedule();
      }
    }, delay);
  }

  return { schedule, clear, resetCounters };
}

// =============================================================================
// Disconnect Grace Timer
// =============================================================================

/**
 * Creates a disconnect grace timer that gives an RTCPeerConnection a grace
 * period to recover from the transient 'disconnected' ICE state before
 * treating it as a real failure.
 *
 * Idempotent: a repeated arm() call while a timer is already pending does
 * NOT stack additional timers — the existing one runs to completion.
 *
 * Used by both client (single timer) and host (one timer per client).
 */
export function createDisconnectGraceTimer(): {
  /** Arms the timer (idempotent). The callback fires after DISCONNECT_GRACE_MILLIS. */
  arm: (onTimeout: () => void) => void;
  /** Clears any pending timer. Safe to call when no timer is armed. */
  clear: () => void;
  /** Whether a timer is currently pending. */
  isPending: () => boolean;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function arm(onTimeout: () => void): void {
    if (timer) {
      // Idempotent: a repeated 'disconnected' event does not stack
      // additional grace timers.
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      onTimeout();
    }, DISCONNECT_GRACE_MILLIS);
  }

  function clear(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function isPending(): boolean {
    return timer !== null;
  }

  return { arm, clear, isPending };
}

// =============================================================================
// Apply Answer with Recovery (rollback → re-offer → recreate)
// =============================================================================

/**
 * Applies an SDP Answer to a peer connection with a three-tier recovery
 * strategy shared by both client and host:
 *
 * 1. setRemoteDescription(answer) — the normal path.
 * 2. If that fails and we're in 'have-local-offer': rollback + re-offer.
 * 3. If re-offer also fails: recreate the entire peer connection.
 *
 * This mirrors the recovery logic previously duplicated in:
 * - client: applyAnswer() in client-channel.ts
 * - host: handleClientAnswer() in host-channel.ts
 *
 * @param pc - The RTCPeerConnection to apply the answer to.
 * @param answer - The SDP Answer to apply.
 * @param opts - Recovery callbacks.
 */
/**
 * Consecutive failed-answer count per peer connection. Keyed by the pc itself:
 * a recreated connection is a new object and starts clean, and a closed one
 * drops out with the WeakMap. Not module-level state in the caller because
 * both channels apply answers to several connections (host: one per client).
 */
const answerRecoveryFailures = new WeakMap<RTCPeerConnection, number>();

/**
 * Whether a setRemoteDescription failure is permanent for this particular peer
 * connection, i.e. retrying on the same pc can never succeed.
 */
export function isUnapplicableOnThisPc(err: unknown): boolean {
  const name = (err as Error | undefined)?.name;
  const message = String((err as Error | undefined)?.message ?? err ?? '');
  return (
    name === 'InvalidAccessError' ||
    name === 'InvalidModificationError' ||
    /ssl role/i.test(message) ||
    /m[- =]?lines?/i.test(message)
  );
}

export async function applyAnswerWithRecovery(
  pc: RTCPeerConnection,
  answer: RTCSessionDescriptionInit,
  opts: {
    /** Label for logging (e.g. `[Client ${ownAddr}]` or `[Host] Client ${addr}`) */
    label: string;
    /** Called to re-offer after a rollback (e.g. negotiate() / negotiateWithClient()). */
    onRollbackReoffer: () => Promise<void>;
    /** Called to recreate the entire peer connection when re-offer also fails. */
    onRecreate: () => Promise<void>;
  },
): Promise<void> {
  const { label, onRollbackReoffer, onRecreate } = opts;

  try {
    await pc.setRemoteDescription(answer);
    answerRecoveryFailures.delete(pc);
    console.log(`${label}: Applied SDP Answer`);
  } catch (err) {
    // The Answer did not fit our current session (e.g. out-of-order SDP
    // delivery via ASMail broke the m-line order, or the peer answered a
    // superseded offer). Without recovery, signalingState stays stuck at
    // 'have-local-offer' forever and negotiate() would silently refuse to
    // ever send another offer again (guard: `if (signalingState !== 'stable')
    // return;`), permanently stranding this connection. Roll back and
    // re-offer; if that also fails, recreate the whole peer connection.
    const failures = (answerRecoveryFailures.get(pc) ?? 0) + 1;
    answerRecoveryFailures.set(pc, failures);
    console.error(`${label}: Failed to apply Answer (failure #${failures}):`, err);
    if (isUnapplicableOnThisPc(err)) {
      // The DTLS role and the m-line topology are fixed for the lifetime of a
      // peer connection ("SSL Role can't be reversed after the session is
      // setup"). No amount of rollback + re-offer on THIS pc can make such an
      // answer apply, and the re-offer path swallows its own errors, so the
      // default first-failure branch would just mint another doomed offer.
      // Escalate straight to a recreate, which starts a fresh DTLS session.
      console.warn(
        `${label}: Answer can never apply to this pc (DTLS role / m-line mismatch); escalating to recreate`,
      );
      await onRecreate();
      return;
    }
    if (failures > 1) {
      // A second failed answer on the same pc means rollback+re-offer did not
      // converge: the peer keeps answering an SDP session that no longer
      // matches ours (e.g. its m-line topology diverged after a one-sided
      // recreate). Re-offering again would loop forever, because the re-offer
      // path swallows its own errors and so never reaches the onRecreate
      // below. Escalate to recreate directly.
      console.warn(`${label}: Answer failed twice in a row - recreating connection`);
      await onRecreate();
      return;
    }
    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setLocalDescription({ type: 'rollback' });
        console.log(`${label}: Rolled back local offer after failed Answer`);
      }
      await onRollbackReoffer();
    } catch (retryErr) {
      console.error(`${label}: Re-offer after failed Answer failed, recreating connection:`, retryErr);
      await onRecreate();
    }
  }
}
