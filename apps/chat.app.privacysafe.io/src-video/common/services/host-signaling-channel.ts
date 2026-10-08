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
 * Host Signaling Channel Implementation
 *
 * Implements HostSignalingChannel interface for Star architecture.
 * Uses ASMail (w3n.mail.delivery) for sending WebRTC signals to clients.
 *
 * Signal flow:
 * - Host -> Client: SDP Answer, ICE Candidates, Disconnect
 * - Client -> Host: SDP Offer, ICE Candidates (received via handleWebRTCMsg)
 *
 * Shared logic (DataChannel send, ASMail send, WebRTCMsg parsing) is in
 * signaling-channel-core.ts.
 */

import type {
  AnswerSignalPayload,
  HostSignalingChannel,
  HostSignalingChannelParams,
  StarSignalHandler,
  StarSignalMessage,
  StarSignalType,
} from '@video/common/types/star.types';
import type { CandidateBatcher } from './signaling-channel-core';
import type { WebRTCMsg } from '~/asmail-msgs.types';
import {
  trySendViaDataChannel,
  sendSignalViaAsmail,
  parseStarSignalFromWebRTCMsg,
  createCandidateBatcher,
  attributeIncomingHostSignal,
} from './signaling-channel-core';
import { makeLogger } from '@shared/logger';

const log = makeLogger('HostSignalingChannel');

const LOG_LABEL = '[HostSignaling]';

/**
 * How often a client whose signals name somebody else is reported. See
 * warnOfForeignSender.
 */
const FOREIGN_SENDER_WARN_INTERVAL_MS = 5000;

/**
 * Creates a host-side signaling channel implementation.
 *
 * The host sends signals to specific clients via ASMail, with per-client
 * DataChannels as a low-latency fast path once opened.
 *
 * @param params - Configuration parameters
 * @returns HostSignalingChannel interface
 */
export function createHostSignalingChannel(
  params: HostSignalingChannelParams,
): HostSignalingChannel {
  const { ownAddr, chatId, callSessionId } = params;

  // Map of client-specific signal handlers
  const clientHandlers = new Map<string, StarSignalHandler>();

  // Wildcard handler for all clients
  let wildcardHandler: StarSignalHandler | null = null;

  // Per-client throttle for the "body names another participant" warning; see
  // warnOfForeignSender.
  const foreignSenderWarnings = new Map<
    string, { lastWarnedAt: number; suppressed: number }
  >();

  // Set of known client addresses (for broadcastSignal)
  // This is separate from clientHandlers because handlers are only registered
  // via registerClientHandler(), but broadcast needs to know ALL connected clients.
  const knownClients = new Set<string>();

  // Map of low-latency DataChannels per client (opened by Host).
  // Once open, signals to that client are sent via DC instead of ASMail
  // (eliminating 100ms-2s delay per signal). ASMail remains as fallback.
  const clientDataChannels = new Map<string, RTCDataChannel>();

  // Per-client batching of ASMail-borne ICE candidates (see
  // CANDIDATE_BATCH_WINDOW_MS); the DC path stays per-candidate.
  const candidateBatchers = new Map<string, CandidateBatcher>();

  let isClosed = false;

  function getCandidateBatcher(clientAddr: string): CandidateBatcher {
    let batcher = candidateBatchers.get(clientAddr);
    if (!batcher) {
      batcher = createCandidateBatcher(
        payload => sendSignalToClient(clientAddr, 'candidates', payload),
      );
      candidateBatchers.set(clientAddr, batcher);
    }
    return batcher;
  }

  /**
   * Sends a signal to a specific client via DataChannel (preferred) or ASMail (fallback).
   *
   * The initial 'answer' goes via ASMail simply because the client's DC is not
   * open at that point (it's created during the initial offer/answer exchange) -
   * trySendViaDataChannel() refuses and the send falls through. Renegotiation
   * answers MUST go via the DC when it is open: an answer to a client's
   * screen-share offer that travels ASMail arrives seconds late, by which time
   * the client may have rolled its offer back for a colliding one of ours and
   * drops the answer as stale.
   */
  async function sendSignalToClient(
    clientAddr: string,
    signalType: StarSignalType,
    payload?: unknown,
    fromAddr?: string,
  ): Promise<boolean> {
    if (isClosed) {
      log.warn(`${LOG_LABEL}: Cannot send signal: channel is closed`);
      return false;
    }

    const effectiveFromAddr = fromAddr || ownAddr;

    // Build the StarSignalMessage for DC delivery (DC carries the full signal,
    // not the StarSignalData wrapper used by the ASMail path).
    const signal: StarSignalMessage = {
      type: signalType,
      fromAddr: effectiveFromAddr,
      toAddr: clientAddr,
      data: payload as StarSignalMessage['data'],
      // The ASMail path gets this from WebRTCMsg.id; the DC path has to stamp
      // it here so both transports carry the same freshness marker (a signal
      // may well arrive over the DC while an older copy of it is still making
      // its way through ASMail).
      msgTs: Date.now(),
    };

    // Try low-latency DataChannel first; trySendViaDataChannel() checks the
    // DC is open and falls back to ASMail on any failure.
    if (trySendViaDataChannel(clientDataChannels.get(clientAddr), signal, LOG_LABEL)) {
      log.debug(`${LOG_LABEL}: Signal '${signalType}' sent via DC to client ${clientAddr}`);
      return true;
    }

    // ASMail fallback (or initial answer, before the DC exists)
    return sendSignalViaAsmail({
      recipientAddr: clientAddr,
      signalType,
      payload,
      fromAddr: effectiveFromAddr,
      toAddr: clientAddr,
      chatId,
      deliveryIdPrefix: 'star-host-signal',
      logLabel: LOG_LABEL,
      isClosed,
      callSessionId,
    });
  }

  /**
   * Sends a StarSignalMessage to a specific client.
   */
  async function sendSignalMessageToClient(
    clientAddr: string,
    signal: StarSignalMessage,
  ): Promise<boolean> {
    return sendSignalToClient(clientAddr, signal.type, signal.data, signal.fromAddr);
  }

  /**
   * Sends SDP Answer to a specific client.
   */
  async function sendAnswerToClient(
    clientAddr: string,
    answer: AnswerSignalPayload,
  ): Promise<boolean> {
    return sendSignalToClient(clientAddr, 'answer', answer);
  }

  /**
   * Sends ICE candidate to a specific client: directly over the DC when it is
   * open, otherwise batched into one ASMail message per gathering burst (see
   * CandidatesBatchPayload for why per-candidate messages are forbidden).
   */
  async function sendCandidateToClient(
    clientAddr: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    if (trySendViaDataChannel(
      clientDataChannels.get(clientAddr),
      { type: 'candidate', fromAddr: ownAddr, toAddr: clientAddr, data: candidate },
      LOG_LABEL,
    )) {
      return;
    }
    getCandidateBatcher(clientAddr).add(candidate);
  }

  /**
   * Broadcasts a signal to all known clients (optionally excluding one).
   * Uses knownClients set (populated via addClient/removeClient) instead of
   * clientHandlers, because handlers are only registered for specific clients
   * while broadcast needs to reach ALL connected clients.
   */
  async function broadcastSignal(
    signal: StarSignalMessage,
    excludeAddr?: string,
  ): Promise<void> {
    if (isClosed) {
      log.warn(`${LOG_LABEL}: Cannot broadcast: channel is closed`);
      return;
    }

    const promises: Promise<boolean>[] = [];
    let dcSentCount = 0;

    for (const clientAddr of knownClients) {
      if (clientAddr === excludeAddr) { continue; }

      // Try low-latency DataChannel first; fall back to ASMail if not open/fails.
      if (trySendViaDataChannel(clientDataChannels.get(clientAddr), signal, LOG_LABEL)) {
        dcSentCount++;
        continue;
      }
      promises.push(sendSignalMessageToClient(clientAddr, signal));
    }

    await Promise.allSettled(promises);
    log.debug(
      `${LOG_LABEL}: Signal '${signal.type}' broadcasted to ${dcSentCount + promises.length} clients (${dcSentCount} via DC, ${promises.length} via ASMail)`,
    );
  }

  /**
   * Handles incoming signal from a client.
   * Routes to the appropriate client handler.
   */
  function handleIncomingSignal(clientAddr: string, msg: StarSignalMessage): void {
    if (isClosed) {
      return;
    }

    // Everything below this line sees the channel's own address as the author,
    // whatever the body claims. `clientAddr` is authenticated on both paths -
    // the closure of the client's signalling DataChannel, or the sender of an
    // ASMail envelope - and until this existed it went no further than the log
    // line: the only registered handler is a wildcard one, and it read the
    // author out of the message body. A connected participant could therefore
    // name another and have the host apply its SDP to that participant's live
    // connection, or hang it up (reported 2026-09-09).
    //
    // Safe precisely here, and only here: the host never relays an INCOMING
    // signal, so nothing arriving on a client's channel legitimately speaks for
    // anyone else. The outgoing direction does relay a peer's logical actor,
    // which is why attribution on the client side stays as it is.
    const { signal, overridden } = attributeIncomingHostSignal(clientAddr, msg);
    if (overridden) {
      warnOfForeignSender(clientAddr, msg);
    }

    log.debug(`${LOG_LABEL}: Received signal '${signal.type}' from client ${clientAddr}`);

    // Route to client-specific handler
    const handler = clientHandlers.get(clientAddr);
    if (handler) {
      handler(signal, clientAddr);
    }

    // Route to wildcard handler
    if (wildcardHandler) {
      wildcardHandler(signal, clientAddr);
    }
  }

  /**
   * Reports a signal whose body named a different participant.
   *
   * Throttled per client, because the path is reachable at DataChannel rate:
   * an unthrottled line here would let the sender flood the log it is meant to
   * be visible in. The suppressed count goes out with the next line, so a
   * burst stays countable.
   */
  function warnOfForeignSender(clientAddr: string, msg: StarSignalMessage): void {
    const now = Date.now();
    const state = foreignSenderWarnings.get(clientAddr);
    if (state && ((now - state.lastWarnedAt) < FOREIGN_SENDER_WARN_INTERVAL_MS)) {
      state.suppressed += 1;
      return;
    }
    const suppressed = state?.suppressed ?? 0;
    foreignSenderWarnings.set(clientAddr, { lastWarnedAt: now, suppressed: 0 });
    log.warn(
      `${LOG_LABEL}: signal '${msg.type}' arrived on ${clientAddr}'s channel but claims `
        + `to come from ${msg.fromAddr}; treating it as ${clientAddr}'s own — a participant `
        + `never speaks for another one here`
        + ((suppressed > 0) ? ` (${suppressed} more such signal(s) since the last line)` : ''),
    );
  }

  /**
   * Handles incoming WebRTC message from ASMail.
   * Converts WebRTCMsg to StarSignalMessage using the shared parser.
   */
  function handleWebRTCMsg(clientAddr: string, webrtcMsg: WebRTCMsg): void {
    if (isClosed) {
      return;
    }

    const signal = parseStarSignalFromWebRTCMsg(webrtcMsg, clientAddr, LOG_LABEL);
    if (signal) {
      handleIncomingSignal(clientAddr, signal);
    }
  }

  /**
   * Registers a handler for signals from a specific client.
   * Use '*' as clientAddr to register a wildcard handler for all clients.
   * Returns an unsubscribe function.
   */
  function registerClientHandler(
    clientAddr: string,
    handler: StarSignalHandler,
  ): () => void {
    if (clientAddr === '*') {
      wildcardHandler = handler;
      return () => {
        wildcardHandler = null;
      };
    }

    clientHandlers.set(clientAddr, handler);
    return () => {
      clientHandlers.delete(clientAddr);
    };
  }

  /**
   * Adds a client to the known clients list.
   * Called when a new client connects (e.g., after SDP Offer is received).
   */
  function addClient(clientAddr: string): void {
    knownClients.add(clientAddr);
    log.debug(`${LOG_LABEL}: Client added to known list: ${clientAddr} (total: ${knownClients.size})`);
  }

  /**
   * Removes a client from the known clients list.
   * Called when a client disconnects.
   */
  function removeClient(clientAddr: string): void {
    knownClients.delete(clientAddr);
    candidateBatchers.get(clientAddr)?.clear();
    candidateBatchers.delete(clientAddr);
    foreignSenderWarnings.delete(clientAddr);
    // Close and drop the DataChannel for this client.
    const dc = clientDataChannels.get(clientAddr);
    if (dc) {
      try {
        dc.close();
      } catch {
        // ignore
      }
      clientDataChannels.delete(clientAddr);
    }
    log.debug(`${LOG_LABEL}: Client removed from known list: ${clientAddr} (total: ${knownClients.size})`);
  }

  /**
   * Sets the low-latency DataChannel for a specific client.
   * Once set and open, signals to that client are sent via DC instead of ASMail.
   */
  function setClientDataChannel(clientAddr: string, dc: RTCDataChannel): void {
    clientDataChannels.set(clientAddr, dc);
    log.debug(`${LOG_LABEL}: DataChannel set for client ${clientAddr}`);
  }

  /**
   * Closes the signaling channel.
   */
  function close(): void {
    if (isClosed) {
      return;
    }

    isClosed = true;
    clientHandlers.clear();
    knownClients.clear();
    foreignSenderWarnings.clear();
    for (const batcher of candidateBatchers.values()) {
      batcher.clear();
    }
    candidateBatchers.clear();
    // Close all client DataChannels.
    for (const dc of clientDataChannels.values()) {
      try {
        dc.close();
      } catch {
        // ignore
      }
    }
    clientDataChannels.clear();
    wildcardHandler = null;
    log.debug(`${LOG_LABEL}: Channel closed`);
  }

  return {
    sendSignalToClient: sendSignalMessageToClient,
    sendAnswerToClient,
    sendCandidateToClient,
    flushCandidatesFor: (clientAddr: string) => candidateBatchers.get(clientAddr)?.flush(),
    clearCandidatesFor: (clientAddr: string) => candidateBatchers.get(clientAddr)?.clear(),
    broadcastSignal,
    handleIncomingSignal,
    handleWebRTCMsg,
    registerClientHandler,
    addClient,
    removeClient,
    setClientDataChannel,
    close,
  };
}
