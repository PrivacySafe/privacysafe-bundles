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
 * useWebRtcCallbacks — WebRTC event handlers for Star architecture.
 *
 * Extracted from use-in-calls.ts to keep the orchestrator thin.
 * Owns track buffering (pendingTracks) and store updates for remote media.
 */

import type { NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { useStreamsStore } from '@video/common/store/streams.store';
import type { StreamStateInfo } from '@video/common/types/star.types';
import type { ConnectionStatus } from '@video/common/types/peer.types';
import { PRE_MEDIA_STATUSES } from '@video/common/utils/connection-status-i18n';
import {
  REJOIN_NOTICE_TTL_MS, reconnectingHintEffect, type ReconnectingHintKind,
} from '@video/common/services/rejoin-notice';
import { toCanonicalAddress } from '@shared/address-utils';
import { notifyPeerLeftCall } from '@video/common/services/video-chat-service/video-chat-srv';

type StreamsStore = ReturnType<typeof useStreamsStore>;

export interface UseWebRtcCallbacksParams {
  streams: StreamsStore;
  notification: NotificationsPlugin;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (...args: any[]) => string;
  getContactName: (addr: string) => string;
  /**
   * Schedule delayed endCall after peer/app crash (1-1 any side, or group when host is lost).
   * Must be idempotent on the caller side.
   */
  onPeerCrashEndCall?: (peerAddr: string) => void;
  /**
   * Asks the host to re-send stream-id → sender-address mappings. Client side
   * only; absent on the host, which is the source of those mappings.
   */
  requestStreamMappings?: () => void;
  /**
   * Whether signalling currently rides the DataChannel rather than ASMail.
   * Paces the wait for a stream mapping to the transport that carries it: over
   * ASMail a request and its answer are 7-15s each way, so the DC-sized window
   * expires long before a reply could arrive.
   */
  isSignalingFast?: () => boolean;
}

/**
 * Delay before the client shows a "reconnecting" hint on the Host's own
 * tile, mirroring RECONNECT_HINT_DELAY_MS in host-channel.ts (kept as a
 * separate constant: this timer covers the client's own link to the Host,
 * not a signal relayed by it).
 */
const HOST_RECONNECT_HINT_DELAY_MS = 2500;

/**
 * How long a track waits for its 'stream-sender-info' before the host is asked
 * to re-send the mappings.
 *
 * The first mapping can travel over best-effort ASMail (sent right after the
 * answer, before the streamInfo DataChannel opens) and be lost; nothing else
 * retries it. One second is long enough for the normal case to resolve on its
 * own and short enough that the ask still fits inside the give-up window.
 */
const STREAM_INFO_REQUEST_MS = 1000;

/**
 * How long a buffered track waits for its mapping between two attempts to get
 * the host to re-send it, paced by the transport that carries the exchange.
 *
 * Over the DataChannel a re-send is back in milliseconds. Over ASMail the ask
 * and the mapping are 7-15s each, so a full round trip reaches 30s: the former
 * 3s window gave up before a reply could physically arrive, and the tracks were
 * discarded while perfectly alive — which is what left tiles showing "stream
 * about to start" and then nothing (2026-08-12).
 */
const STREAM_INFO_TIMEOUT_DC_MS = 3000;
const STREAM_INFO_TIMEOUT_ASMAIL_MS = 20_000;

/**
 * How long a stream that ran out of re-asks is still kept, in case a late
 * mapping arrives. Giving up on ASKING is not the same as throwing live tracks
 * away: nothing produces a second 'ontrack' for them, so a discarded track is a
 * permanently black tile. Mirrors the host's own PENDING_TRACK_DISCARD_MS, so
 * both sides forget at about the same time.
 */
const PENDING_STREAM_RETENTION_MS = 60_000;

/**
 * How many times a buffered stream re-asks for its mapping before it is
 * dropped.
 *
 * Dropped, never applied under its raw stream UUID: such a tile has no name
 * and no mute indicators ('stream-state-changed' is routed by real address),
 * and the id it was buffered under can be one the host has already retired -
 * which turned it into a ghost participant nothing ever removed.
 */
const STREAM_INFO_MAX_RETRIES = 3;

export function useWebRtcCallbacks(params: UseWebRtcCallbacksParams) {
  const {
    streams, notification, t, getContactName, onPeerCrashEndCall, requestStreamMappings,
    isSignalingFast,
  } = params;

  function streamInfoTimeoutMs(): number {
    return (isSignalingFast?.() ?? false)
      ? STREAM_INFO_TIMEOUT_DC_MS : STREAM_INFO_TIMEOUT_ASMAIL_MS;
  }

  let hostReconnectHintTimer: ReturnType<typeof setTimeout> | null = null;
  let hostReconnectHintSent = false;

  function clearHostReconnectHintTimer(): void {
    if (hostReconnectHintTimer !== null) {
      clearTimeout(hostReconnectHintTimer);
      hostReconnectHintTimer = null;
    }
  }

  /**
   * Buffer for tracks received before their stream-sender-info signal arrives.
   * Key: stream.id, Value: { tracks, stream }. Tracks accumulate here (not just
   * the first one) because audio and video of the same source can arrive as
   * separate ontrack events before sender-info resolves the address.
   */
  const pendingTracks = new Map<string, {
    tracks: MediaStreamTrack[];
    stream: MediaStream;
    /** When buffering started; bounds how long a mapping-less stream is kept. */
    bufferedAt: number;
  }>();

  /**
   * Tiles this window put up out of a re-join notice and nothing else, i.e.
   * placeholders for participants who are not in the call yet.
   *
   * Kept because 'participant-reconnecting' with `reconnecting: false` does not
   * say whether it means "the announced return expired" or "the link
   * recovered", and only the former may take a tile down. See
   * participantTileOnRejoinNotice for what each of those would cost.
   */
  const tilesFromRejoinNotice = new Set<string>();

  /**
   * Key for the set above.
   *
   * Canonical, because the addresses that reach the two ends of an entry's life
   * do not have to match character for character: one comes off a Star signal
   * (which the host built from an ASMail envelope), the other off the store,
   * which reconciles everything through keyFor(). A mismatch in case alone made
   * `delete` miss, and the leftover entry then silenced this participant's real
   * link blips for the rest of the call.
   */
  function rejoinNoticeKey(addr: string): string {
    try {
      return toCanonicalAddress(addr);
    } catch {
      // Not an address (a screen: pseudo-address, a UUID stream id) — such a
      // value is never a re-join placeholder anyway.
      return addr;
    }
  }

  /**
   * Guards against a burst of ontrack events producing a burst of identical
   * requests: one ask covers every pending stream, since the host re-sends all
   * of its mappings at once. Cleared as soon as any mapping arrives, so a later
   * drought (a screen share started mid-call, say) gets its own request.
   */
  let streamInfoRequested = false;

  function askHostForStreamMappings(): void {
    if (streamInfoRequested || !requestStreamMappings) {
      return;
    }
    streamInfoRequested = true;
    console.log(`[useInCalls] Asking host to re-send stream mappings`);
    requestStreamMappings();
  }

  /**
   * Writes a ConnectionStatus for a peer, creating the participant if needed.
   * Never downgrades an already-live tile back to a pre-media status (e.g. a
   * transient 'reconnecting' report arriving after a stream is already showing).
   */
  function applyPeerStatus(addr: string, state: ConnectionStatus): void {
    if (addr.startsWith('screen:')) {
      return;
    }
    const existing = streams.getParticipant(addr);
    if (existing?.stream && PRE_MEDIA_STATUSES.has(state)) {
      return;
    }
    streams.addRemoteParticipant(addr, getContactName(addr), state);
    streams.updateRemoteStatus(addr, state);
  }

  /**
   * Display name for a screen-share pseudo-participant: the owner's contact
   * name plus the shared window's name, when one is known (from the explicit
   * argument or from the already-received mapping).
   */
  function screenDisplayNameFor(screenAddr: string, screenName?: string): string {
    const screenOwnerAddr = screenAddr.split(':')[1] || '';
    const ownerName = getContactName(screenOwnerAddr);
    const windowName = screenName ?? streams.screenNameMap.get(screenAddr);
    return windowName ? `${ownerName} ${windowName}` : `${ownerName} screen`;
  }

  function participantDisplayName(addr: string): string {
    return addr.startsWith('screen:') ? screenDisplayNameFor(addr) : getContactName(addr);
  }

  /**
   * Merges new tracks into a participant's stream, creating the participant
   * if needed. Always hands the store a fresh MediaStream instance (one live
   * track per kind) instead of mutating an existing one in place: Vue's
   * reactivity does not observe MediaStream.addTrack, so mutating an
   * already-rendered stream leaves the <video> element's srcObject stale and
   * the new track never displays.
   */
  function mergeTracksIntoParticipant(senderAddr: string, tracks: MediaStreamTrack[]): void {
    const existing = streams.getParticipant(senderAddr);
    const merged = new Map<string, MediaStreamTrack>();

    for (const t of existing?.stream?.getTracks() ?? []) {
      if (t.readyState === 'live') {
        merged.set(t.kind, t);
      }
    }
    for (const t of tracks) {
      if (t.readyState !== 'ended') {
        merged.set(t.kind, t);
      }
    }

    const next = [...merged.values()];
    const prev = existing?.stream?.getTracks() ?? [];
    const unchanged = !!existing?.stream && prev.length === next.length && next.every(t => prev.includes(t));
    if (unchanged) {
      return;
    }

    // Every track handed over was already ended and there is nothing on the
    // tile to keep: creating the participant here would only add an empty tile
    // that never fills. Tearing an existing one down is not our call either -
    // that belongs to participant-left.
    if (next.length === 0) {
      console.warn(`[useInCalls] No live track for ${senderAddr}; not creating an empty tile`);
      return;
    }

    streams.addRemoteParticipant(senderAddr, participantDisplayName(senderAddr));
    streams.updateRemoteStream(senderAddr, new MediaStream(next));
    // Media makes the tile real: whatever it started as, it is no longer a
    // placeholder a re-join expiry may take down.
    tilesFromRejoinNotice.delete(rejoinNoticeKey(senderAddr));
    console.log(`[useInCalls] Participant ${senderAddr} stream updated: kinds=[${next.map(t => t.kind)}]`);
  }

  /**
   * Called when a remote track is received from Host (Client side).
   */
  function handleRemoteTrack(track: MediaStreamTrack, stream: MediaStream, fromAddr: string) {
    const resolvedAddr = streams.resolveStreamSender(fromAddr);
    const effectiveAddr = resolvedAddr !== fromAddr ? resolvedAddr : fromAddr;

    const isScreenShare = effectiveAddr.startsWith('screen:');

    if (isScreenShare) {
      console.log(`[useInCalls] Remote SCREEN SHARE track from ${effectiveAddr}, kind: ${track.kind}`);
      // Merge rather than replace: replacing the whole stream on every
      // ontrack wiped the other kind (desktop audio vs video) and used to
      // create the participant with `name = addr` before addRemoteParticipant
      // could give it a proper one. Merge creates the participant first, with
      // the screen display name, and hands the store a fresh MediaStream.
      mergeTracksIntoParticipant(effectiveAddr, [track]);
      return;
    }

    const isUuidStreamId = effectiveAddr.length === 36 && effectiveAddr.includes('-');

    if (!isUuidStreamId && effectiveAddr.includes('@')) {
      console.log(
        `[useInCalls] Remote VA track from ${effectiveAddr} (stream.id is real address), kind: ${track.kind}`,
      );
      mergeTracksIntoParticipant(effectiveAddr, [track]);
      return;
    }

    const existingPending = pendingTracks.get(fromAddr);
    if (existingPending) {
      console.log(`[useInCalls] Added ${track.kind} track to pending stream ${fromAddr}`);
      existingPending.stream.addTrack(track);
      existingPending.tracks.push(track);
      return;
    }

    console.log(
      `[useInCalls] Buffering track (stream.id: ${fromAddr}), kind: ${track.kind} - waiting for stream-sender-info`,
    );
    pendingTracks.set(fromAddr, { tracks: [track], stream, bufferedAt: Date.now() });

    // Arrival of the mapping drains this buffer on its own, in
    // handleStreamSenderInfo() - both timers then simply find nothing to do.
    setTimeout(() => {
      if (pendingTracks.has(fromAddr)) {
        askHostForStreamMappings();
      }
    }, STREAM_INFO_REQUEST_MS);

    schedulePendingStreamResolve(fromAddr, 0);
  }

  /**
   * A relay slot's track no longer belongs to `fromAddr` (Client side).
   *
   * Only reserved slots produce this: their m-line is negotiated once and its
   * stream id never changes, so a reassignment arrives as a mapping naming a new
   * owner and nothing else. Without taking the track off the previous tile the
   * same media would show under two participants at once.
   *
   * The tile itself is left standing when nothing else remains on it: removing a
   * participant is 'participant-left'’s decision, and in the ordinary case
   * (someone left and their slot was handed on) that signal is already on its way.
   */
  function handleRemoteTrackDetached(track: MediaStreamTrack, fromAddr: string): void {
    const existing = streams.getParticipant(fromAddr);
    const remaining = (existing?.stream?.getTracks() ?? [])
    .filter(t => (t !== track) && (t.readyState === 'live'));
    if (!existing?.stream || (remaining.length === existing.stream.getTracks().length)) {
      return;
    }
    console.log(
      `[useInCalls] Track ${track.kind} no longer belongs to ${fromAddr} `
      + `(${remaining.length} track(s) left on the tile)`,
    );
    if (remaining.length === 0) {
      return;
    }
    streams.updateRemoteStream(fromAddr, new MediaStream(remaining));
  }

  /**
   * Waits for a buffered stream's mapping, re-asking the host between
   * attempts and giving up after STREAM_INFO_MAX_RETRIES.
   */
  function schedulePendingStreamResolve(streamId: string, attempt: number): void {
    setTimeout(() => {
      const pending = pendingTracks.get(streamId);
      if (!pending) {
        return;
      }

      const resolved = streams.resolveStreamSender(streamId);
      if (resolved !== streamId) {
        pendingTracks.delete(streamId);
        console.log(`[useInCalls] Resolved pending track (stream.id: ${streamId}) after retry -> ${resolved}`);
        mergeTracksIntoParticipant(resolved, pending.tracks);
        return;
      }

      pending.tracks = pending.tracks.filter(t => t.readyState !== 'ended');
      if (pending.tracks.length === 0) {
        pendingTracks.delete(streamId);
        console.log(`[useInCalls] Dropped pending stream ${streamId}: its tracks ended before a mapping arrived`);
        return;
      }

      if (attempt >= STREAM_INFO_MAX_RETRIES) {
        // Stop ASKING, but keep the tracks: a mapping that arrives late still
        // finds them (handleStreamSenderInfo drains this buffer), whereas a
        // discarded track never comes back — there is no second 'ontrack'.
        if (Date.now() - pending.bufferedAt > PENDING_STREAM_RETENTION_MS) {
          pendingTracks.delete(streamId);
          console.warn(
            `[useInCalls] Gave up on stream ${streamId} after ${attempt + 1} attempt(s) `
            + `and ${PENDING_STREAM_RETENTION_MS}ms waiting for stream-sender-info`,
          );
          return;
        }
        schedulePendingStreamResolve(streamId, attempt + 1);
        return;
      }

      // A mapping for some other stream clears this flag when it arrives, so
      // reset it explicitly: otherwise the guard would swallow this retry.
      streamInfoRequested = false;
      askHostForStreamMappings();
      schedulePendingStreamResolve(streamId, attempt + 1);
    }, streamInfoTimeoutMs());
  }

  /**
   * Called when a track is received from a client (Host side).
   */
  function handleClientTrack(clientAddr: string, track: MediaStreamTrack, stream: MediaStream) {
    const isScreenShare = clientAddr.startsWith('screen:');

    if (isScreenShare) {
      console.log(`[useInCalls] Client SCREEN SHARE track from ${clientAddr}, kind: ${track.kind}`);
      // Same merge semantics as the client side (see handleRemoteTrack).
      mergeTracksIntoParticipant(clientAddr, [track]);
    } else {
      console.log(`[useInCalls] Client track from ${clientAddr}, kind: ${track.kind}`);

      // Keep an existing live VA stream if a different stream object arrives
      // (defensive: screen mis-attribution must not permanently replace camera).
      const existing = streams.remoteParticipants.get(clientAddr);
      if (existing?.stream && existing.stream.id !== stream.id) {
        const existingLive = existing.stream.getTracks().filter(t => t.readyState === 'live');
        if (existingLive.length > 0 && !existing.stream.getTracks().includes(track)) {
          // Prefer keeping the established VA stream; only attach if same stream.
          // New stream with replacement tracks (renegotiation) still wins when old is dead.
          if (stream.getTracks().some(t => t.readyState === 'live')) {
            // If the new stream looks like a single video-only add while VA lives,
            // do not replace — host-channel should attribute screen separately.
            const onlyNewVideo =
              stream.getVideoTracks().length > 0 &&
              stream.getAudioTracks().length === 0 &&
              existing.stream.getVideoTracks().some(t => t.readyState === 'live');
            if (onlyNewVideo) {
              console.warn(
                `[useInCalls] Ignoring VA stream replace for ${clientAddr}: likely unmapped screen track`,
              );
              return;
            }
          }
        }
      }

      streams.updateRemoteStream(clientAddr, stream);
    }
  }

  /**
   * Called when a client connects to the Host.
   */
  function handleClientConnected(clientAddr: string): void {
    // Fired when the client's FIRST offer was parsed and answered — a
    // signaling milestone, not connectivity. The honest 'connected' status
    // arrives via handleClientConnectionStateChange from the real
    // RTCPeerConnection state.
    console.log(`[useInCalls] Client negotiating (first offer answered): ${clientAddr}`);
    const clientName = getContactName(clientAddr);
    streams.addRemoteParticipant(clientAddr, clientName);
    applyPeerStatus(clientAddr, 'establishing');

    const signalingChannel = streams.hostSignalingChannel;
    if (signalingChannel) {
      for (const [addr, participant] of streams.remoteParticipants.entries()) {
        if (addr === clientAddr) { continue; }
        // Skip peers without media yet (e.g. seeded 'invited' roster entries) —
        // otherwise the new client is told a fabricated mic/cam state for them.
        if (!participant.stream) { continue; }

        const state = {
          audio: !participant.audioMuted,
          video: !participant.videoMuted,
        };

        signalingChannel
          .sendSignalToClient(clientAddr, {
            type: 'stream-state-changed',
            fromAddr: addr,
            toAddr: clientAddr,
            data: state,
          })
          .catch((err: unknown) => {
            console.error(`[useInCalls] Failed to send initial stream state to ${clientAddr}:`, err);
          });

        console.log(`[useInCalls] Sent initial stream state of ${addr} to new client ${clientAddr}`);
      }

      const newClientState = {
        audio: streams.isMicOn,
        video: streams.isCamOn,
      };

      signalingChannel
        .broadcastSignal(
          {
            type: 'stream-state-changed',
            fromAddr: clientAddr,
            data: newClientState,
          },
          clientAddr,
        )
        .catch((err: unknown) => {
          console.error(`[useInCalls] Failed to broadcast new client state:`, err);
        });

      console.log(`[useInCalls] Broadcasted new client ${clientAddr} state to all others`);
    }
  }

  /**
   * Called when a client disconnects from the Host (grace timeout / removeClient).
   * Group: notice + VA tile already removed; call continues.
   * 1-1: notice + delayed endCall via onPeerCrashEndCall.
   */
  function handleClientDisconnected(clientAddr: string): void {
    console.log(`[useInCalls] Client disconnected: ${clientAddr}`);
    const displayName = getContactName(clientAddr);
    streams.removeRemoteParticipant(clientAddr);

    if (streams.isGroupChat) {
      // Tell our own background service right away, so the departed client
      // gets its re-join heartbeat without waiting for the ASMail
      // 'disconnect' leg. This is the single funnel for every removal path
      // (in-band 'disconnect', signaling channel close, grace timeout).
      notifyPeerLeftCall(clientAddr);
      notification.$createNotice({
        type: 'info',
        content: t('va.text.user_left_call', { user: displayName }),
      });
      return;
    }

    notification.$createNotice({
      type: 'info',
      content: t('va.text.peer_app_closed', { user: displayName }),
    });
    onPeerCrashEndCall?.(clientAddr);
  }

  /**
   * Called when the client's connection state to Host changes.
   * Only 'failed' ends the call path at UI level; 'disconnected' is transient.
   * failed = host link dead → 1-1 and group: notice + delayed endCall (no host ⇒ no call).
   */
  function handleConnectionStateChange(state: ConnectionStatus) {
    console.log(`[useInCalls] Connection state changed: ${state}`);
    streams.updateClientConnectionStatus(state);

    // The client's single PeerConnection IS the link to the host, so its
    // state doubles as the host's own tile status in the connecting banner.
    const hostAddr = streams.hostAddress;
    if (hostAddr && state !== 'failed') {
      applyPeerStatus(hostAddr, state);
    }

    if (state === 'failed') {
      clearHostReconnectHintTimer();
      hostReconnectHintSent = false;
      console.warn('[useInCalls] Host connection lost — clearing remote tiles and scheduling end');
      const hostAddr = streams.hostAddress || 'host';
      const displayName = getContactName(hostAddr);
      // Drop all remote participants so UI does not keep a frozen last frame
      // from host (or peers) after the PeerConnection is dead.
      streams.clearRemoteParticipantsOnLinkFailure();
      notification.$createNotice({
        type: 'info',
        content: t('va.text.peer_app_closed', { user: displayName }),
      });
      onPeerCrashEndCall?.(hostAddr);
      return;
    }

    // Two-phase network-blip hint for the Host's own tile: the client cannot
    // rely on a host-relayed 'participant-reconnecting' signal for its own
    // link, so it arms the same delay locally.
    if (hostAddr) {
      if (state === 'reconnecting') {
        if (hostReconnectHintTimer === null) {
          hostReconnectHintTimer = setTimeout(() => {
            hostReconnectHintTimer = null;
            hostReconnectHintSent = true;
            streams.setParticipantReconnecting(hostAddr, true);
          }, HOST_RECONNECT_HINT_DELAY_MS);
        }
      } else {
        clearHostReconnectHintTimer();
        if (hostReconnectHintSent) {
          hostReconnectHintSent = false;
          streams.setParticipantReconnecting(hostAddr, false);
        }
      }
    }
  }

  /**
   * Called when a client's stream state (mic/cam) changes (Host side).
   */
  function handleStreamStateChanged(clientAddr: string, state: StreamStateInfo) {
    console.log(
      `[useInCalls] Stream state changed from ${clientAddr}: audio=${state.audio}, video=${state.video}`,
    );
    streams.updateParticipantStreamState(clientAddr, state);
  }

  /**
   * Called when a remote participant's stream state changes (Client side).
   */
  function handleRemoteStreamStateChanged(fromAddr: string, state: StreamStateInfo) {
    console.log(`[useInCalls] Remote stream state from ${fromAddr}: audio=${state.audio}, video=${state.video}`);
    streams.updateParticipantStreamState(fromAddr, state);
  }

  /**
   * Called when stream sender info is received from Host (Client side)
   * or from a client on the Host side (screen-share mapping).
   */
  function handleStreamSenderInfo(streamId: string, senderAddr: string, screenName?: string) {
    console.log(`[useInCalls] Stream sender info: ${streamId} -> ${senderAddr} (screen: ${screenName || 'N/A'})`);
    streams.updateStreamSenderMapping(streamId, senderAddr, screenName);
    streamInfoRequested = false;

    const isScreenShare = senderAddr.startsWith('screen:');

    const pending = pendingTracks.get(streamId);
    if (pending) {
      pendingTracks.delete(streamId);
      console.log(`[useInCalls] Processing buffered tracks for ${senderAddr} (was ${streamId})`);
      // The mapping above already recorded the screen name, so the merge
      // names a screen participant correctly - one path for VA and screen.
      mergeTracksIntoParticipant(senderAddr, pending.tracks);
      return;
    }

    // updateStreamSenderMapping may already have re-keyed UUID → senderAddr.
    // Ensure screen participants get a proper display name.
    if (isScreenShare) {
      const existing = streams.remoteParticipants.get(senderAddr);
      if (existing) {
        existing.name = screenDisplayNameFor(senderAddr, screenName);
      }
    }
  }

  /**
   * Called when a participant leaves the call (Client side / Host relay).
   */
  function handleParticipantLeft(participantAddr: string) {
    console.log(`[useInCalls] Participant left: ${participantAddr}`);

    // Drop anything still buffered for the departing source before the store
    // forgets its mappings. Left in place, such an entry keeps retrying for a
    // stream that is never coming back, and its tracks are dead anyway.
    for (const [streamId, pending] of [...pendingTracks.entries()]) {
      const belongsToLeaver = streams.resolveStreamSender(streamId) === participantAddr;
      if (belongsToLeaver || pending.tracks.every(t => t.readyState === 'ended')) {
        pendingTracks.delete(streamId);
        console.log(`[useInCalls] Dropped pending stream ${streamId} of departing ${participantAddr}`);
      }
    }

    streams.removeRemoteParticipant(participantAddr);
    // Their tile is gone whatever put it there; a stale entry would make the
    // next tile for this address removable by a hint that has nothing to do
    // with a re-join.
    tilesFromRejoinNotice.delete(rejoinNoticeKey(participantAddr));

    const isScreenShare = participantAddr.startsWith('screen:');
    if (isScreenShare) {
      const parts = participantAddr.split(':');
      const screenOwnerAddr = parts[1] || '';
      const screenName = streams.screenNameMap.get(participantAddr) || '';
      const cleanAddr = screenOwnerAddr.split('@')[0] || screenOwnerAddr;
      notification.$createNotice({
        type: 'info',
        content: t('va.text.user_stopped_sharing', { user: cleanAddr, screen: screenName }),
      });
    } else {
      notification.$createNotice({
        type: 'info',
        content: t('va.text.user_left_call', { user: getContactName(participantAddr) }),
      });
    }
  }

  /**
   * Called when a participant's transient link status changes — either a
   * 'participant-reconnecting' signal relayed by the Host (Client side) or
   * the Host's own onParticipantReconnecting callback for its UI (Host side).
   * Ignores screen: pseudo-participants, which have no independent link.
   *
   * Two cases ride this signal (see ParticipantReconnectingInfo), and `kind`
   * says which one this is. What each does is a table in reconnectingHintEffect
   * — deliberately not derived from this window's own state, which is how a
   * returning participant's live video came to sit under a "reconnecting" blur.
   */
  function handleParticipantReconnecting(
    addr: string, reconnecting: boolean, kind?: ReconnectingHintKind,
  ): void {
    if (addr.startsWith('screen:')) {
      return;
    }
    const noticeKey = rejoinNoticeKey(addr);
    const participant = streams.getParticipant(addr);
    const effect = reconnectingHintEffect({
      kind,
      reconnecting,
      existing: participant
        ? {
            hasStream: !!participant.stream,
            fromRejoinNotice: tilesFromRejoinNotice.has(noticeKey),
          }
        : undefined,
    });

    if (effect.setsReconnectingFlag) {
      streams.setParticipantReconnecting(addr, reconnecting);
    }

    const tileAction = effect.tile;
    if (tileAction === 'create-connecting') {
      tilesFromRejoinNotice.add(noticeKey);
      // 'connecting', not 'reconnecting': the text is the right one for someone
      // on their way in ("{user} is connecting to the call…" against
      // "Reconnecting to {user}…", which is about OUR link to them), and it is
      // in PRE_MEDIA_STATUSES, so applyPeerStatus refuses to write it over a
      // participant who is already in the call by the time this lands. A notice
      // that may arrive late wants a status that defends itself.
      console.log(`[useInCalls] ${addr} is on its way back into the call`);
      applyPeerStatus(addr, 'connecting');
    } else if (tileAction === 'remove') {
      console.log(`[useInCalls] ${addr} never came back — dropping its placeholder tile`);
      tilesFromRejoinNotice.delete(noticeKey);
      streams.removeRemoteParticipant(addr);
    }
  }

  /**
   * Called when a client's ConnectionStatus changes before its track has
   * arrived (Host side) — reported via host-channel's onClientConnectionStateChange.
   */
  function handleClientConnectionStateChange(clientAddr: string, state: ConnectionStatus): void {
    applyPeerStatus(clientAddr, state);
  }

  /**
   * Statuses an answer moves a peer out of (Host side): still being rung, or
   * written off as unreachable or silent by a guess the answer has just
   * disproved. 'declined' is not among them - that is the person's own word.
   */
  const ANSWERABLE_STATUSES: ReadonlySet<ConnectionStatus> = new Set([
    'invited', 'no-answer', 'not-reached', 'timeout',
  ]);

  /**
   * Called when an invited peer answers the call (Host side), on the notice it
   * sends at the moment of answering - ahead of its SDP offer, which comes only
   * after its window has opened and its camera has started, and is the slowest
   * message on the ASMail path. Until the offer, the peer stayed 'invited' here:
   * "waiting for participants" with the ringtone still playing, while the other
   * end was already in the call.
   *
   * The notice promises nothing, so a peer whose offer never follows is written
   * off again after the same expiry the host's announcement to the others has.
   */
  function handlePeerAnswered(peerAddr: string): void {
    const participant = streams.getParticipant(peerAddr);
    if (!participant || participant.stream
      || !ANSWERABLE_STATUSES.has(participant.connectionStatus)) {
      return;
    }
    console.log(`[useInCalls] ${peerAddr} answered the call; waiting for its offer`);
    applyPeerStatus(peerAddr, 'connecting');
    setTimeout(() => {
      const current = streams.getParticipant(peerAddr);
      if (current && !current.stream && (current.connectionStatus === 'connecting')) {
        console.warn(`[useInCalls] ${peerAddr} answered ${REJOIN_NOTICE_TTL_MS}ms ago and never arrived`);
        applyPeerStatus(peerAddr, 'timeout');
      }
    }, REJOIN_NOTICE_TTL_MS);
  }

  /**
   * Called when an invited peer declines the call (Host side).
   */
  function handleCallDeclined(peerAddr: string): void {
    console.log(`[useInCalls] Call declined by ${peerAddr}`);
    applyPeerStatus(peerAddr, 'declined');
  }

  return {
    handleRemoteTrack,
    handleRemoteTrackDetached,
    handleClientTrack,
    handleClientConnected,
    handleClientDisconnected,
    handleConnectionStateChange,
    handleClientConnectionStateChange,
    handleCallDeclined,
    handlePeerAnswered,
    handleStreamStateChanged,
    handleRemoteStreamStateChanged,
    handleStreamSenderInfo,
    handleParticipantLeft,
    handleParticipantReconnecting,
  };
}
