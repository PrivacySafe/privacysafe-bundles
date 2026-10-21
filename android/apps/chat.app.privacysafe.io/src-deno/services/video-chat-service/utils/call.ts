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
 * CallInChat — Star (Host-Client) Architecture Implementation
 *
 * This module manages video calls using Star topology:
 * - Host (direction: 'outgoing'): Call initiator, manages client connections
 * - Client (direction: 'incoming'): Connects to host, receives retransmitted streams
 *
 * Key responsibilities:
 * - GUI window management (open/focus/close)
 * - Heartbeat for group call re-join feature
 * - Signal routing between host and clients
 * - Client connection tracking (for host)
 */

import type { ChatIdObj, WebRTCMsg } from '../../../../types/asmail-msgs.types.ts';
import type { CallFromVideoGUI, ChatInfoForCall, VideoChatEvent } from '../../../../types/services.types.ts';
import type { CallInChat, VideoComponentInstance } from '../../../types/index.ts';
import { areAddressesEqual } from '../../../../shared-libs/address-utils.ts';
import { createDepartureGate } from '../../../../shared-libs/departure-gate.ts';
import { videoComponentInstance } from '../video-component-instance.ts';
import { isRejoinNotice, sendCallFullRejection, sendHeartbeat, sendWebRTCMsg } from './_common.ts';
import { forgetHeartbeatDeliveriesOf } from './heartbeat-delivery.ts';
import { chatIdToString } from '../../../../shared-libs/chat-ids.ts';
import { starSignalTypeOf } from '../../../../shared-libs/webrtc-signalling.ts';
import type { CallState } from './call-state.ts';
import { declineEndsCall, inviteStillPending as invitePendingRule } from './call-state.ts';
import { MAX_CALL_PARTICIPANTS } from '../constants.ts';
import { makeLogger } from '../../../../shared-libs/logger.ts';

const log = makeLogger('CallInChat');

// Heartbeat interval for re-join feature (15 seconds).
// Kept moderate so heartbeats do not congest ASMail delivery and
// do not delay latency-critical WebRTC signalling messages.
const HEARTBEAT_INTERVAL = 15_000;

/**
 * When a departing client gets its out-of-cycle re-join heartbeats, counted from
 * the moment we learned it left (see handleSignalAsHost's 'disconnect' branch).
 *
 * The first delay must be non-zero: the departing client only accepts a
 * heartbeat once its OWN CallInChat for this chat has finished tearing down, and
 * an immediate send races that teardown and is silently dropped there.
 *
 * There is more than one because these beats have a deadline. The departing
 * client keeps its "Join Call" button on a self-made provisional record that
 * expires after PROVISIONAL_REJOIN_TIMEOUT (20s, call-state.ts), and only a real
 * heartbeat converts it into a confirmed one. At the measured ASMail latency
 * (~10s one-way, up to 20s) a single beat sent at 1.5s arrives around 11.5s with
 * no second chance: if that one delivery is among the ones the server 500s on,
 * the button goes out on a call that is still running. Sending at 1.5/4/8s puts
 * three arrivals at roughly 11.5/14/18s, i.e. all three inside the window at
 * nominal latency and at least one of them inside it when a delivery is slow.
 *
 * Cost: two extra ~250 B messages per departure, to a single recipient, which is
 * cheap next to the four copies a 'disconnect' used to cost.
 */
const IMMEDIATE_HEARTBEAT_DELAYS_MS = [1_500, 4_000, 8_000];

/**
 * How long a one-to-one call is kept alive after the invited peer declined it.
 *
 * Two jobs, and both need it to be non-zero:
 * - the call window has just been handed the same signal and needs a moment to
 *   show "X declined the call" before it closes;
 * - a user with several devices may press Join on one and Decline on another. A
 *   decline from an address that is already connected is ignored outright, but
 *   the two signals can also cross in flight - this window lets the joining
 *   device's offer arrive and cancel the teardown.
 *
 * Kept short: past two or three seconds, a decline reads as not having worked.
 */
const DECLINE_TEARDOWN_DELAY_MS = 1500;

/**
 * How long the host that won a collision of two calls (see callCollisionWinner
 * in call-state.ts) waits for the other host to come in as a client, before
 * telling the user that the two calls did not meet.
 *
 * The other host learns of the collision from our 'start' or our notice (one
 * ASMail leg, 7-20 s), then opens a client window and sends a 13-21 KB offer
 * (another leg, slower for its size). A minute covers both at the measured
 * latency, and is still well short of the point where the user gives up.
 */
const COLLISION_JOIN_TIMEOUT_MS = 60_000;

/**
 * Role in Star architecture
 */
type StarRole = 'host' | 'client';

/**
 * Client connection info (for host)
 */
interface ClientConnection {
  addr: string;
  name: string;
  isConnected: boolean;
}

/**
 * Type for post-processing function that handles video chat events.
 * Creates/updates system messages for call tracking.
 */
export type PostProcessingForVideoChat = () => {
  doAfterStartCall: (params: {
    chatId: ChatIdObj;
    direction: 'incoming' | 'outgoing';
    sender?: string;
    /**
     * Makes the record's id the same on every device of this user, so that two
     * of them answering one call leave one line rather than two (see
     * chatMessageIdForCallEvent). Optional: without it the id is generated
     * locally, as it always was.
     */
    callSessionId?: string;
  }) => Promise<void>;
  doAfterEndCall: (chatId: ChatIdObj) => Promise<void>;
};

/**
 * Determines Star role based on call direction.
 * - 'outgoing' (initiator) → 'host'
 * - 'incoming' (recipient) → 'client'
 */
function determineRole(direction: 'incoming' | 'outgoing'): StarRole {
  return direction === 'outgoing' ? 'host' : 'client';
}

export function callInChat({
  info,
  sinkGUIEvents,
  detachFromParent,
  postProcessingForVideoChat,
  notifyUserOnHostEndedCall,
  notifyState,
  onCollisionUnresolved,
}: {
  info: ChatInfoForCall;
  sinkGUIEvents: (event: VideoChatEvent) => void;
  /**
   * @param endState how this call ended:
   * - 'rejoinable': we are a group-call client that left voluntarily while the
   *   host stayed in the call, so the chat should immediately offer a "Join
   *   Call" button;
   * - 'ended-by-host': the host announced the end, so any in-flight heartbeat
   *   must not resurrect that button;
   * - 'ended-by-peer': a peer's 'disconnect' ended the call;
   * - 'ended-by-self': we ended it here.
   */
  detachFromParent: (endState: {
    kind: 'rejoinable' | 'ended-by-host' | 'ended-by-peer' | 'ended-by-self';
    hostAddr?: string;
  }) => void;
  postProcessingForVideoChat: PostProcessingForVideoChat;
  /**
   * Reports this call's state to the service's session registry, which is where
   * every decision about incoming signals for this chat is made (see
   * call-state.ts). The internal `callStage` below stays a purely local guard
   * against repeating teardown; it is not a second source of truth.
   */
  notifyState: (state: CallState) => void;
  /**
   * Shows an OS-level notification in the main window that the host ended
   * the call — needed so the message reaches the user even if the main
   * window is closed (in-window notice is emitted via sinkGUIEvents instead).
   */
  notifyUserOnHostEndedCall?: (params: {
    chatId: ChatIdObj; chatName: string; hostAddr: string; hostName: string;
  }) => Promise<void>;
  /**
   * Host only: the host of a call that ran into this one and lost never came in
   * as a client (see noteCollisionWon). Tells the user and puts it into the
   * chat history, on both sides.
   */
  onCollisionUnresolved?: (rival: { hostAddr: string; callSessionId?: string }) => void;
}): CallInChat {
  let guiInstance: VideoComponentInstance | undefined = undefined;
  /**
   * Set while a call window is being opened, so that a second startCall()
   * waits for that one instead of opening a window of its own. Opening takes
   * seconds - long enough for an impatient second click (2026-09-11).
   */
  let guiOpening: Promise<void> | undefined = undefined;
  let callStage: 'not-started' | 'calling' | 'done' = 'not-started';

  // Heartbeat interval for re-join feature
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined = undefined;

  /**
   * Out-of-cycle re-join heartbeats scheduled for departing clients, keyed by
   * client address. Tracked so that end() can cancel them: a heartbeat that
   * fires after the host ended the call would tell an already-departed
   * participant that the call is still running, turning its "Join Call"
   * button back on with nothing left to clear it until the heartbeat
   * watchdog expires. Also deduplicates repeated leave reports for the same
   * client (in-band GUI report + ASMail 'disconnect' fallback).
   */
  const pendingImmediateHeartbeats = new Map<string, ReturnType<typeof setTimeout>[]>();

  /**
   * Which peer departures have already been acted upon, by send stamp.
   *
   * A 'disconnect' arrives up to four times per departure (blind repeats plus
   * reactive resends), and until this gate each copy re-ran the whole host-side
   * departure path: a ghost-client removal, a 'participant-left' broadcast to
   * everyone else, and an out-of-cycle heartbeat. The broadcast is the harmful
   * one — arriving after the peer has re-joined, it takes its tile off every
   * other participant's screen. See createDepartureGate for why a watermark and
   * not a TTL cache.
   */
  const departures = createDepartureGate();

  /**
   * The same watermark, for the re-join notices of returning clients.
   *
   * A second instance rather than a shared one: an arrival and a departure of
   * one peer are independent events with independent stamps, and one watermark
   * would let whichever came last suppress the other. The module is named after
   * its first use; what it implements is a monotonic per-address watermark with
   * a non-strict comparison, which is exactly what an ASMail repeat calls for
   * here too.
   */
  const arrivals = createDepartureGate();

  /**
   * Whether this call is still on, for the resend of a heartbeat whose delivery
   * the platform reported as failed. Read at resend time, not at send time: a
   * beat accepted after the call ended switches the recipient's "Join Call"
   * button back on with nothing left to clear it.
   */
  const callIsOn = () => callStage !== 'done';

  /**
   * Schedules the out-of-cycle re-join heartbeats for a departing client.
   * See IMMEDIATE_HEARTBEAT_DELAYS_MS for the schedule and why there is one.
   */
  function scheduleImmediateHeartbeat(clientAddr: string): void {
    if (pendingImmediateHeartbeats.has(clientAddr)) {
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    IMMEDIATE_HEARTBEAT_DELAYS_MS.forEach((delayMs, i) => {
      timers.push(setTimeout(() => {
        try {
          // The client re-joined in the meantime: it is in the call, so telling it
          // that a call is available is at best noise, and the whole tail is off -
          // what makes these beats unnecessary does not un-happen.
          if (clients.has(clientAddr)) {
            for (const timer of timers) {
              clearTimeout(timer);
            }
            pendingImmediateHeartbeats.delete(clientAddr);
            return;
          }
          if (i === IMMEDIATE_HEARTBEAT_DELAYS_MS.length - 1) {
            pendingImmediateHeartbeats.delete(clientAddr);
          }
          sendHeartbeat(
            info.chatId, info.ownAddr, [clientAddr], hostAddr || undefined, info.callSessionId,
            callIsOn,
          ).catch(err => {
            w3n.log('error', `Failed immediate re-join heartbeat to ${clientAddr}`, err);
          });
        } catch (err) {
          log.error(`scheduleImmediateHeartbeat timer error for ${clientAddr}:`, err);
        }
      }, delayMs));
    });
    pendingImmediateHeartbeats.set(clientAddr, timers);
  }

  // ===========================================================================
  // Star Architecture State
  // ===========================================================================

  /** Current role (host or client) */
  let role: StarRole | null = null;

  /** Host address (own address if host, or initiator's address if client) */
  let hostAddr: string | null = null;

  // Call direction is stored for future use (e.g., logging, debugging)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let callDirection: 'incoming' | 'outgoing' | null = null;

  /** Connected clients (for host role) */
  const clients = new Map<string, ClientConnection>();

  /** Signal handler for forwarding to GUI */
  let signalHandler: ((peer: string, msg: WebRTCMsg) => void) | null = null;

  /** Flag: set to true when we received a disconnect signal from the other side.
   *  Prevents sending a disconnect back when end() is called as a result of
   *  receiving one. */
  let receivedDisconnect = false;

  /** Flag: client already announced host-ended-call (in-window notice + OS
   *  notification), so the fast (signaling channel) and slow (ASMail) paths
   *  don't both fire it. */
  let hostEndAnnounced = false;

  /** Pending teardown of a one-to-one call the invited peer declined; see
   *  DECLINE_TEARDOWN_DELAY_MS and notePeerDeclined(). */
  let declineTeardownTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  /**
   * Peers whose invitation must no longer be repeated because they said no.
   *
   * Answering needs no such list - it puts the peer into `clients` - but a
   * declined group call leaves no trace there when the peer never sent an offer,
   * and re-sending 'start' at someone who has just declined rings them again.
   */
  const peersThatDeclined = new Set<string>();

  /**
   * Peers who have signalled back - an offer of their own reached us, so someone
   * at that address has been rung and there is nothing left to repeat at them.
   *
   * Deliberately not `clients`: that map is seeded with every invited peer the
   * moment the host role is taken (initializeRole), so it answers "who was
   * called", not "who answered" - reading it as the latter is what killed the
   * repeats of 'start' (see inviteStillPending in call-state.ts). Nor is it
   * `clients.get(addr).isConnected`, which is cleared when a client leaves: a
   * peer who joined and left inside the repeat schedule has been reached, and
   * must not be rung again by a leftover copy of the invitation.
   */
  const peersThatAnswered = new Set<string>();

  /**
   * Host only: when this call's 'start' first went out. Sent in every copy of
   * 'start' and of the collision notice - the tie-break between two calls
   * started at the same moment compares it (see callCollisionWinner). Undefined
   * while the window is still on its media setup screen: nobody has been
   * invited yet, so such a call gives way to any other without a word.
   */
  let startedAt: number | undefined = undefined;

  /**
   * Host only: the other host whose call ran into this one and lost, and the
   * timer that says so to the user if it never comes in as a client. See
   * COLLISION_JOIN_TIMEOUT_MS.
   */
  let collisionRival: string | undefined = undefined;
  let collisionTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  /** Set once this call is being withdrawn in favour of another one; see yieldToRivalCall(). */
  let yieldedTo: string | undefined = undefined;

  /** The gate on the repeats of 'start'; the rule itself is in call-state.ts. */
  function inviteStillPending(peerAddr: string): boolean {
    return invitePendingRule(
      {
        // A call given up for another one (switchToClientOf) goes on as a
        // client of that one - still 'calling' - but its own invitation is
        // withdrawn: a repeat of it would ring the withdrawn session again
        // (live run of 2026-10-06: two copies went out after the switch).
        callIsLive: (callStage === 'calling') && !yieldedTo,
        answered: peersThatAnswered,
        declined: peersThatDeclined,
      },
      peerAddr,
    );
  }

  /**
   * The platform gave up on delivering an invitation. Tells the call window, so
   * that the host sees "could not be reached" on that participant instead of
   * waiting out the no-answer timeout - the two are indistinguishable otherwise,
   * and the difference is the whole diagnosis (group call of 2026-08-12).
   */
  function reportUndeliveredInvite(peerAddr: string): void {
    log.error(
      `[${info.ownAddr}] Invitation to ${peerAddr} for the call in chat `
        + `${info.chatId.chatId} could not be delivered`,
    );
    guiInstance?.notifyOfUndeliveredSignal?.(peerAddr, 'start').catch(err => {
      w3n.log('error', `Failed to tell the call window about undelivered 'start'`, err);
    });
  }

  // ===========================================================================
  // Role Initialization
  // ===========================================================================

  /**
   * Initialize Star role based on call direction.
   * Called when call starts (outgoing) or when joining (incoming).
   */
  function initializeRole(dir: 'incoming' | 'outgoing', sender?: string): void {
    callDirection = dir;
    role = determineRole(dir);

    if (role === 'host') {
      // Host: own address is the host address
      hostAddr = info.ownAddr;

      // Initialize client connections from peers list
      for (const peer of info.peers) {
        clients.set(peer.addr, {
          addr: peer.addr,
          name: peer.name,
          isConnected: false,
        });
      }

      log.debug(`Initialized as HOST (addr: ${hostAddr}, expected clients: ${info.peers.length})`);
    } else {
      // Client: sender is the host (call initiator)
      hostAddr = sender || info.peers[0]?.addr;

      log.debug(`Initialized as CLIENT (host: ${hostAddr})`);
    }
  }

  // ===========================================================================
  // GUI Event Handling
  // ===========================================================================

  async function onRequestCallFromVideoGUI(request: CallFromVideoGUI): Promise<void> {
    try {
      if (!request) {
        return;
      }

      // Ahead of the stage gate below, and deliberately: the window's lines are
      // most worth having when the call is over or falling apart, which is
      // exactly when that gate is shut. Printed as they came - the time, the user
      // address and the scope are already in each line, and this component's
      // clock would only record when the batch arrived (see log-relay.ts).
      if (request.type === 'gui-log') {
        if (Array.isArray(request.lines)) {
          for (const { level, line, details } of request.lines) {
            await w3n.log(level, `[GUI:video] ${line}`, details).catch(() => {});
          }
        }
        return;
      }

      if (callStage !== 'calling') {
        return;
      }

      const { type } = request;
      switch (type) {
        case 'call-started-event': {
          if (yieldedTo) {
            log.info(
              `[${info.ownAddr}] Not starting the call in chat ${info.chatId.chatId}: `
                + `it is being withdrawn in favour of the call of ${yieldedTo}`,
            );
            break;
          }
          // Send 'start' signal to all peers when host confirms call start
          // (user clicked "Start Call" in va-setup.vue)
          if (role === 'host') {
            startedAt ??= Date.now();
            const startMsg: WebRTCMsg = {
              stage: 'start',
              id: Date.now(),
              callSessionId: info.callSessionId,
              data: { startedAt },
            };
            // At `info`: the other end of "did the call even go out" - the
            // recipient's own lifecycle lines say what became of it there.
            log.info(
              `[${info.ownAddr}] Sending 'start' for chat ${info.chatId.chatId} `
                + `(session ${info.callSessionId ?? 'n/a'}) to ${info.peers.length} peer(s): `
                + `${info.peers.map(p => p.addr).join(', ')}`,
            );
            for (const peer of info.peers) {
              sendWebRTCMsg(info.chatId, peer.addr, info.ownAddr, startMsg, {
                stillNeeded: () => inviteStillPending(peer.addr),
                onUndelivered: () => reportUndeliveredInvite(peer.addr),
              }).catch(err => {
                w3n.log('error', `Failed to send call-start signal to ${peer.addr}`, err);
              });
            }
          }

          // NOTE: Heartbeat is no longer started here. Heartbeat is a
          // host-only, group-chat-only mechanism used for the re-join
          // feature, and it only makes sense once at least one client has
          // actually joined the call (see startHeartbeatIfNeeded(), called
          // from handleSignalAsHost() on first accepted client offer).
          // Rationale:
          // - One-to-one calls: if either side leaves, the call itself is
          //   over — there is nothing to re-join, so no heartbeat is sent.
          // - Group calls: if the host ends the call, it cannot be
          //   continued by anyone, so heartbeat must stop (and never
          //   restart) once the host ends it. If only client participants
          //   leave, the call can still be re-joined while the host keeps
          //   it open, which is exactly the re-join scenario heartbeat
          //   supports. Clients themselves never need to send heartbeat.

          sinkGUIEvents({
            type: 'call-started',
            chatId: info.chatId,
          });
          break;
        }

        case 'host-ended-call': {
          // Client's signaling channel reported the host ended the call
          // (DataChannel 'disconnect', faster than the ASMail message).
          announceHostEndedCall();
          teardownFromRemoteDisconnect().catch(err => {
            log.error(`Failed teardown on host-ended-call in chat ${info.chatId.chatId}`, err);
          });
          break;
        }

        case 'peer-left-call': {
          // Host's GUI removed a group-call client (DataChannel 'disconnect',
          // signaling channel close, or grace timeout) — much faster than the
          // ASMail 'disconnect' fallback.
          noteClientLeft(request.peerAddr);
          break;
        }

        // TODO: Add Star-specific event types when CallFromVideoGUI is extended
        // - 'connect-to-host' (for clients)
        // - 'accept-client' (for host)
        // - 'route-signal' (for host)

        default:
          // Ignore unknown event types (Star-specific events not yet in CallFromVideoGUI)
          break;
      }
    } catch (err) {
      await w3n.log('error', `Error in handling request from video component`, err).catch(() => {});
    }
  }

  let guiPostProcessDone = false;

  function finishCallAfterGUI(): void {
    if (guiPostProcessDone) {
      return;
    }
    guiPostProcessDone = true;
    sinkGUIEvents({
      type: 'call-ended',
      chatId: info.chatId,
    });
    end().catch(err => {
      log.error(`[${info.ownAddr}] end() failed in finishCallAfterGUI for chat ${info.chatId.chatId}`, err);
    });
    const { doAfterEndCall } = postProcessingForVideoChat();
    doAfterEndCall(info.chatId).catch(err => {
      log.error(`[${info.ownAddr}] doAfterEndCall failed in finishCallAfterGUI for chat ${info.chatId.chatId}`, err);
    });
  }

  function onGUIComplete(): void {
    log.info(`[${info.ownAddr}] GUI observable completed; finishing call in chat ${info.chatId.chatId}`);
    finishCallAfterGUI();
  }

  function onGUIError(err: web3n.rpc.RPCException): void {
    if (err.connectionClosed) {
      // A call ending because its window's IPC died deserves a line: total
      // suppression here left the resulting "ended-by-self" record with no
      // explanation at all (2026-08-11 revision).
      log.info(`[${info.ownAddr}] GUI IPC connection closed; finishing call in chat ${info.chatId.chatId}`);
    } else {
      w3n.log('error', `IPC to video call window threw an error`, err);
    }
    onGUIComplete();
  }

  /**
   * Remote peer disconnect: full hangup without echoing disconnect.
   * Idempotent via receivedDisconnect + callStage/guiPostProcessDone.
   */
  async function teardownFromRemoteDisconnect(): Promise<void> {
    if (callStage === 'done') {
      return;
    }
    receivedDisconnect = true;
    log.debug('Remote disconnect — full teardown');
    try {
      await endCallInGUI();
    } catch (err) {
      log.error(`[${info.ownAddr}] teardownFromRemoteDisconnect failed in chat ${info.chatId.chatId}`, err);
    }
  }

  /**
   * Reports a state, unless the call is already over: `end()` has the last word
   * on how the call finished, and a late report must not talk over it.
   */
  function reportState(state: CallState): void {
    if (callStage !== 'done') {
      notifyState(state);
    }
  }

  /**
   * Client-side only: announce that the host ended the call — in-window
   * notice (via sinkGUIEvents, picked up by the main window) and an
   * OS-level notification (reaches the user even with the main window
   * closed). Idempotent: the fast (signaling channel) and slow (ASMail)
   * disconnect paths both call this, but only the first one fires it.
   */
  function announceHostEndedCall(): void {
    if (hostEndAnnounced || role !== 'client' || !hostAddr) {
      return;
    }
    hostEndAnnounced = true;
    // The host already ended the call on its side — no point echoing a
    // disconnect back to it.
    receivedDisconnect = true;

    sinkGUIEvents({
      type: 'call-ended-by-host',
      chatId: info.chatId,
      peerAddr: hostAddr,
    });

    const hostName = info.peers.find(p => areAddressesEqual(p.addr, hostAddr!))?.name ?? hostAddr;
    if (notifyUserOnHostEndedCall) {
      notifyUserOnHostEndedCall({
        chatId: info.chatId,
        chatName: info.chatName,
        hostAddr,
        hostName,
      }).catch(err => {
        w3n.log('error', 'Failed to show host-ended-call notification', err);
      });
    }
  }

  // ===========================================================================
  // Call Lifecycle
  // ===========================================================================

  async function startCall(): Promise<void> {
    if (callStage === 'done') {
      return;
    }

    if (callStage === 'not-started') {
      callStage = 'calling';

      // Only initialize as host if role wasn't pre-set.
      // For incoming calls, initializeRole('incoming', sender) is called
      // by joinOrDismissCallInRoom() before startCall().
      if (!role) {
        initializeRole('outgoing');
      }

      // The host has nobody in the call yet, hence 'dialing'; a client has just
      // committed to joining and is about to send its offer, hence 'connecting'.
      reportState(role === 'host' ? 'dialing' : 'connecting');

      // NOTE: 'start' signal sending moved to onRequestCallFromVideoGUI()
      // It will be sent when user clicks "Start Call" in va-setup.vue
      // (triggered by 'call-started-event' from video component)
    }

    if (guiInstance) {
      await guiInstance.focusWindow();
    } else if (guiOpening) {
      // A second click while the first window is still opening. `guiInstance`
      // is only assigned after the await below, so without this the second
      // call took the `else` branch too and opened a SECOND window - which is
      // exactly what a user does when the window takes seconds to appear and
      // nothing on screen says the click was heard.
      log.info(`[${info.ownAddr}] Call window for chat ${info.chatId.chatId} is already opening`);
      await guiOpening;
    } else {
      const opening = videoComponentInstance(info, {
        next: onRequestCallFromVideoGUI,
        complete: onGUIComplete,
        error: onGUIError,
      });
      // Claimed before the first await, and cleared in the finally below: the
      // window between "asked the platform for a window" and "have an
      // instance" is precisely what needs covering.
      guiOpening = opening.then(() => {}, () => {});
      let instance: VideoComponentInstance;
      let startProc: Promise<void>;
      try {
        ({ instance, startProc } = await opening);
      } finally {
        guiOpening = undefined;
      }
      guiInstance = instance;

      // Register signal handler to forward WebRTC signals to GUI
      // This connects Deno's signal handling to the GUI's signaling channel
      onSignal((peer, msg) => {
        try {
          const listener = guiInstance?.getListenerForChannelTo(peer);
          if (listener) {
            listener(msg);
          }
        } catch (err) {
          log.error(`Failed to dispatch WebRTC signal to GUI for peer ${peer}`, err);
        }
      });

      await startProc;

      // The call can be over by now: opening a window takes a moment, and a
      // notice that another device of ours answered this same call arrives on
      // its own schedule. Leaving the window up would give the user a second
      // seat in a call this device has already stepped out of.
      // Through callIsOn(), not a direct comparison: the compiler has narrowed
      // `callStage` to what it was before the awaits above, and the whole point
      // here is that something else may have changed it during them.
      if (!callIsOn()) {
        log.info(
          `[${info.ownAddr}] Call in chat ${info.chatId.chatId} ended while its window was `
            + `opening; closing the window`,
        );
        try {
          await guiInstance.endCall();
        } catch (err) {
          w3n.log('error', `Failed to close the window of a call that had already ended`, err);
        }
        return;
      }

      // NOTE: Heartbeat is no longer started here or in
      // onRequestCallFromVideoGUI(). It is started lazily in
      // startHeartbeatIfNeeded(), called by the host from
      // handleSignalAsHost() once the first client actually joins.
    }
  }

  /**
   * Closes this device's call window and ends the call here silently, because
   * another device of this same user has taken it.
   *
   * Neither end() nor endCallInGUI() fits: the first leaves the window up (a
   * media setup screen sends its offer straight over ASMail, so an open window
   * is a call this device can still join), and the second goes on to the
   * end-of-call post-processing - it would stamp a duration onto a call record
   * for a call that never ran here and synchronize that to the very device that
   * is in the call.
   */
  async function stepAsideForOwnDevice(): Promise<void> {
    if (callStage === 'done') {
      return;
    }
    reportState('winding-down');
    if (guiInstance) {
      try {
        await guiInstance.endCall();
      } catch (err) {
        w3n.log('error', `Failed to close the call window when stepping aside`, err);
      }
    }
    // Claimed before end(), so that the window's own closing - closeSelf leads
    // back here through onGUIComplete - does not run the ordinary path after us.
    guiPostProcessDone = true;
    await end({ silent: true });
  }

  /**
   * Host only: withdraws this call in favour of another one started in the same
   * chat at the same moment, which won the tie-break (callCollisionWinner in
   * call-state.ts). The caller then joins that call as a client.
   *
   * Everyone this call has already invited is told, except the winner's host -
   * it has its own call, and our 'disconnect' would only reach it as a foreign
   * session. The 'disconnect' names the winner (`supersededBy`), so an invitee
   * still ringing for us rings for that call at once rather than on the next
   * repeat of its 'start'. Before the 'start' went out nobody was invited, and
   * nothing is sent at all.
   *
   * The window is closed and the post-processing skipped, as in
   * stepAsideForOwnDevice(): this call did not run, and the end of the call the
   * user is about to join will be recorded by that call.
   */
  async function yieldToRivalCall(winner: {
    hostAddr: string; callSessionId?: string; startedAt?: number;
  }): Promise<void> {
    if (callStage === 'done') {
      return;
    }
    // Claimed first: from here on a click on "Start" in the window must not
    // send a 'start' for a call that is being withdrawn.
    yieldedTo = winner.hostAddr;
    reportState('winding-down');
    log.info(
      `[${info.ownAddr}] Withdrawing the call in chat ${info.chatId.chatId} `
        + `(session ${info.callSessionId ?? 'n/a'}) in favour of the call of ${winner.hostAddr} `
        + `(session ${winner.callSessionId ?? 'n/a'})`,
    );
    withdrawInvitations(winner);
    if (guiInstance) {
      try {
        await guiInstance.endCall();
      } catch (err) {
        w3n.log('error', `Failed to close the call window when withdrawing the call`, err);
      }
    }
    guiPostProcessDone = true;
    await end({ silent: true });
  }

  /**
   * Host only, and only once: tells everyone this call has invited - except the
   * winner's host, which has its own call - that it is withdrawn in favour of the
   * winner's. The 'disconnect' names the winner (`supersededBy`), so an invitee
   * still ringing for us rings for that call at once. Before our 'start' went
   * out nobody was invited, and nothing is sent at all.
   */
  function withdrawInvitations(winner: {
    hostAddr: string; callSessionId?: string; startedAt?: number;
  }): void {
    if ((role !== 'host') || (startedAt === undefined)) {
      return;
    }
    const disconnectMsg: WebRTCMsg = {
      stage: 'disconnect',
      id: Date.now(),
      callSessionId: info.callSessionId,
      data: { supersededBy: winner },
    };
    for (const peer of info.peers) {
      if (areAddressesEqual(peer.addr, winner.hostAddr)) {
        continue;
      }
      sendWebRTCMsg(info.chatId, peer.addr, info.ownAddr, disconnectMsg).catch(err => {
        w3n.log('error', `Failed to withdraw the invitation of ${peer.addr}`, err);
      });
    }
    // Nothing of our own call is left to announce, and this is what keeps a
    // second call from sending a second set of these.
    startedAt = undefined;
  }

  /**
   * Host only: turns this call - nobody has answered it - into a client of the
   * call that won a collision with it, keeping the window open (see
   * VideoChatComponent.switchToClientOf). The window keeps the devices the user
   * picked, and on the call page swaps its host channel for a client one.
   *
   * Returns false when the window cannot be asked - none is open, or it did not
   * answer - and the caller falls back on closing it and opening a client one,
   * which is what yieldToRivalCall() does. By then this object already speaks
   * for the winner's call, so that fallback withdraws nothing a second time.
   */
  async function switchToClientOf(winner: {
    hostAddr: string; callSessionId?: string; startedAt?: number;
  }): Promise<boolean> {
    if ((callStage !== 'calling') || (role !== 'host')) {
      return false;
    }
    // Claimed first, like in yieldToRivalCall(): a click on "Start" racing this
    // switch must not send a 'start' for the call being given up.
    yieldedTo = winner.hostAddr;
    log.info(
      `[${info.ownAddr}] Switching the call in chat ${info.chatId.chatId} to client of `
        + `${winner.hostAddr} (session ${winner.callSessionId ?? 'n/a'}), giving up our `
        + `session ${info.callSessionId ?? 'n/a'}`,
    );
    withdrawInvitations(winner);

    if (collisionTimer !== undefined) {
      clearTimeout(collisionTimer);
      collisionTimer = undefined;
    }
    collisionRival = undefined;
    if (heartbeatInterval !== undefined) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = undefined;
    }
    clients.clear();
    peersThatAnswered.clear();
    peersThatDeclined.clear();

    // From here on this object serves the winner's call: every signal it sends
    // and every check of an incoming one goes by these.
    info.callSessionId = winner.callSessionId;
    info.direction = 'incoming';
    info.hostAddr = winner.hostAddr;
    initializeRole('incoming', winner.hostAddr);

    if (!guiInstance && guiOpening) {
      await guiOpening;
    }
    if (!guiInstance?.switchToClientOf) {
      return false;
    }
    try {
      await guiInstance.switchToClientOf({
        hostAddr: winner.hostAddr, callSessionId: winner.callSessionId,
      });
      return true;
    } catch (err) {
      w3n.log('error', `The call window did not switch to a client of ${winner.hostAddr}`, err);
      return false;
    }
  }

  /**
   * Host only: another call ran into this one and lost the tie-break, so its
   * host is expected to come in as a client. If it does not - a build that
   * cannot step aside, a notice lost on the way - the user is told why the
   * person they are calling is "not responding": they were calling at the very
   * same moment.
   */
  function noteCollisionWon(rivalHostAddr: string, rivalSessionId?: string): void {
    if ((callStage === 'done') || (role !== 'host') || collisionRival) {
      return;
    }
    collisionRival = rivalHostAddr;
    collisionTimer = setTimeout(() => {
      collisionTimer = undefined;
      if ((callStage !== 'calling')
        || Array.from(peersThatAnswered).some(a => areAddressesEqual(a, rivalHostAddr))) {
        return;
      }
      log.info(
        `[${info.ownAddr}] ${rivalHostAddr}, whose call ran into ours in chat `
          + `${info.chatId.chatId}, has not come in within ${COLLISION_JOIN_TIMEOUT_MS}ms`,
      );
      onCollisionUnresolved?.({ hostAddr: rivalHostAddr, callSessionId: rivalSessionId });
    }, COLLISION_JOIN_TIMEOUT_MS);
  }

  /**
   * @param opts.silent ends the call without telling anyone: no 'disconnect' to
   * peers, and never 'rejoinable'. Used when another device of this same user
   * has already answered or declined this call. Peers are keyed by address, so
   * a signal from this device is indistinguishable from one sent by the device
   * that actually joined - a 'disconnect' here would tear down that live call
   * (see the 1-1 branch of handleSignalAsHost), and a 'rejoinable' state would
   * offer a second seat in the call to the same person.
   */
  async function end(opts?: { silent?: boolean }): Promise<void> {
    if (callStage === 'done') {
      return;
    }
    const silent = !!opts?.silent;

    // Every path into end() passes through 'winding-down' before the terminal
    // state, not only endCallInGUI(): the GUI→deno path (closeSelf →
    // onGUIComplete → finishCallAfterGUI) used to jump straight from a live
    // state to 'rejoinable'/'ended', and call-state's transition table is
    // stricter about those jumps. Re-reporting the same state is a no-op, so
    // the endCallInGUI() path is unaffected.
    reportState('winding-down');

    // Stop heartbeat interval
    if (heartbeatInterval !== undefined) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = undefined;
    }

    // Cancel any out-of-cycle heartbeat still pending for a departed client:
    // once this call is over, telling anyone that it is still active would
    // wrongly re-show their "Join Call" button.
    for (const timers of pendingImmediateHeartbeats.values()) {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }
    pendingImmediateHeartbeats.clear();

    // Same reason as the timers above, for the beats already handed to the
    // delivery sub-system: a reported failure must not turn into a resend now
    // that the call is over.
    forgetHeartbeatDeliveriesOf(chatIdToString(info.chatId));

    // Departure watermarks belong to this call only: the next call in this chat
    // gets a fresh CallInChat anyway, and keeping them would risk a clock-based
    // comparison across sessions.
    departures.clear();
    arrivals.clear();

    // The call is ending anyway; a pending decline teardown has nothing left to
    // do, and must not run against the next call in this chat.
    if (declineTeardownTimer !== undefined) {
      clearTimeout(declineTeardownTimer);
      declineTeardownTimer = undefined;
    }
    if (collisionTimer !== undefined) {
      clearTimeout(collisionTimer);
      collisionTimer = undefined;
    }

    // How this call ended. Computed before the state-clearing block below nulls
    // role/hostAddr. 'rejoinable' is the only kind that keeps the chat offering
    // a "Join Call" button, and it needs all three conditions: we are a client
    // (the host cannot re-join its own call), the chat is a group one (in 1-1
    // the call is over when either side leaves), and we were not told to leave.
    const endState = (!silent && (role === 'client') && hostAddr && info.chatId.isGroupChat
      && !hostEndAnnounced && !receivedDisconnect)
      ? { kind: 'rejoinable' as const, hostAddr }
      : (hostEndAnnounced
        ? { kind: 'ended-by-host' as const, hostAddr: hostAddr ?? undefined }
        : (receivedDisconnect
          ? { kind: 'ended-by-peer' as const, hostAddr: hostAddr ?? undefined }
          : { kind: 'ended-by-self' as const, hostAddr: hostAddr ?? undefined }));

    // Send disconnect signal to peers (unless we received one from them)
    if (!receivedDisconnect && !silent) {
      const disconnectMsg: WebRTCMsg = {
        stage: 'disconnect',
        id: Date.now(),
        callSessionId: info.callSessionId,
        data: {},
      };

      if (role === 'host') {
        // Everyone this call was offered to, whether or not they got as far as
        // connecting. An invited peer who never answered needs this signal just
        // as much as a connected one: it is what takes the ringtone and the
        // Join/Decline buttons off their screen, and what puts the cancelled
        // call into their history (sendWebRTCMsg attaches the
        // 'outgoing-call-cancelled' system message to a 'disconnect'). Nothing
        // else would ever tell them - there is no timeout on a ringing call -
        // so a host who hung up before anyone picked up used to leave the
        // invitee ringing indefinitely.
        //
        // In a group call it also clears the "Join" button of participants who
        // had left the call earlier and are still tracked by the heartbeat
        // re-join mechanism (see video-chat-service.ts), instead of making them
        // wait out the heartbeat timeout.
        //
        // `info.peers` rather than `clients`: for the host the two hold the same
        // addresses, but `clients` loses an entry on each 'disconnect' it
        // handles, and someone who left is exactly who this must still reach.
        log.debug(`[${info.ownAddr}] Host ending call, notifying ${info.peers.length} peers`);
        for (const peer of info.peers) {
          sendWebRTCMsg(info.chatId, peer.addr, info.ownAddr, disconnectMsg).catch(err => {
            w3n.log('error', `Failed to send disconnect to ${peer.addr}`, err);
          });
        }
      } else if (role === 'client' && hostAddr) {
        // Client: notify host about disconnect
        log.debug(`[${info.ownAddr}] Client disconnecting from host: ${hostAddr}`);
        sendWebRTCMsg(info.chatId, hostAddr, info.ownAddr, disconnectMsg).catch(err => {
          w3n.log('error', `Failed to send disconnect to host ${hostAddr}`, err);
        });
      }
    }

    // At `info`, and after the block above so it can name `endState`: how a call
    // finished is the one thing every report about calls needs, and the kind
    // says which of the paths into end() was taken.
    log.info(
      `[${info.ownAddr}] Call in chat ${info.chatId.chatId} ended: ${endState.kind} `
        + `(role: ${role ?? 'none'}, silent: ${silent})`,
    );

    // Clear state
    clients.clear();
    signalHandler = null;
    role = null;
    hostAddr = null;
    callDirection = null;

    // The window this pointed at is gone, and holding on to it is not free:
    // startCall() takes the `if (guiInstance)` branch and calls focusWindow()
    // over an IPC connection to a closed window - which either throws where
    // nothing catches it, or, if the connection is only half dead, never
    // returns at all and takes the whole start of the next call with it.
    // Dropping the connection too, because nothing else ever did: one leaked
    // per call (see videoComponentInstance).
    if (guiInstance) {
      const closingInstance = guiInstance;
      guiInstance = undefined;
      try {
        closingInstance.close();
      } catch (err) {
        log.debug(`[${info.ownAddr}] Closing the call window's IPC connection threw`, err);
      }
    }

    callStage = 'done';
    detachFromParent(endState);
  }

  /**
   * Close GUI (full hangup path) and ensure CallInChat reaches `done`.
   * Idempotent: safe if GUI already closed or end() already ran.
   */
  async function endCallInGUI(): Promise<void> {
    if (callStage === 'done') {
      return;
    }

    reportState('winding-down');

    if (guiInstance) {
      try {
        await guiInstance.endCall();
      } catch (err) {
        w3n.log('error', 'endCallInGUI: GUI endCall failed', err);
      }
    }

    // closeSelf → onGUIComplete may race with this path; finishCallAfterGUI is
    // idempotent so always invoke to guarantee CallInChat leaves `calling`.
    log.debug('endCallInGUI — finishing CallInChat after GUI path');
    finishCallAfterGUI();
  }

  // ===========================================================================
  // Signal Handling
  // ===========================================================================

  /**
   * Check if address is a known participant.
   * - Host: checks if addr is in clients map
   * - Client: checks if addr is the host
   */
  function hasPeer(addr: string): boolean {
    if (role === 'host') {
      return clients.has(addr);
    } else if (role === 'client') {
      return addr === hostAddr;
    }
    return false;
  }

  /**
   * Handle incoming WebRTC signal.
   *
   * Host behavior:
   * - Receives signals from clients
   * - Routes signals to appropriate handlers
   *
   * Client behavior:
   * - Receives signals from host
   * - Forwards to GUI for processing
   */
  function handleWebRTCSignalFrom(peer: string, webrtcMsg: WebRTCMsg): boolean {
    if (callStage !== 'calling') {
      return false;
    }

    if (role === 'host') {
      return handleSignalAsHost(peer, webrtcMsg);
    } else if (role === 'client') {
      return handleSignalAsClient(peer, webrtcMsg);
    }

    return false;
  }

  /**
   * Start heartbeat (re-join feature) for the host, if not already running.
   *
   * Heartbeat is host-only and group-chat-only:
   * - One-to-one calls: if either side leaves, the call itself is over —
   *   there is nothing to re-join, so heartbeat is never started.
   * - Group calls: only the host can meaningfully signal "call still
   *   active", since only the host closing the call actually ends it for
   *   everyone. Clients never send heartbeat.
   *
   * Started lazily, once at least one client has actually joined (first
   * accepted offer), rather than immediately on "Start Call", so idle
   * hosts waiting for participants don't emit re-join notifications.
   *
   * Every tick targets ALL peers, joined ones included. For a peer without a
   * running call the heartbeat is what drives the "Join" button (re-join
   * feature); a peer whose call is registered never gets that button — its
   * background forwards the heartbeat into the call window instead, where it
   * feeds the host-silence watchdog. `clients.get(addr)?.isConnected` is NOT
   * a usable filter here: it flips true on the first accepted offer, long
   * before (and regardless of whether) the WebRTC link actually works, so a
   * client stuck connecting was exactly the one left without heartbeats.
   */
  function startHeartbeatIfNeeded(): void {
    if (!info.chatId.isGroupChat || heartbeatInterval !== undefined) {
      return;
    }
    heartbeatInterval = setInterval(() => {
      try {
        const peerAddrs = info.peers.map(p => p.addr);
        if (peerAddrs.length === 0) {
          return;
        }
        // Pass host address so recipients can re-join as CLIENT, and the session
        // id so a heartbeat of a finished call is recognized as such.
        sendHeartbeat(
          info.chatId, info.ownAddr, peerAddrs, hostAddr || undefined, info.callSessionId,
          callIsOn,
        ).catch(err => {
          w3n.log('error', `Failed to send heartbeat for chat ${info.chatId.chatId}`, err);
        });
      } catch (err) {
        log.error(`startHeartbeatIfNeeded timer error for chat ${info.chatId.chatId}:`, err);
      }
    }, HEARTBEAT_INTERVAL);
    log.debug(`Heartbeat started for group chat after first client joined`);
  }

  /**
   * Host: a group-call client has left, as reported in-band by our own GUI
   * (DataChannel 'disconnect', signaling channel close, or grace timeout).
   *
   * The GUI learns this within ~150ms, whereas the ASMail 'disconnect' that
   * drives handleSignalAsHost's 'disconnect' branch takes a full delivery
   * leg, so this is the fast path for both dropping the client from our
   * bookkeeping and getting it its re-join heartbeat. Deliberately does NOT
   * forward anything back to the GUI: the GUI is the source of this report
   * and has already removed the participant.
   *
   * 1-1 calls are left to the existing paths, which tear the whole call down.
   */
  function noteClientLeft(clientAddr: string): void {
    if (role !== 'host' || !info.chatId.isGroupChat || callStage === 'done') {
      return;
    }
    const client = clients.get(clientAddr);
    if (client) {
      client.isConnected = false;
      clients.delete(clientAddr);
      log.debug(`[${info.ownAddr}] Client left (in-band GUI report): ${clientAddr}`);
    }
    scheduleImmediateHeartbeat(clientAddr);
  }

  /** Calls off a pending decline teardown, because the call is going ahead. */
  function cancelDeclineTeardown(reason: string): void {
    if (declineTeardownTimer === undefined) {
      return;
    }
    clearTimeout(declineTeardownTimer);
    declineTeardownTimer = undefined;
    log.info(
      `[${info.ownAddr}] Call in chat ${info.chatId.chatId} is going ahead after all `
        + `(${reason}); cancelling the teardown scheduled on decline`,
    );
  }

  /**
   * An invited peer explicitly declined this call.
   *
   * The single place where a decline's consequences are decided, for both routes
   * a decline reaches us by: the 'call-declined' signal (handleSignalAsHost) and
   * the declining side's 'incoming-call-cancelled' system message, which travels
   * an ordinary delivery and is the fallback when the signal is lost (see
   * onIncomingCallSysMsg in video-chat-service.ts). Idempotent, so both arriving
   * is normal rather than a problem.
   *
   * In a one-to-one call the decline ends it - see declineEndsCall() for why
   * nothing else would - after DECLINE_TEARDOWN_DELAY_MS. In a group call it only
   * marks the peer as not connected, and keeps its `clients` entry so a later
   * re-invite or heartbeat re-join works as before.
   *
   * Returns whether the decline was acted upon; 'ignored' also means the caller
   * should not pass it on to the call window.
   *
   * @param msgSessionId which call the decline names, when its carrier says so.
   * Checked here as well as by the callers, so that the function stays sound on
   * its own: it is what keeps a decline of an earlier call - the system message
   * route replays those from the inbox - from ending the call going on now.
   */
  function notePeerDeclined(
    peerAddr: string, msgSessionId?: string,
  ): 'noted' | 'ignored' {
    if (msgSessionId && info.callSessionId && (msgSessionId !== info.callSessionId)) {
      log.info(
        `[${info.ownAddr}] Ignoring 'call-declined' from ${peerAddr} in chat `
          + `${info.chatId.chatId}: it names call ${msgSessionId}, this one is `
          + `${info.callSessionId}`,
      );
      return 'ignored';
    }
    const client = clients.get(peerAddr);
    // Checked here rather than left to the callers: the system-message route
    // does not go through handleSignalAsHost, which is where a signal's sender
    // is matched against this call's peers. A decline can only come from someone
    // this call was offered to.
    if (!client && !info.peers.some(p => areAddressesEqual(p.addr, peerAddr))) {
      log.info(
        `[${info.ownAddr}] Ignoring 'call-declined' from ${peerAddr} in chat `
          + `${info.chatId.chatId}: not a peer of this call`,
      );
      return 'ignored';
    }
    const outcome = declineEndsCall({
      isGroupChat: info.chatId.isGroupChat,
      role,
      callIsLive: (callStage === 'calling'),
      peerIsConnected: !!client?.isConnected,
    });

    if (outcome === 'ignore') {
      log.info(
        `[${info.ownAddr}] Ignoring 'call-declined' from ${peerAddr} in chat `
          + `${info.chatId.chatId}: ${client?.isConnected
            ? 'that address is connected to this call'
            : `nothing to decline here (role: ${role ?? 'none'}, stage: ${callStage})`}`,
      );
      return 'ignored';
    }

    if (client) {
      client.isConnected = false;
    }
    // Before the branch on what the decline does to the call: whatever that is,
    // this peer is done being invited (see inviteStillPending).
    peersThatDeclined.add(peerAddr);

    if (outcome === 'note') {
      log.info(
        `[${info.ownAddr}] Peer ${peerAddr} declined the group call in chat `
          + `${info.chatId.chatId}; the call goes on`,
      );
      return 'noted';
    }

    if (declineTeardownTimer !== undefined) {
      return 'noted';
    }
    log.info(
      `[${info.ownAddr}] Peer ${peerAddr} declined the one-to-one call in chat `
        + `${info.chatId.chatId}; ending it in ${DECLINE_TEARDOWN_DELAY_MS}ms`,
    );
    declineTeardownTimer = setTimeout(() => {
      try {
        declineTeardownTimer = undefined;
        if (callStage === 'done') {
          return;
        }
        // Someone at that address joined while we were waiting (their offer and
        // the decline crossed in flight): the call is live and must not be torn
        // down. Normally cancelDeclineTeardown() has already fired on the offer;
        // this is the same check made once more, at the last moment.
        if (Array.from(clients.values()).some(c => c.isConnected)) {
          log.info(
            `[${info.ownAddr}] Not ending the call in chat ${info.chatId.chatId} after the `
              + `decline: a peer is connected to it`,
          );
          return;
        }
        log.info(
          `[${info.ownAddr}] One-to-one call in chat ${info.chatId.chatId} was declined; `
            + `ending the call`,
        );
        // endCallInGUI() rather than teardownFromRemoteDisconnect(): the latter
        // sets `receivedDisconnect`, which would suppress the 'disconnect' that
        // end() sends to every invited peer. That 'disconnect' is wanted here - it
        // is what stops the ringtone on the *other* devices of the person who
        // declined (a lost 'call-handled-elsewhere' has no other recovery), and it
        // is what puts the cancelled call into the chat history.
        endCallInGUI().catch(err => {
          w3n.log('error', `Failed to end the call declined by ${peerAddr}`, err);
        });
      } catch (err) {
        log.error(`declineTeardownTimer error for peer ${peerAddr}:`, err);
      }
    }, DECLINE_TEARDOWN_DELAY_MS);
    return 'noted';
  }

  /**
   * Host: Handle signal from a client.
   */
  function handleSignalAsHost(clientAddr: string, webrtcMsg: WebRTCMsg): boolean {
    log.debug(`[${info.ownAddr}] handleSignalAsHost from ${clientAddr}, stage: ${webrtcMsg.stage}, known clients: ${Array.from(clients.keys()).join(', ')}`);

    // A repeat of a departure already handled. Taken before the re-registration
    // below, not merely at the head of the 'disconnect' branch: a copy arriving
    // after the client was dropped would otherwise re-create its `clients` entry
    // on the way to being ignored. `true` so the copy still leaves the inbox —
    // it was understood, it just has nothing left to do.
    if ((webrtcMsg.stage === 'disconnect')
      && departures.isRepeat(clientAddr, webrtcMsg.id)) {
      log.debug(
        `[${info.ownAddr}] Ignoring repeated 'disconnect' from ${clientAddr} `
          + `(sent at ${webrtcMsg.id}, already handled)`,
      );
      return true;
    }

    let client = clients.get(clientAddr);
    if (!client) {
      // This may be a re-join: the participant left earlier and was removed
      // from the clients map on 'disconnect'. Group chat membership was
      // already verified in handleIncomingWebRTCMsg(), and the original
      // clients list was built from info.peers — so re-register the client
      // if it is a known chat peer.
      const peer = info.peers.find(p => areAddressesEqual(p.addr, clientAddr));
      if (!peer) {
        log.warn(`Host received signal from unknown client: ${clientAddr}. Known clients: ${Array.from(clients.keys()).join(', ')}`);
        return false;
      }
      log.debug(`Re-registering re-joining client: ${clientAddr}`);
      client = { addr: peer.addr, name: peer.name, isConnected: false };
      clients.set(clientAddr, client);
    }

    const data = Array.isArray(webrtcMsg.data) ? webrtcMsg.data[0] : webrtcMsg.data;

    // The real signal type: `description.type` is a placeholder 'offer' for
    // EVERY star signal on the ASMail path (see starSignalTypeOf) — branching
    // on it treated each candidate/stream-state as an SDP offer, flipping
    // isConnected, running capacity checks and starting heartbeats spuriously.
    const starType = starSignalTypeOf(webrtcMsg);
    const isRealOffer = starType ? (starType === 'offer') : (data?.description?.type === 'offer');
    const isCandidate = starType
      ? (starType === 'candidate' || starType === 'candidates')
      : !!data?.candidate;

    // Ahead of the offer branch on purpose: this is what the returning client
    // sends BEFORE its offer, and the whole point of it is to be acted upon
    // some tens of seconds earlier than that offer arrives. Not a Star signal,
    // so it is not passed on to the GUI channel (which would only log an
    // unknown type) - the window is told through its own method instead.
    // `true` regardless: understood, and the copy may leave the inbox.
    if (isRejoinNotice(webrtcMsg)) {
      if (arrivals.isRepeat(clientAddr, webrtcMsg.id)) {
        log.debug(
          `[${info.ownAddr}] Ignoring repeated re-join notice from ${clientAddr} `
            + `(sent at ${webrtcMsg.id}, already handled)`,
        );
        return true;
      }
      log.info(`[${info.ownAddr}] ${clientAddr} announced a re-join, ahead of its offer`);
      guiInstance?.notifyOfRejoiningPeer?.(clientAddr).catch(err => {
        w3n.log('error', `Failed to pass the re-join notice of ${clientAddr} to the call window`, err);
      });
      return true;
    }

    if (isRealOffer) {
      // Client sent SDP Offer
      log.debug(`Host received offer from client: ${clientAddr}`);

      // Mark client as connecting
      client.isConnected = true;

      // Someone at this address has been rung and answered, so the invitation
      // needs no further copies - now or after this client leaves again (see
      // peersThatAnswered).
      peersThatAnswered.add(clientAddr);

      // Someone at this address is joining, so a decline of this call - from
      // another device of that same person - must not end it.
      cancelDeclineTeardown(`offer from ${clientAddr}`);

      // Check if we can accept more clients
      const connectedCount = Array.from(clients.values()).filter(c => c.isConnected).length;
      if (connectedCount >= MAX_CALL_PARTICIPANTS - 1) {
        log.warn(`Host at max capacity (${MAX_CALL_PARTICIPANTS}), rejecting client: ${clientAddr}`);
        // Send call-full rejection signal to the client
        sendCallFullRejection(
          info.chatId, clientAddr, info.ownAddr, connectedCount + 1, info.callSessionId,
        ).catch(err => {
          w3n.log('error', `Failed to send call-full rejection to ${clientAddr}`, err);
        });
        // Do NOT add/register this client — just return
        client.isConnected = false;
        return false;
      }

      // A peer has exchanged SDP with us (the answer follows immediately in the
      // GUI), so the call is no longer merely 'dialing'.
      reportState('active');

      // Start heartbeat (re-join feature) now that at least one client has
      // actually joined the group call. Heartbeat is host-only and only
      // targets peers who are not currently connected, so participants
      // already in the call never receive it and never see a "Join" button.
      startHeartbeatIfNeeded();
    } else if (isCandidate) {
      // ICE candidate from client
      log.debug(`Host received ICE candidate from client: ${clientAddr}`);
    } else if (data?.callDeclined) {
      // The whole policy - including which declines are another device of the
      // same person dismissing its ringing UI, and what a decline does to a
      // one-to-one call - lives in notePeerDeclined(). An ignored one is not
      // passed on to the GUI either: there is nothing for its banner to say.
      if (notePeerDeclined(clientAddr) === 'ignored') {
        return true;
      }
      // Falls through to the GUI, whose banner then says "X declined the call".
    } else if (webrtcMsg.stage === 'disconnect') {
      // Client disconnecting
      log.debug(`Client disconnected: ${clientAddr}`);
      client.isConnected = false;
      clients.delete(clientAddr);

      // For one-to-one calls: full teardown (GUI close + CallInChat done)
      if (!info.chatId.isGroupChat) {
        log.debug(`One-to-one call: client left, full host teardown`);
        teardownFromRemoteDisconnect().catch(err => {
          log.error(`Failed teardown on 1-to-1 client disconnect in chat ${info.chatId.chatId}`, err);
        });
        return true;
      }

      // For group calls: forward disconnect signal to GUI so it can
      // remove the participant from the UI and show a notification
      if (signalHandler) {
        signalHandler(clientAddr, webrtcMsg);
      }

      // Speed up the re-join "Join" button: the regular heartbeat only ticks
      // every HEARTBEAT_INTERVAL (15s), so a client who just left could
      // otherwise wait that long to see it. Send this client an
      // out-of-cycle heartbeat shortly after leaving; the regular tick
      // remains as a fallback if this one is lost or arrives too early.
      // No-op if the GUI already reported this departure in-band.
      scheduleImmediateHeartbeat(clientAddr);

      return true;
    }

    // Forward signal to GUI for WebRTC processing
    if (signalHandler) {
      signalHandler(clientAddr, webrtcMsg);
    }

    return true;
  }

  /**
   * Client: Handle signal from host.
   */
  function handleSignalAsClient(hostPeer: string, webrtcMsg: WebRTCMsg): boolean {
    log.debug(`[${info.ownAddr}] handleSignalAsClient from ${hostPeer}, stage: ${webrtcMsg.stage}, expected host: ${hostAddr}`);

    // Verify signal is from host. areAddressesEqual, not `!==`: a case or
    // whitespace difference silently dropped EVERY host signal.
    if (!hostAddr || !areAddressesEqual(hostPeer, hostAddr)) {
      log.warn(`Client received signal from non-host: ${hostPeer}`);
      return false;
    }

    const data = Array.isArray(webrtcMsg.data) ? webrtcMsg.data[0] : webrtcMsg.data;

    // See handleSignalAsHost: description.type is a placeholder on the ASMail
    // path. Before this, the 'answer' branch here was dead code — a client's
    // session record could never reach 'active' by this route.
    const starType = starSignalTypeOf(webrtcMsg);
    const isRealAnswer = starType ? (starType === 'answer') : (data?.description?.type === 'answer');
    const isCandidate = starType
      ? (starType === 'candidate' || starType === 'candidates')
      : !!data?.candidate;

    if (isRealAnswer) {
      // Host sent SDP Answer — the offer/answer exchange completed, so this is
      // where a client's call stops being merely 'connecting'.
      log.debug(`Client received answer from host`);
      reportState('active');
    } else if (isCandidate) {
      // ICE candidate from host
      log.debug(`Client received ICE candidate from host`);
    } else if (webrtcMsg.stage === 'disconnect') {
      // Host disconnecting (call ended) — full teardown. This is the ASMail
      // fallback path; announceHostEndedCall() is idempotent, so it is a
      // no-op if the faster signaling-channel path already announced it.
      log.debug(`Host disconnected, full client teardown`);
      announceHostEndedCall();
      teardownFromRemoteDisconnect().catch(err => {
        log.error(`Failed teardown on host disconnect in chat ${info.chatId.chatId}`, err);
      });
      return true;
    } else if (data?.description?.sdp) {
      // Star signal (stream-state-changed, etc.)
      log.debug(`Client received Star signal from host: ${data.description.sdp.substring(0, 80)}...`);
    }

    // Forward signal to GUI for WebRTC processing
    if (signalHandler) {
      log.debug(`Forwarding signal to GUI via signalHandler`);
      signalHandler(hostPeer, webrtcMsg);
    } else {
      log.warn(`No signalHandler registered, cannot forward signal to GUI`);
    }

    return true;
  }

  /**
   * Register handler for incoming signals.
   * Used by video component to receive WebRTC signals.
   */
  function onSignal(handler: (peer: string, msg: WebRTCMsg) => void): () => void {
    signalHandler = handler;
    return () => {
      signalHandler = null;
    };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  return {
    startCall,
    end,
    endCallInGUI,
    stepAsideForOwnDevice,
    yieldToRivalCall,
    switchToClientOf,
    noteCollisionWon,
    getStartedAt: () => startedAt,
    isEstablished: () => (peersThatAnswered.size > 0),
    hasPeer,
    handleWebRTCSignalFrom,
    // Star-specific methods
    initializeRole,
    onSignal,
    getRole: () => role,
    getHostAddr: () => hostAddr,
    getConnectedClients: () => Array.from(clients.values()).filter(c => c.isConnected),
    getCallSessionId: () => info.callSessionId,
    isInvitePending: inviteStillPending,
    notePeerDeclined,
    noteHostEndedCall: () => {
      announceHostEndedCall();
      teardownFromRemoteDisconnect().catch(err => {
        log.error(`Failed teardown in noteHostEndedCall for chat ${info.chatId.chatId}`, err);
      });
    },
  };
}

/**
 * Extended CallInChat interface with Star architecture methods.
 */
export interface StarCallInChat extends CallInChat {
  /** Initialize role based on call direction */
  initializeRole(direction: 'incoming' | 'outgoing', sender?: string): void;
  /** Register handler for incoming signals */
  onSignal(handler: (peer: string, msg: WebRTCMsg) => void): () => void;
  /** Get current role */
  getRole(): StarRole | null;
  /** Get host address */
  getHostAddr(): string | null;
  /** Get list of connected clients (for host) */
  getConnectedClients(): ClientConnection[];
  /**
   * Whether a copy of this call's invitation is still worth sending to this
   * peer - false once the call is over, or once the peer answered or declined.
   * The one gate for every repeat of 'start', wherever it is sent from.
   */
  isInvitePending(peerAddr: string): boolean;
  /** Act on an invited peer's explicit decline of this call */
  notePeerDeclined(peerAddr: string, msgSessionId?: string): 'noted' | 'ignored';
  /**
   * Client-side: the host ended this call, learned via a fallback channel (the
   * 'outgoing-call-cancelled' system message) rather than a 'disconnect'
   * signal. Same effect as the signal: announce + full teardown. Idempotent.
   */
  noteHostEndedCall(): void;
}
