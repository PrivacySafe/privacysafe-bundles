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
 * Client Signaling Channel Implementation
 *
 * Implements ClientSignalingChannel interface for Star architecture.
 * Uses ASMail (w3n.mail.delivery) for sending WebRTC signals to Host.
 *
 * Signal flow:
 * - Client -> Host: SDP Offer, ICE Candidates, Disconnect
 * - Host -> Client: SDP Answer, ICE Candidates (received via handleWebRTCMsg)
 *
 * Shared logic (DataChannel send, ASMail send, WebRTCMsg parsing) is in
 * signaling-channel-core.ts.
 */

import type {
  AnswerSignalPayload,
  ClientSignalingChannel,
  ClientSignalingChannelParams,
  StarSignalMessage,
  StarSignalType,
} from '@video/common/types/star.types';
import type { WebRTCMsg } from '~/asmail-msgs.types';
import {
  trySendViaDataChannel,
  sendSignalViaAsmail,
  parseStarSignalFromWebRTCMsg,
  createCandidateBatcher,
} from './signaling-channel-core';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ClientSignalingChannel');

const LOG_LABEL = '[ClientSignaling]';

/**
 * Creates a client-side signaling channel implementation.
 *
 * The client sends all signals to the Host via ASMail, with DataChannel
 * as a low-latency fast path once the Host opens it.
 *
 * @param params - Configuration parameters
 * @returns ClientSignalingChannel interface
 */
export function createClientSignalingChannel(
  params: ClientSignalingChannelParams,
): ClientSignalingChannel {
  const { hostAddr, ownAddr, chatId, callSessionId } = params;

  let signalHandler: ((signal: StarSignalMessage) => void) | null = null;
  let isClosed = false;

  // Low-latency DataChannel opened by the Host. Once open, signals are sent
  // via DC instead of ASMail (eliminating 100ms-2s delay per signal).
  // ASMail remains as fallback when DC is not yet open or send fails.
  let signalingDc: RTCDataChannel | null = null;

  // Buffer for signals that arrive before signalHandler is registered.
  // This prevents race conditions where the Host's SDP Answer (or other
  // early signals) arrives after the signaling channel is stored in the
  // store but before createClientChannel() registers onSignal().
  const pendingSignals: StarSignalMessage[] = [];

  /**
   * Sends a signal to the Host via DataChannel (preferred) or ASMail (fallback).
   *
   * The initial 'offer' goes via ASMail simply because `signalingDc` is still
   * null at that point (the DC is created by the Host during the initial
   * offer/answer exchange) - trySendViaDataChannel() refuses and the send
   * falls through. Renegotiation offers, screen-share offers among them, MUST
   * go via the DC when it is open: an offer/answer round trip over ASMail
   * takes seconds to tens of seconds, and that window is where a colliding
   * offer from the Host used to roll back a screen-share negotiation for good.
   */
  async function sendSignalToHost(signalType: StarSignalType, payload?: unknown): Promise<boolean> {
    if (isClosed) {
      log.warn(`${LOG_LABEL}: Cannot send signal: channel is closed`);
      return false;
    }

    // Build the StarSignalMessage for DC delivery (DC carries the full signal,
    // not the StarSignalData wrapper used by the ASMail path).
    const signal: StarSignalMessage = {
      type: signalType,
      fromAddr: ownAddr,
      data: payload as StarSignalMessage['data'],
      // The ASMail path gets this from WebRTCMsg.id; the DC path has to stamp
      // it here so both transports carry the same freshness marker (a signal
      // may well arrive over the DC while an older copy of it is still making
      // its way through ASMail).
      msgTs: Date.now(),
    };

    // Try low-latency DataChannel first; trySendViaDataChannel() checks the
    // DC is open and falls back to ASMail on any failure.
    if (trySendViaDataChannel(signalingDc, signal, LOG_LABEL)) {
      log.debug(`${LOG_LABEL}: Signal '${signalType}' sent via DC to Host`);
      return true;
    }

    // ASMail fallback (or initial offer)
    return sendSignalViaAsmail({
      recipientAddr: hostAddr,
      signalType,
      payload,
      fromAddr: ownAddr,
      chatId,
      deliveryIdPrefix: 'star-signal',
      logLabel: LOG_LABEL,
      isClosed,
      callSessionId,
    });
  }

  /**
   * Sends SDP description (offer) to host.
   */
  async function sendDescription(description: RTCSessionDescriptionInit): Promise<boolean> {
    return sendSignalToHost('offer', description);
  }

  /**
   * Sends SDP answer to host (for renegotiation).
   */
  async function sendAnswer(answer: AnswerSignalPayload): Promise<boolean> {
    return sendSignalToHost('answer', answer);
  }

  // Batches ASMail-borne candidates into one message per window (see
  // CANDIDATE_BATCH_WINDOW_MS); the DC path below stays per-candidate.
  const candidateBatcher = createCandidateBatcher(
    payload => sendSignalToHost('candidates', payload),
  );

  /**
   * Sends ICE candidate to host: directly over the DC when it is open (cheap,
   * low-latency), otherwise batched into one ASMail message per gathering
   * burst — per-candidate ASMail messages opened a parallel delivery session
   * each and drove the server into HTTP 500 for the whole burst.
   */
  async function sendCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (trySendViaDataChannel(
      signalingDc, { type: 'candidate', fromAddr: ownAddr, data: candidate }, LOG_LABEL,
    )) {
      return;
    }
    candidateBatcher.add(candidate);
  }

  /**
   * Sends arbitrary signal to host (e.g., stream-state-changed).
   */
  async function sendSignal(type: StarSignalType, payload?: unknown): Promise<boolean> {
    return sendSignalToHost(type, payload);
  }

  /**
   * Handles incoming signal from host.
   * Called when a WebRTC message is received from Host.
   */
  function handleIncomingSignal(msg: StarSignalMessage): void {
    if (isClosed) {
      return;
    }

    log.debug(`${LOG_LABEL}: Received signal '${msg.type}' from Host`);

    if (signalHandler) {
      signalHandler(msg);
    } else {
      // Buffer signal until handler is registered
      log.debug(`${LOG_LABEL}: No signalHandler yet, buffering signal '${msg.type}'`);
      pendingSignals.push(msg);
    }
  }

  /**
   * Handles incoming WebRTC message from ASMail.
   * Converts WebRTCMsg to StarSignalMessage using the shared parser.
   * Note: sender is assumed to be hostAddr (validated by caller).
   */
  function handleWebRTCMsg(webrtcMsg: WebRTCMsg): void {
    if (isClosed) {
      return;
    }

    log.debug(`${LOG_LABEL}: handleWebRTCMsg: stage=${webrtcMsg.stage}`);

    const signal = parseStarSignalFromWebRTCMsg(webrtcMsg, hostAddr, LOG_LABEL);
    if (signal) {
      handleIncomingSignal(signal);
    }
  }

  /**
   * Registers a handler for incoming signals.
   * Returns an unsubscribe function.
   */
  function onSignal(handler: (signal: StarSignalMessage) => void): () => void {
    signalHandler = handler;

    // Flush any signals that arrived before the handler was registered
    if (pendingSignals.length > 0) {
      log.debug(`${LOG_LABEL}: Flushing ${pendingSignals.length} buffered signals`);
      const signals = pendingSignals.splice(0);
      for (const signal of signals) {
        handler(signal);
      }
    }

    return () => {
      signalHandler = null;
    };
  }

  /**
   * Closes the signaling channel.
   */
  function close(): void {
    if (isClosed) {
      return;
    }

    isClosed = true;
    candidateBatcher.clear();
    signalHandler = null;
    log.debug(`${LOG_LABEL}: Channel closed`);
  }

  /**
   * Sets the low-latency DataChannel (opened by Host) for signaling.
   * Once set and open, signals are sent via DC instead of ASMail.
   */
  function setDataChannel(dc: RTCDataChannel): void {
    signalingDc = dc;
    log.debug(`${LOG_LABEL}: Signaling DataChannel set`);
  }

  return {
    sendDescription,
    sendAnswer,
    sendCandidate,
    flushCandidates: () => candidateBatcher.flush(),
    clearCandidates: () => candidateBatcher.clear(),
    sendSignal,
    handleIncomingSignal,
    handleWebRTCMsg,
    onSignal,
    setDataChannel,
    isDataChannelOpen: () => (signalingDc?.readyState === 'open'),
    close,
  };
}
