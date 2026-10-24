/*
  Copyright (C) 2026 3NSoft Inc.

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
 * Shared PeerConnection Setup
 *
 * Extracts the common RTCPeerConnection event-handler wiring that was
 * duplicated between createClientChannel() and createHostChannel() in
 * client-channel.ts and host-channel.ts:
 * - onicecandidate → forward to signaling channel
 * - onconnectionstatechange → ICE restart on 'disconnected', grace period,
 *   quality monitor on 'connected'
 * - oniceconnectionstatechange → diagnostic logging
 *
 * The caller still owns onnegotiationneeded, ontrack, and ondatachannel
 * because those differ significantly between client and host.
 */

import type { ConnectionStatus } from '@video/common/types/peer.types';
import {
  mapConnectionState,
  attemptIceRestartWithRecovery,
  startQualityMonitor,
  logSelectedCandidatePair,
  describeIceCandidate,
  createDisconnectGraceTimer,
} from './webrtc-utils';

/**
 * Options for setting up the shared RTCPeerConnection event handlers.
 */
export interface PcSetupOptions {
  /** Label for logging (e.g. `Client ${ownAddr} -> Host ${hostAddr}` or `Host -> Client ${clientAddr}`). */
  label: string;
  /** WebRTC configuration (ICE servers, etc.) — not used here but kept for API symmetry. */
  rtcConfig: RTCConfiguration;
  /** Called when a local ICE candidate is gathered. */
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  /**
   * Called when the connection state changes to a mapped ConnectionStatus.
   * Also called with 'reconnecting' when ICE restart is attempted on 'disconnected'.
   */
  onConnectionStateChange: (state: ConnectionStatus) => void;
  /**
   * Called when the connection does not recover from 'disconnected' within
   * the grace period (DISCONNECT_GRACE_MILLIS). The caller decides what to do
   * (client: report 'failed'; host: removeClient).
   */
  onGraceTimeout: () => void;
  /**
   * Optional: called when a DataChannel is received from the remote peer.
   * Only the client uses this (host creates its own DataChannels).
   */
  onDataChannel?: (event: RTCDataChannelEvent) => void;
  /**
   * Called when an ICE restart needs a fresh offer that the queued
   * 'negotiationneeded' event cannot produce (connection stranded in
   * 'have-local-offer' — see attemptIceRestartWithRecovery). The caller runs
   * its negotiate path (client: negotiate(); host: negotiateWithClient()).
   */
  onRequestRenegotiate?: () => void;
  /**
   * Called when ICE gathering completes (`event.candidate === null`).
   * Used to flush the ASMail candidate batch (see createCandidateBatcher).
   */
  onIceGatheringComplete?: () => void;
  /**
   * Optional: age (ms) of the local offer currently in flight, or null when
   * none was sent. Lets the ICE-restart recovery keep a young offer alive
   * instead of rolling it back into a competing one (see
   * attemptIceRestartWithRecovery).
   */
  strandedOfferAgeMillis?: () => number | null;
}

/**
 * Result of setting up the shared event handlers on an RTCPeerConnection.
 */
export interface PcSetupResult {
  /** The disconnect grace timer. Call clear() during cleanup. */
  disconnectGraceTimer: ReturnType<typeof createDisconnectGraceTimer>;
  /** Stops the quality monitor interval if one was started. Call during cleanup. */
  stopQualityMonitor: () => void;
}

/**
 * Wires the shared RTCPeerConnection event handlers (ICE candidate forwarding,
 * connection state monitoring with grace period + ICE restart, quality monitor).
 *
 * The caller is still responsible for setting:
 * - `pc.onnegotiationneeded` (differs: client negotiate() vs host negotiateWithClient())
 * - `pc.ontrack` (differs: client onRemoteTrack vs host onClientTrack + SFU)
 * - `pc.ondatachannel` (client only; host creates its own DCs)
 *
 * @param pc - The RTCPeerConnection to configure.
 * @param opts - Configuration options.
 * @returns Cleanup handles (grace timer + quality monitor stop).
 */
export function setupPeerConnection(
  pc: RTCPeerConnection,
  opts: PcSetupOptions,
): PcSetupResult {
  const {
    label, onIceCandidate, onConnectionStateChange, onGraceTimeout, onDataChannel,
    onRequestRenegotiate, onIceGatheringComplete, strandedOfferAgeMillis,
  } = opts;

  const disconnectGraceTimer = createDisconnectGraceTimer();
  let stopQualityMonitor: () => void = () => {};
  // Whether this pc ever completed DTLS. Gates the ICE restart below.
  let hadConnected = false;

  // Handle ICE candidates - forward to the signaling channel.
  pc.onicecandidate = event => {
    if (event.candidate) {
      console.log(`[${label}] Local ICE candidate: ${describeIceCandidate(event.candidate)}`);
      onIceCandidate(event.candidate);
    } else {
      // End of gathering: the reliable moment to flush a candidate batch.
      console.log(`[${label}] ICE gathering complete`);
      onIceGatheringComplete?.();
    }
  };

  // Monitor connection state.
  //
  // 'disconnected' is a TRANSIENT ICE state (browser keeps retrying on
  // its own); only 'failed' (or 'disconnected' that never recovers
  // within a grace period) should be treated as a real failure.
  // Reacting to 'disconnected' immediately used to tear down otherwise
  // healthy calls on brief network blips (e.g. a STUN binding timeout
  // while starting a screen share).
  pc.onconnectionstatechange = () => {
    const rawState = pc.connectionState;
    console.log(`[${label}] Connection state: ${rawState}`);

    if (rawState === 'disconnected') {
      if (hadConnected) {
        console.warn(`[${label}] Connection reported 'disconnected', attempting ICE restart`);
        attemptIceRestartWithRecovery(pc, label, onRequestRenegotiate, strandedOfferAgeMillis);
      } else {
        // A connection that never completed DTLS (ICE may pass — the peer
        // answers connectivity checks off its own offer's credentials — but
        // without our answer applied DTLS cannot) has nothing to restart.
        // Worse, restartIce() here mints a renegotiation offer that parks
        // signaling in 'have-local-offer', where an impolite host then
        // ignores the peer's fresh recovery offers as collisions. Recovery
        // of a never-connected link is that fresh offer, so just wait.
        console.warn(
          `[${label}] Connection reported 'disconnected' before ever connecting — ` +
            `waiting for a fresh offer instead of ICE restart`,
        );
      }
      onConnectionStateChange('reconnecting');
      // Idempotent: a repeated 'disconnected' event does not stack
      // additional grace timers.
      disconnectGraceTimer.arm(() => {
        if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed'
        ) {
          console.warn(`[${label}] Connection did not recover within grace period, reporting failed`);
          onGraceTimeout();
        }
      });
      return;
    }

    // Any other state (connected, connecting, failed, closed, new)
    // clears a pending grace timer — the transient disconnect either
    // recovered or turned into a definitive failure/close.
    disconnectGraceTimer.clear();

    const state = mapConnectionState(rawState);
    onConnectionStateChange(state);

    if (rawState === 'failed') {
      console.warn(`[${label}] Connection lost`);
    }

    // Diagnostic: log which ICE candidate pair (local path/relay) is
    // actually in use once the connection is established.
    if (rawState === 'connected') {
      hadConnected = true;
      void logSelectedCandidatePair(pc, label);
      // Clean up any previous quality monitor before starting a new one
      // to prevent interval leaks on reconnect (disconnected → connected).
      stopQualityMonitor();
      stopQualityMonitor = startQualityMonitor(pc, label);
    }
  };

  // Handle ICE connection state (diagnostic logging only).
  pc.oniceconnectionstatechange = () => {
    console.log(`[${label}] ICE connection state: ${pc.iceConnectionState}`);
  };

  // Handle data channels from the remote peer (client-side only).
  if (onDataChannel) {
    pc.ondatachannel = onDataChannel;
  }

  return {
    disconnectGraceTimer,
    stopQualityMonitor: () => {
      stopQualityMonitor();
      disconnectGraceTimer.clear();
    },
  };
}
