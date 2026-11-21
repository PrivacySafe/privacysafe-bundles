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
import type {
  ChatIdObj,
  ChatIncomingMessage,
  WebRTCMsg,
  WebRTCOffBandMessage,
} from '../../types/asmail-msgs.types.ts';
import type { CallStateForGui, VideoChatEvent } from '../../types/services.types.ts';
import type { ChatDbEntry } from '../types/index.ts';

export type WebRTCSignalHandler = (msg: ChatIncomingMessage) => Promise<void>;

export type IncomingCallHandler = (
  chat: ChatDbEntry,
  chatId: ChatIdObj,
  peer: string,
  msg: WebRTCMsg,
) => Promise<void>;

export type WebRTCSignalListener = (signal: WebRTCMsg) => void;

export interface WebRTCSignalingPeerChannel {
  attachGUI(signalsListener: WebRTCSignalListener): void;
  detachGUI(): void;
  handleIncomingSignal(msg: WebRTCMsg): boolean;
  sendMsgToPeer(stage: 'signalling' | 'disconnect', data: WebRTCOffBandMessage): Promise<void>;
}

export interface Peer {
  peerName: string;
  peerAddr: string;
  channel: WebRTCSignalingPeerChannel;
}

export type MakePeerChannelsInChat = (chatId: ChatIdObj, peer: string) => WebRTCSignalingPeerChannel;

export interface VideoComponentInstance {
  focusWindow(): Promise<void>;
  endCall(): Promise<void>;
  /**
   * Drops the RPC connection to the window, once the call it served is over.
   * Called from end(), which also forgets the instance: a handle to a closed
   * window is worse than no handle, because it looks usable.
   */
  close(): void;
  getListenerForChannelTo(peer: string): WebRTCSignalListener;
  /**
   * Reports a signal that the platform failed to deliver to `peer`, so the window
   * can show it on that participant. Optional: a window from a build that
   * predates the method simply keeps showing "waiting".
   */
  notifyOfUndeliveredSignal?(peer: string, stage: WebRTCMsg['stage']): Promise<void>;
  /**
   * Host only: `peer` said it is re-joining the call, ahead of its SDP offer.
   * The window turns this into the 'participant-reconnecting' broadcast every
   * other participant already understands, so a returning peer shows up as
   * "connecting…" tens of seconds before its offer lands. Optional for the
   * same reason as the method above.
   */
  notifyOfRejoiningPeer?(peer: string): Promise<void>;
  /**
   * Turns the window from the host of our call into a client of the call that
   * won a collision with it, in place (see VideoChatComponent.switchToClientOf).
   */
  switchToClientOf?(target: { hostAddr: string; callSessionId?: string }): Promise<void>;
}

/**
 * Role in Star architecture
 */
export type StarRole = 'host' | 'client';

/**
 * Client connection info (for host)
 */
export interface ClientConnectionInfo {
  addr: string;
  name: string;
  isConnected: boolean;
}

export interface CallInChat {
  startCall(): Promise<void>;
  /**
   * `silent` ends the call without telling anyone - no 'disconnect' to peers,
   * and never 'rejoinable'. For when another device of this same user has
   * already handled this call: peers are keyed by address, so anything sent
   * from here would be read as coming from the device that actually joined.
   */
  end(opts?: { silent?: boolean }): Promise<void>;
  endCallInGUI(): Promise<void>;
  /**
   * Closes this device's call window and ends silently, because another device
   * of this user has taken the call. Distinct from both of the above: end()
   * leaves the window up, and endCallInGUI() runs the end-of-call
   * post-processing, which would stamp a duration onto a call that never ran
   * here and synchronize it to the device that is actually in the call.
   */
  stepAsideForOwnDevice(): Promise<void>;
  /**
   * Host only: withdraws this call in favour of another call started in the
   * same chat at the same moment, which won the tie-break (callCollisionWinner
   * in utils/call-state.ts). Closes the window without post-processing; the
   * caller goes on to join the winner's call as a client.
   */
  yieldToRivalCall?(winner: {
    hostAddr: string; callSessionId?: string; startedAt?: number;
  }): Promise<void>;
  /**
   * Host only: turns this call into a client of the winner's, keeping the window
   * open. False when the window could not be asked; then yieldToRivalCall() is
   * the way out.
   */
  switchToClientOf?(winner: {
    hostAddr: string; callSessionId?: string; startedAt?: number;
  }): Promise<boolean>;
  /**
   * Host only: another call ran into this one and lost, so its host is expected
   * to come in as a client; the user is told if it does not.
   */
  noteCollisionWon?(rivalHostAddr: string, rivalSessionId?: string): void;
  /** Host only: when this call's 'start' first went out; undefined before that. */
  getStartedAt?(): number | undefined;
  /** Host only: someone has answered this call. */
  isEstablished?(): boolean;
  hasPeer(addr: string): boolean;
  handleWebRTCSignalFrom(peer: string, webrtcMsg: WebRTCMsg): boolean;

  // Star architecture methods
  /** Initialize role based on call direction */
  initializeRole(direction: 'incoming' | 'outgoing', sender?: string): void;
  /** Register handler for incoming signals */
  onSignal(handler: (peer: string, msg: WebRTCMsg) => void): () => void;
  /** Get current role */
  getRole?(): StarRole | null;
  /** Get host address */
  getHostAddr?(): string | null;
  /** Get list of connected clients (for host) */
  getConnectedClients?(): ClientConnectionInfo[];
  /**
   * Identifier of the call session this object serves (see
   * WebRTCMsg.callSessionId); undefined when the call was started by a peer on
   * a build that predates the field.
   */
  getCallSessionId?(): string | undefined;
  /**
   * Whether a copy of this call's invitation is still worth sending to this
   * peer: false once the call is over, or once someone at that address answered
   * or declined it. The single gate for every repeat of 'start' - the initial
   * schedule inside the call object and the re-send a peer asks for by
   * 'request-start' - because a 'start' that lands after the call is done rings
   * a phantom one (rule and rationale: inviteStillPending in call-state.ts).
   */
  isInvitePending?(peerAddr: string): boolean;
  /**
   * Acts on an invited peer's explicit decline of this call, whichever route it
   * arrived by - the 'call-declined' signal or the declining side's
   * 'incoming-call-cancelled' system message. Idempotent, so both arriving is
   * normal. 'ignored' means the decline was not this call's to act on (see
   * declineEndsCall in utils/call-state.ts).
   *
   * @param msgSessionId which call the decline names, when known; a decline of
   * another call is ignored.
   */
  notePeerDeclined?(peerAddr: string, msgSessionId?: string): 'noted' | 'ignored';
  /**
   * Client-side: the host ended this call, learned via a fallback channel (the
   * host's 'outgoing-call-cancelled' system message) rather than a
   * 'disconnect' signal. Same effect as the signal: announce to the user and
   * tear the call down. Idempotent with the signal paths.
   */
  noteHostEndedCall?(): void;
}

export interface VideoChatSrv {
  handleIncomingWebRTCMsg(msg: ChatIncomingMessage): Promise<void>;
  startVideoCallForChatRoom(chatId: ChatIdObj): Promise<void>;
  /**
   * Returns the id of the call session that was answered or declined, so that
   * the caller can name it in the system message it sends about the cancelled
   * call (see WebRTCMsgBodySysMsgData). The window has no other way to know it -
   * the session id lives here, with the call registry. Undefined when there is
   * no call to act on, or when the call was started by a peer on a build that
   * predates the field.
   */
  joinOrDismissCallInRoom(
    chatId: ChatIdObj, join: boolean, sender?: string, expectedCallSessionId?: string,
  ): Promise<{ handled: boolean; callSessionId?: string }>;
  endVideoCallInChatRoom(chatId: ChatIdObj): Promise<void>;
  /**
   * Snapshot of every call known here, for a GUI catching up on events it
   * never heard. See CallStateForGui.
   */
  getCallsState(): Promise<CallStateForGui[]>;
  watchVideoChats(obs: web3n.Observer<VideoChatEvent>): () => void;
  /**
   * Whether any call is going on (or ringing) right now, in any chat. Lets
   * background maintenance that competes with call signalling for ASMail
   * delivery (e.g. the record-resync pass) stay out of a call's way.
   */
  hasAnyCallInProgress(): boolean;
  /**
   * Whether any call is putting signalling of THIS device on the wire right now.
   *
   * Narrower than hasAnyCallInProgress() by the `ringing` state: a ringing call is
   * live, but everything on the wire is the caller's. For traffic that can wait
   * indefinitely without being lost - the journal of sync phantoms - waiting out
   * an unanswered ring only delays the user's other devices.
   */
  hasAnyCallSignalling(): boolean;
}
