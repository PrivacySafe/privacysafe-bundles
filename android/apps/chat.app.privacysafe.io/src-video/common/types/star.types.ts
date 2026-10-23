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
 * Star (Host-Client) Architecture Types
 *
 * This module defines types for the Star topology video call architecture:
 * - Host: The call initiator (direction: 'outgoing'), acts as a mini-SFU server
 * - Client: Call recipients (direction: 'incoming'), each has one RTCPeerConnection to Host
 *
 * Key principles:
 * - Host receives streams from all clients and retransmits them to other clients
 * - Client sends own stream to Host and receives retransmitted streams from Host
 * - Stream identification via stream.id (equals sender's address)
 * - Maximum 6 participants per call (configurable via MAX_CALL_PARTICIPANTS)
 */

import type { ConnectionStatus } from './peer.types';
import type { ChatIdObj, WebRTCMsg } from '../../../types/asmail-msgs.types';

/**
 * Role of a participant in Star architecture.
 * - 'host': Call initiator, manages multiple client connections, performs SFU retransmission
 * - 'client': Call recipient, has single connection to host
 */
export type StarRole = 'host' | 'client';

/**
 * Configuration for Star architecture initialization.
 * Created when call starts based on direction (outgoing = host, incoming = client).
 */
export interface StarConfig {
  /** Role of this participant */
  role: StarRole;
  /**
   * Address of the host.
   * - For host: own address
   * - For client: address of the host (call initiator)
   */
  hostAddr: string;
  /** WebRTC configuration (ICE servers, etc.) */
  rtcConfig: RTCConfiguration;
}

/**
 * Client connection state - single connection to Host.
 * Only present when role === 'client'.
 */
export interface ClientConnectionState {
  /** Address of the host this client is connected to */
  hostAddr: string;
  /** Single RTCPeerConnection to the host */
  peerConnection: RTCPeerConnection | null;
  /** Current connection status */
  connectionStatus: ConnectionStatus;
  /** Local media stream (camera + mic) */
  localStream: MediaStream | null;
  /**
   * Map of remote streams received from host.
   * key = participantAddr (extracted from stream.id)
   * value = MediaStream from that participant
   */
  remoteStreams: Map<string, MediaStream>;
}

/**
 * Signal types used in Star architecture signaling.
 */
export type StarSignalType =
  | 'offer'           // SDP Offer (client -> host)
  | 'answer'          // SDP Answer (host -> client)
  | 'candidate'       // ICE Candidate (bidirectional)
  | 'candidates'      // Batched ICE candidates: one ASMail msg per batch (bidirectional)
  | 'participant-joined'  // Notification about new participant
  | 'participant-left'    // Notification about participant leaving
  | 'participant-reconnecting' // Notification about a participant's transient link loss
  | 'call-full'       // Rejection: call has reached max participants
  | 'stream-state-changed' // Mic/cam state change notification
  | 'stream-sender-info'   // Mapping of stream ID to sender address
  | 'stream-sender-infos'  // Batched mappings: one ASMail msg per batch (host -> client)
  | 'request-stream-info'  // Ask the host to re-send all stream mappings (client -> host)
  | 'disconnect'      // Graceful disconnect notification
  | 'dropped';        // Host gave up on this client's link; call continues, rejoin welcome

/**
 * SDP origin (`o=` line: sessionId + version) of the offer an answer replies
 * to. Carried inside the answer signal so the receiver can drop an answer
 * that belongs to a superseded offer: `signalingState === 'have-local-offer'`
 * alone cannot tell them apart, and a stale answer applies CLEANLY to a
 * recreated pc (same m-line shape), silently pairing it with the sender's
 * already-dead pc generation. Optional for backward compatibility — an
 * answer without it is accepted as before.
 */
export interface AnswerToRef {
  sessionId: string;
  version: number;
}

/** An SDP answer payload, optionally correlated with the offer it answers. */
export type AnswerSignalPayload = RTCSessionDescriptionInit & { answerTo?: AnswerToRef };

/**
 * One relay slot a client reserved in its offer: an m-line it will only ever
 * RECEIVE on, offered so the host can negotiate it as a sender up front and later
 * drop a participant's track into it with replaceTrack — no renegotiation at all.
 *
 * That is the whole point. Renegotiating on every join is what tore down the
 * group call of 2026-08-12: over a 7-15s ASMail hop the host's relay offer
 * arrived while the joiner's own first negotiation was still in flight, the
 * polite client rolled back, and an already ICE-connected transport went back to
 * 'new'. Pre-negotiated slots remove the offer entirely.
 *
 * `mid` is the m-line's identity and the only safe way to address it (never an
 * index). `forAddr` is the participant the client expects in this slot, a hint
 * the host honours when it can so the client can show media the moment it
 * unmutes, without waiting for a mapping to travel.
 */
export interface RelaySlotDeclaration {
  mid: string;
  kind: 'audio' | 'video';
  purpose: 'va' | 'screen';
  forAddr?: string;
}

/**
 * An SDP offer payload, optionally declaring the relay slots it reserved.
 *
 * Additive by design: an offer without the field gets the old
 * transceiver-per-track relay, so a peer on an older build is unaffected. Extra
 * fields on a description are ignored by setRemoteDescription — the same carriage
 * `answerTo` already uses.
 */
export type OfferSignalPayload = RTCSessionDescriptionInit & {
  relaySlots?: RelaySlotDeclaration[];
};

/**
 * A batch of ICE candidates sent as ONE ASMail message. Every candidate used
 * to be its own `sendImmediately` message; the platform opens an unbounded
 * parallel delivery session per message, and an 'all'-policy gathering burst
 * (~10+ candidates in ~200ms, next to the multi-KB offer) was observed to
 * drive the ASMail server into HTTP 500 on PUT msg/meta|obj for the whole
 * burst — the call's candidates simply never arrived (2026-08-11).
 */
export interface CandidatesBatchPayload {
  candidates: RTCIceCandidateInit[];
}

/**
 * Signal message in Star architecture.
 * Used for communication between host and clients.
 */
export interface StarSignalMessage {
  /** Type of signal */
  type: StarSignalType;
  /** Address of the signal sender */
  fromAddr: string;
  /** Address of the signal recipient (undefined for broadcast) */
  toAddr?: string;
  /** Signal payload (depends on type) */
  data?: RTCSessionDescriptionInit | RTCIceCandidateInit | CandidatesBatchPayload
    | ParticipantInfo | CallFullInfo | StreamStateInfo | StreamSenderInfo
    | StreamSenderInfosBatchPayload | ParticipantReconnectingInfo;
  /**
   * When the SENDER produced this signal (its own clock).
   *
   * Only ever compared against other timestamps from the same sender, so
   * clock skew between machines is irrelevant — only sender-local
   * monotonicity matters. Used to drop SDP that ASMail delivers out of order:
   * without it a re-ordered OLD offer is indistinguishable from a peer that
   * just recreated its pc, and tearing down a live connection in response is
   * what turns one hiccup into a minutes-long recreate loop.
   *
   * Optional: a peer running an older build sends none, and then the previous
   * (unguarded) behaviour applies.
   */
  msgTs?: number;
}

/**
 * Information about a participant (used in join/leave notifications).
 */
export interface ParticipantInfo {
  /** Participant's address */
  addr: string;
  /** Participant's display name */
  name: string;
}

/**
 * Information about a participant's transient link status.
 * Sent via 'participant-reconnecting' signal so peers who cannot see the
 * affected RTCPeerConnection directly can still show a "reconnecting" hint
 * on that participant's tile before the disconnect-grace timeout elapses.
 *
 * The signal carries two cases, and `kind` is how the receiving side tells
 * them apart:
 * - a live participant's link blip, where the tile is there and only its hint
 *   changes;
 * - a participant who LEFT and announced a re-join (see announceRejoiningPeer),
 *   where 'participant-left' may have taken the tile away and one has to be
 *   created with a "connecting…" status. See reconnectingHintEffect.
 */
export interface ParticipantReconnectingInfo {
  /** Participant's address */
  addr: string;
  /** true when link loss was detected, false when it recovered */
  reconnecting: boolean;
  /**
   * Which of the two cases above this is.
   *
   * Optional: a host running an older build sends none, and the receiver then
   * falls back on the guess it used to make. That guess is what put a blur
   * saying "reconnecting" over the live video of participants who had just
   * joined (run of 2026-08-16) - it read "this peer has a tile already" as
   * "this is a link blip", while the roster gives every member of the chat a
   * tile before any signalling happens.
   */
  kind?: 'rejoin' | 'link-blip';
}

/**
 * Information sent when call is full (rejection reason).
 */
export interface CallFullInfo {
  /** Maximum allowed participants */
  maxParticipants: number;
  /** Current number of participants */
  currentParticipants: number;
}

/**
 * Stream state information (mic/cam toggle state).
 * Sent via 'stream-state-changed' signal.
 */
export interface StreamStateInfo {
  /** Whether audio (mic) is enabled */
  audio: boolean;
  /** Whether video (cam) is enabled */
  video: boolean;
}

/**
 * Stream sender information (mapping stream ID to sender address).
 * Sent via 'stream-sender-info' signal when WebRTC stream.id is a UUID
 * instead of the sender's address (due to read-only stream.id).
 */
export interface StreamSenderInfo {
  /** The actual stream ID (may be UUID) */
  streamId: string;
  /** The sender's address (mailerId) */
  senderAddr: string;
  /** Human-readable name of the screen/window being shared */
  screenName?: string;
  /**
   * The relay slot's m-line, when this mapping is about a pre-negotiated slot.
   *
   * A slot's stream id is fixed at negotiation and never changes, so a slot
   * handed to a different participant cannot be re-pointed by stream id alone —
   * addressing it by mid is what makes reassignment expressible. Absent for
   * ordinary per-track relay, which keeps using streamId.
   */
  mid?: string;
}

/**
 * Several stream mappings in one signal, the ASMail counterpart of
 * CandidatesBatchPayload and for the same reason: a joining participant makes
 * the host produce one mapping per stream it will receive, and one ASMail
 * message each opens a parallel delivery session each — the burst the server
 * answers with HTTP 500. The open DataChannel path still sends singles, where
 * a message costs nothing.
 */
export interface StreamSenderInfosBatchPayload {
  infos: StreamSenderInfo[];
}

/**
 * Interface for client-side WebRTC channel.
 * Manages single RTCPeerConnection to host.
 */
export interface ClientWebRTCChannel {
  /** Create and send SDP Offer to host */
  createAndSendOffer(): Promise<void>;
  /** Apply SDP Answer received from host */
  applyAnswer(answer: RTCSessionDescriptionInit): Promise<void>;
  /** Apply ICE candidate received from host */
  applyCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  /** Close the connection */
  close(): void;
  /**
   * Notify the host that this client is leaving the call, via the
   * low-latency signaling DataChannel (falling back to ASMail).
   * Lets the host (and, via broadcast, other clients) remove this
   * participant's tile immediately instead of waiting for an
   * ICE-failure/disconnect-grace timeout.
   */
  notifyHostOfLeaving(): Promise<void>;
  /**
   * Feeds the host-silence watchdog: any out-of-band evidence that the host
   * is alive (its background-forwarded heartbeat above all) resets the
   * silence clock. Signals arriving through the signaling channel are
   * counted automatically; this is for evidence that bypasses it.
   */
  noteHostActivity(): void;
  /**
   * Asks the host to re-send the mappings of stream ids to sender addresses.
   *
   * Needed when tracks arrive but their 'stream-sender-info' does not: the
   * first mapping can go out over best-effort ASMail (before the streamInfo
   * DataChannel opens) and be lost. Without asking again, the participant is
   * stuck under a raw stream UUID - shown without a name and missing
   * mute-state updates, which are routed by real address.
   */
  requestStreamMappings(): void;
  /**
   * Whether signalling to the host currently rides the DataChannel rather than
   * ASMail. Lets callers pace their waits to the transport: the same exchange
   * costs milliseconds over one and up to 30s over the other.
   */
  isSignalingFast(): boolean;
  /** Get underlying RTCPeerConnection (for debugging/stats) */
  getPeerConnection(): RTCPeerConnection | null;
  /** Send stream state (mic/cam) change signal to host */
  sendStreamState(state: StreamStateInfo): Promise<void>;
  /** Add a screen share track to the connection */
  addScreenTrack(
    track: MediaStreamTrack, screenStream: MediaStream, mailerId: string,
    srcId: string, screenName?: string,
  ): Promise<void>;
  /** Remove a screen share track from the connection */
  removeScreenTrack(track: MediaStreamTrack, mailerId: string, srcId: string): Promise<void>;
}

/**
 * Interface for host-side WebRTC channel.
 * Manages multiple RTCPeerConnections (one per client).
 */
export interface HostWebRTCChannel {
  /**
   * Tells the other participants that `clientAddr` is on its way back into the
   * call, as that client announced ahead of its SDP offer (see
   * `rejoining` in WebRTCOffBandMessage). Reuses the
   * 'participant-reconnecting' broadcast; withdrawn after
   * REJOIN_NOTICE_TTL_MS if the return never materializes.
   */
  announceRejoiningPeer(clientAddr: string): void;
  /** Handle SDP Offer from a client, create connection and send Answer */
  handleClientOffer(clientAddr: string, offer: RTCSessionDescriptionInit): Promise<void>;
  /** Handle ICE candidate from a client */
  handleClientCandidate(clientAddr: string, candidate: RTCIceCandidateInit): Promise<void>;
  /**
   * Broadcast a track from one client to all other clients.
   * This is the core SFU retransmission logic.
   */
  broadcastTrackToOtherClients(
    sourceClientAddr: string,
    track: MediaStreamTrack,
    stream: MediaStream
  ): void;
  /**
   * Add the host's own screen share track to all connected clients.
   * Used when the host initiates screen sharing.
   */
  addOwnScreenTrack(
    track: MediaStreamTrack, screenStream: MediaStream, mailerId: string,
    srcId: string, screenName?: string,
  ): void;
  /** Remove host's own screen share track from all connected clients */
  removeOwnScreenTrack(mailerId: string, srcId: string): void;
  /**
   * Remove a client and clean up their tracks from all other connections.
   *
   * Asynchronous: the removal renegotiates with every remaining client, and the
   * client is only gone once that settles. This used to be declared as `void`,
   * which made callers - including a spec asserting on getClientCount() right
   * after the call - look at the state before the removal had happened.
   */
  removeClient(clientAddr: string): Promise<void>;
  /**
   * Whether a 'disconnect' stamped `sentAt` describes a connection this client
   * has already replaced — i.e. it was sent before the pc now serving them was
   * built, so acting on it would tear down a live re-join.
   *
   * A departure is announced over ASMail with three blind repeats spanning a
   * minute (TEARDOWN_REPEAT_DELAYS_MILLIS), because a lost 'disconnect' leaves
   * the peer's window open. Those copies were assumed inert on arrival; they
   * are not, once the sender re-joins inside that minute (group call of
   * 2026-08-12). Repeats stay — a peer that missed the original still needs
   * one — and this makes the late ones harmless instead.
   *
   * `sentAt` is the peer's own clock (WebRTCMsg.id), the very field that
   * becomes StarSignalMessage.msgTs, so it is compared against the peer-clock
   * baseline of the current pc generation and never against ours.
   */
  isStaleClientDisconnect(clientAddr: string, sentAt: number | undefined): boolean;
  /**
   * Notify all clients that the host is ending the call, via the
   * low-latency signaling DataChannel (falling back to ASMail).
   * Lets clients close their call window immediately instead of waiting
   * for the ASMail 'disconnect' system message or an ICE-failure timeout.
   */
  notifyClientsOfCallEnd(): Promise<void>;
  /** Close all client connections */
  closeAll(): void;
  /** Get number of connected clients */
  getClientCount(): number;
  /** Check if a new client can be accepted (respects MAX_CALL_PARTICIPANTS) */
  canAcceptNewClient(): boolean;
  /**
   * Track-attribution diagnostics: streams currently buffered awaiting
   * 'stream-sender-info', and streams given up on without ever receiving it.
   */
  getPendingTracksStats(): { bufferedStreams: number; discardedStreams: number };
}

/**
 * Interface for client-side signaling channel.
 * All messages are sent strictly to the host.
 */
export interface ClientSignalingChannel {
  /**
   * Send SDP description (offer) to host.
   * Resolves `true` only if ASMail delivery was actually confirmed
   * (as opposed to merely queued); `false` otherwise, so the caller
   * can decide to retry sooner.
   */
  sendDescription(description: RTCSessionDescriptionInit): Promise<boolean>;
  /**
   * Send SDP answer to host (for renegotiation).
   * Resolves `true` only if ASMail delivery was actually confirmed.
   */
  sendAnswer(answer: AnswerSignalPayload): Promise<boolean>;
  /** Send ICE candidate to host (fire-and-forget, not delivery-confirmed) */
  sendCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  /** Flush any batched ICE candidates immediately (end of gathering). */
  flushCandidates?(): void;
  /** Drop batched-but-unsent candidates (pc recreate: they belong to the old pc). */
  clearCandidates?(): void;
  /**
   * Send arbitrary signal to host (e.g., stream-state-changed).
   * Resolves `true` if delivery was confirmed for confirmation-tracked
   * signal types ('disconnect', 'call-full'); for other signal types this
   * simply reflects whether the message was queued for sending.
   */
  sendSignal(type: StarSignalType, payload?: unknown): Promise<boolean>;
  /** Handle incoming signal from host */
  handleIncomingSignal(msg: StarSignalMessage): void;
  /** Handle incoming WebRTC message (converts to StarSignalMessage internally) */
  handleWebRTCMsg(msg: WebRTCMsg): void;
  /** Register handler for incoming signals */
  onSignal(handler: (signal: StarSignalMessage) => void): () => void;
  /**
   * Sets the low-latency DataChannel (opened by Host) for signaling.
   * Once set and open, signals are sent via DC instead of ASMail.
   * ASMail remains as fallback when DC is not yet open or send fails.
   */
  setDataChannel?(dc: RTCDataChannel): void;
  /**
   * Whether the low-latency signaling DataChannel is open right now, i.e.
   * whether a signal sent at this moment reaches the host in milliseconds
   * rather than over a 5-12s ASMail leg. Callers use it to pace recovery
   * timers to the transport actually in use.
   */
  isDataChannelOpen?(): boolean;
  /** Close the signaling channel */
  close(): void;
}

/**
 * Handler of a signal that reached the host from one of its clients.
 *
 * `authenticatedFrom` is the address of the channel the signal arrived on, and
 * it is the only trustworthy statement of who sent it: `signal.fromAddr` is
 * whatever the sender wrote. The channel already reconciles the two before
 * calling a handler (see attributeIncomingHostSignal), so the two agree here -
 * the parameter exists so that a handler reads the authenticated value on
 * purpose rather than by the good fortune of the field having been rewritten.
 */
export type StarSignalHandler = (
  signal: StarSignalMessage, authenticatedFrom: string,
) => void;

/**
 * Interface for host-side signaling channel.
 * Manages signal routing between clients.
 */
export interface HostSignalingChannel {
  /**
   * Send signal to a specific client.
   * Resolves `true` if delivery was confirmed for confirmation-tracked
   * signal types ('offer', 'answer', 'disconnect', 'call-full'); for other
   * signal types this simply reflects whether the message was queued.
   */
  sendSignalToClient(clientAddr: string, signal: StarSignalMessage): Promise<boolean>;
  /**
   * Send SDP Answer to a specific client.
   * Resolves `true` only if ASMail delivery was actually confirmed.
   */
  sendAnswerToClient(clientAddr: string, answer: AnswerSignalPayload): Promise<boolean>;
  /** Send ICE candidate to a specific client */
  sendCandidateToClient(clientAddr: string, candidate: RTCIceCandidateInit): Promise<void>;
  /** Flush any batched ICE candidates for this client immediately (end of gathering). */
  flushCandidatesFor?(clientAddr: string): void;
  /** Drop batched-but-unsent candidates for this client (pc recreate). */
  clearCandidatesFor?(clientAddr: string): void;
  /** Broadcast signal to all clients (optionally excluding one) */
  broadcastSignal(signal: StarSignalMessage, excludeAddr?: string): Promise<void>;
  /** Handle incoming signal from a client */
  handleIncomingSignal(clientAddr: string, msg: StarSignalMessage): void;
  /** Handle incoming WebRTC message from a client (converts to StarSignalMessage internally) */
  handleWebRTCMsg(clientAddr: string, msg: WebRTCMsg): void;
  /** Register handler for signals from a specific client */
  registerClientHandler(
    clientAddr: string,
    handler: StarSignalHandler
  ): () => void;
  /** Add a client to the known clients list (for broadcastSignal) */
  addClient(clientAddr: string): void;
  /** Remove a client from the known clients list */
  removeClient(clientAddr: string): void;
  /**
   * Sets the low-latency DataChannel for a specific client.
   * Once set and open, signals to that client are sent via DC instead of ASMail.
   * ASMail remains as fallback when DC is not yet open or send fails.
   */
  setClientDataChannel?(clientAddr: string, dc: RTCDataChannel): void;
  /** Close the signaling channel */
  close(): void;
}

/**
 * Callback for when a remote track is received.
 * Used by ClientWebRTCChannel to notify about incoming streams.
 */
export type OnRemoteTrackCallback = (
  track: MediaStreamTrack,
  stream: MediaStream,
  fromAddr: string
) => void;

/**
 * Callback for when a client's track is received on host.
 * Used by HostWebRTCChannel to trigger SFU retransmission.
 */
export type OnClientTrackCallback = (
  clientAddr: string,
  track: MediaStreamTrack,
  stream: MediaStream
) => void;

/**
 * Callback for connection state changes.
 */
export type OnConnectionStateChangeCallback = (
  state: ConnectionStatus,
  peerAddr?: string
) => void;

/**
 * Internal signal data structure for Star architecture.
 * Used by both client and host signaling channel implementations.
 */
export interface StarSignalData {
  signalType: StarSignalType;
  fromAddr: string;
  toAddr?: string;
  payload?: unknown;
}

/**
 * Parameters for creating a client signaling channel.
 */
export interface ClientSignalingChannelParams {
  /** Address of the host to send signals to */
  hostAddr: string;
  /** Own address (for signal identification) */
  ownAddr: string;
  /** Chat ID for message routing */
  chatId: ChatIdObj;
  /**
   * Identifier of the call session (see WebRTCMsg.callSessionId), stamped into
   * every signal this channel puts on ASMail. Absent when the host that started
   * the call runs a build that predates session ids.
   */
  callSessionId?: string;
}

/**
 * Parameters for creating a host signaling channel.
 */
export interface HostSignalingChannelParams {
  /** Own address (Host's address) */
  ownAddr: string;
  /** Chat ID for message routing */
  chatId: ChatIdObj;
  /**
   * Identifier of the call session (see WebRTCMsg.callSessionId), stamped into
   * every signal this channel puts on ASMail.
   */
  callSessionId?: string;
}

/**
 * Video quality configuration returned by getVideoQualityConfig().
 */
export interface VideoQualityConfig {
  resolution: { width: number; height: number };
  bitrate: number; // bits per second
  framerate: number;
}

/**
 * Callback for when a remote participant's stream state (mic/cam) changes.
 * Used by Client to receive state updates from other participants via Host.
 */
export type OnRemoteStreamStateChangedCallback = (
  fromAddr: string,
  state: StreamStateInfo
) => void;

/**
 * Callback for when stream sender info is received from Host.
 * Used to map UUID stream IDs to actual sender addresses.
 */
export type OnStreamSenderInfoCallback = (
  streamId: string,
  senderAddr: string,
  screenName?: string,
) => void;

/**
 * Callback for when a participant leaves the call.
 * Used to remove the participant from the UI.
 */
export type OnParticipantLeftCallback = (
  participantAddr: string
) => void;

/**
 * Parameters for creating a client-side WebRTC channel.
 */
export interface ClientChannelParams {
  /** Address of the host to connect to */
  hostAddr: string;
  /** Own address (for logging/identification) */
  ownAddr: string;
  /** WebRTC configuration (ICE servers, etc.) */
  rtcConfig: RTCConfiguration;
  /** Local media stream (camera + mic) to send to host */
  localStream: MediaStream;
  /** Signaling channel for communication with host */
  signalingChannel: ClientSignalingChannel;
  /** Callback when a remote track is received */
  onRemoteTrack: OnRemoteTrackCallback;
  /** Callback when connection state changes */
  onConnectionStateChange: OnConnectionStateChangeCallback;
  /** Callback when a remote participant's stream state changes */
  onRemoteStreamStateChanged?: OnRemoteStreamStateChangedCallback;
  /** Callback when stream sender info is received (for UUID stream ID mapping) */
  onStreamSenderInfo?: OnStreamSenderInfoCallback;
  /** Callback when a participant leaves the call */
  onParticipantLeft?: OnParticipantLeftCallback;
  /**
   * Callback when a participant's transient link status changes (host-relayed
   * 'participant-reconnecting' signal, or this client's own link to the host).
   * `kind` says which of the signal's two meanings this is; absent for a host
   * on a build that predates the field, and for this client's own link.
   */
  onParticipantReconnecting?: (
    addr: string, reconnecting: boolean, kind?: ParticipantReconnectingInfo['kind'],
  ) => void;
  /** Callback when the call is full (max participants reached) */
  onCallFull?: (maxParticipants: number, currentParticipants: number) => void;
  /**
   * Callback fired when the host signals (via DataChannel/ASMail 'disconnect')
   * that it is ending the call. Lets the caller start GUI teardown
   * immediately instead of waiting for the PeerConnection to go 'failed'.
   */
  onHostEndedCall?: () => void;
  /**
   * Group call only: fired once when nothing has been heard from the host
   * for longer than the silence threshold while not connected — i.e. its
   * heartbeats (forwarded by the background) stopped and its 'disconnect'
   * evidently could not reach us. The caller ends the call and closes the
   * window.
   */
  onHostUnreachable?: () => void;
  /**
   * Fired when the host reports (via the 'dropped' signal) that it gave up on
   * this client's link after exhausting its retries. The call itself goes on
   * — the caller ends this window honestly (rejoin stays possible), it must
   * NOT report "host ended the call".
   */
  onDroppedByHost?: () => void;
  /** Total participant count for video quality tier selection (defaults to 2) */
  participantCount?: number;
  /**
   * Group-call mode: a link to the host that cannot be recovered in-place
   * keeps cycling reconnect attempts (status 'reconnecting') instead of
   * reporting 'failed', which ends the call and closes the window. In a 1-1
   * call 'failed' is right — no host means no call — but a group call may
   * well still be going on without us.
   */
  isGroupCall?: boolean;
  /**
   * The call's expected roster, read afresh on every offer: one relay slot per
   * kind per other participant is reserved from it, so a participant joining
   * later needs no renegotiation at all (see relay-slots.ts). A function rather
   * than an array because the roster can grow between a pc and its replacement.
   * Absent (or empty) means no slots — exactly today's behaviour.
   */
  reservedPeers?: () => string[];
  /**
   * A slot's track stopped belonging to `fromAddr` — the host handed that
   * m-line to someone else. Unlike an ordinary relay stream, a slot's msid is
   * fixed for the life of the connection, so the only way a viewer can follow a
   * reassignment is to be told to take the track off the old tile first.
   */
  onRemoteTrackDetached?: (track: MediaStreamTrack, fromAddr: string) => void;
}

/**
 * Callback for when a client's stream state (mic/cam) changes.
 */
export type OnStreamStateChangedCallback = (
  clientAddr: string,
  state: StreamStateInfo
) => void;

/**
 * Parameters for creating a host-side WebRTC channel.
 */
export interface HostChannelParams {
  /** Own address (Host's address) */
  ownAddr: string;
  /** WebRTC configuration (ICE servers, etc.) */
  rtcConfig: RTCConfiguration;
  /** Local media stream (Host's camera + mic) */
  localStream: MediaStream;
  /** Signaling channel for communication with clients */
  signalingChannel: HostSignalingChannel;
  /** Callback when a client connects */
  onClientConnected: (clientAddr: string) => void;
  /** Callback when a client disconnects */
  onClientDisconnected: (clientAddr: string) => void;
  /**
   * Callback reporting per-client ConnectionStatus changes (e.g. 'establishing',
   * 'reconnecting', 'failed') so the UI can show connection progress before
   * the client's track has arrived.
   */
  onClientConnectionStateChange?: (clientAddr: string, state: ConnectionStatus) => void;
  /** Callback when a track is received from a client */
  onClientTrack: OnClientTrackCallback;
  /** Callback when a client's stream state (mic/cam) changes */
  onStreamStateChanged?: OnStreamStateChangedCallback;
  /**
   * Callback when a client sends stream-sender-info (e.g. screen share
   * streamId → screen:addr mapping + optional window name).
   */
  onStreamSenderInfo?: OnStreamSenderInfoCallback;
  /**
   * Callback when a client reports that a participant left
   * (e.g. stopped screen sharing). Used to remove the participant
   * (including screen: pseudo-participants) from the host's UI/store.
   */
  onParticipantLeft?: (participantAddr: string) => void;
  /**
   * Callback when a client's transient link status changes (armed after
   * DISCONNECT_GRACE_MILLIS starts, so peers who cannot see the affected
   * RTCPeerConnection directly can still show a "reconnecting" hint).
   */
  onParticipantReconnecting?: (
    clientAddr: string, reconnecting: boolean, kind?: ParticipantReconnectingInfo['kind'],
  ) => void;
  /** Total participant count for video quality tier selection (defaults to 2) */
  participantCount?: number;
  /**
   * Callback that returns currently-active host screen share tracks.
   * Called after a client's RTCPeerConnection is recreated to re-add
   * the host's own screen tracks (which become `ended` when the old
   * PC is closed). Each entry must contain a live track ready for adding.
   */
  getOwnScreenTracks?: () => Array<{
    track: MediaStreamTrack;
    mailerId: string;
    srcId: string;
    screenName?: string;
  }>;
}

/**
 * Internal state for a connected client on the Host side.
 * Used by the host implementation in host-channel.ts.
 */
export interface ClientConnection {
  clientAddr: string;
  peerConnection: RTCPeerConnection;
  incomingTracks: MediaStreamTrack[];
  outgoingTrackSenders: Map<string, RTCRtpSender[]>; // key = sourceAddr
  /** DataChannel for reliable stream-sender-info delivery (host→client) */
  streamInfoChannel: RTCDataChannel | null;
  /**
   * ICE candidates received from this client before its SDP offer was applied
   * via setRemoteDescription(). WebRTC requires a remote description before
   * addIceCandidate() can succeed, so early candidates are buffered here and
   * flushed once the offer is applied in handleClientOffer(). This prevents
   * candidate errors and avoids re-sending them over ASMail.
   */
  pendingCandidates: RTCIceCandidateInit[];
  /** DataChannel for low-latency SDP signaling (host→client).
   * Once open, offer/answer/candidate bypass ASMail entirely. */
  signalingDataChannel: RTCDataChannel | null;
  /**
   * Perfect Negotiation flag: true while the Host is creating/sending its
   * own offer to this client. Used for collision (glare) detection.
   */
  makingOffer: boolean;
  /**
   * SDP origin (sess-id, sess-version) of the last client offer that was
   * successfully applied via setRemoteDescription(). Used to distinguish a
   * genuinely NEW offer from a retransmission of an already-applied (or
   * older) offer — see parseSdpOrigin() for why a byte-for-byte SDP string
   * comparison is not reliable for this purpose.
   */
  lastAppliedOfferOrigin: { sessionId: string; version: number } | null;
  /**
   * Number of PC recreations already attempted for this client. Capped at
   * MAX_RECONNECT_COUNT to avoid an endless recreate→retry→recreate loop
   * when the client is unreachable.
   */
  recreateCount: number;
  /**
   * Cleanup function for the quality monitor interval started when the
   * connection reaches 'connected' state. Called before starting a new
   * monitor to prevent interval leaks on reconnect.
   */
  stopQualityMonitor?: () => void;
  /**
   * True once the link-down grace period has been extended for this client:
   * the first grace expiry (or 'failed') waits one more period for the
   * client's recreated connection to send a fresh offer; the second removes
   * the client for real. Reset on 'connected'.
   */
  graceExtended?: boolean;
  /**
   * Timestamp of the last offer sent to this client. Lets the ICE-restart
   * recovery distinguish "the answer is still travelling over ASMail" from
   * "the answer is lost" instead of rolling a young offer back into a
   * competing one (see STRANDED_OFFER_ROLLBACK_AGE_MILLIS).
   */
  lastOfferSentAt?: number;
  /**
   * A client offer that arrived while this connection was mid-negotiation and
   * was therefore refused as a glare collision. Over a 5-12s transport the
   * client cannot usefully re-send it for tens of seconds, so instead of
   * dropping it the host keeps the newest one and replays it through
   * handleClientOffer() as soon as signaling returns to 'stable'.
   */
  deferredOffer?: {
    offer: RTCSessionDescriptionInit;
    origin: { sessionId: string; version: number } | null;
    receivedAt: number;
    /** Sender-side send time of that offer, carried through the replay. */
    msgTs?: number;
  } | null;
  /**
   * When this connection last reached 'connected'. An offer stamped earlier
   * than that (StarSignalMessage.msgTs) cannot describe anything newer than
   * what is already running, so it must never cost the client its live pc.
   */
  connectedAt?: number;
  /**
   * Timestamp of the last "peer answered a superseded offer" re-send of our
   * current offer to this client. Throttles that immediate recovery so a burst
   * of stale answers cannot turn into an ASMail send storm.
   */
  lastSupersededReofferAt?: number;
  /**
   * When an SDP answer was last put on its way to this client, by any path: the
   * initial one, a duplicate-offer response, or an answer-retry tick.
   *
   * Two of those can coincide - a duplicate offer arrives and the answer retry
   * watcher fires - and each answer is a multi-KB ASMail message, so one fact
   * cost two of them during a 500 storm. See ANSWER_RESEND_MIN_INTERVAL_MILLIS.
   *
   * Per connection rather than per address on purpose: a re-joining client gets a
   * fresh ClientConnection and must be answered at once.
   */
  lastAnswerSentAt?: number;
}
