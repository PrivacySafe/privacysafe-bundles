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
import type { ChatIdObj } from '../../../types/asmail-msgs.types.ts';
import type { CallStateForGui, VideoChatEvent } from '../../../types/services.types.ts';
import type { ChatSrv, ChatSrvEmit, DB, LocalDataStore, VideoChatSrv } from '../../types/index.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import { MultiConnectionIPCWrap } from '../../../shared-libs/ipc/ipc-service.js';
import { facadeOver } from '../chat-service/ipc-expose.ts';
import { areAddressesEqual } from '../../../shared-libs/address-utils.ts';
import { chatIdToString } from '../../../shared-libs/chat-ids.ts';
import { removeMessagesFromInboxBatch } from '../../utils/inbox-utils.ts';
import { sendCallDeclined, sendCallHandledElsewhere } from './utils/_common.ts';
import {
  admitsCallCancelSysMsg,
  isLiveState,
  isSignallingState,
  MAX_SIGNAL_AGE_MILLIS,
  rejoinTargetOf,
  RINGING_NO_ANSWER_TIMEOUT_MILLIS,
} from './utils/call-state.ts';
import { createVideoChatCtx } from './video-chat-ctx.ts';
import { makeSignalInbox, PENDING_SIGNAL_TTL_MILLIS } from './signal-inbox.ts';
import { makeCallHistory } from './call-history.ts';
import { makeCallRegistry } from './call-registry.ts';
import { makeOwnDevices } from './own-devices.ts';
import { makeCallCollisions } from './call-collisions.ts';
import { makeIncomingSignals } from './incoming-signals.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';

const log = makeLogger('VideoChatService');

// How often the watchdog below looks for records and buffered signals that
// outlived their purpose. All the windows it measures against live in
// utils/call-state.ts, next to the rules that use them.
const HEARTBEAT_CLEANUP_INTERVAL = 2_000;

/**
 * Exposes the video GUI opener on IPC. Takes a promise so that exposure can
 * happen at the very start of the component, before the slow storage-touching
 * initialization - the platform gives a caller only 10 seconds to reach an
 * exposed service, and the GUI connects to this one during its own start
 * (see facadeOver in chat-service/ipc-expose.ts).
 */
export function exposeVideoGUIOpenerOnIPC(videoSrv: Promise<VideoChatSrv>): () => void {
  const videoOpenerWrap = new MultiConnectionIPCWrap('VideoGUIOpener');
  const reqReplyMethods: (keyof VideoChatSrv)[] = [
    'startVideoCallForChatRoom',
    'joinOrDismissCallInRoom',
    'endVideoCallInChatRoom',
    'getCallsState',
  ];
  const observableMethods: (keyof VideoChatSrv)[] = ['watchVideoChats'];
  const facade = facadeOver(videoSrv, reqReplyMethods, observableMethods);
  videoOpenerWrap.exposeReqReplyMethods(facade, reqReplyMethods);
  videoOpenerWrap.exposeObservableMethods(facade, observableMethods);
  return videoOpenerWrap.startIPC();
}

export async function videoChatService(
  ownAddr: string,
  chatSrv: ChatSrv,
  db: DB,
  emit: ChatSrvEmit,
  localDataStore: LocalDataStore,
  blacklistTracker?: BlacklistTracker,
): Promise<{ videoChatSrv: VideoChatSrv; stopVideoChatSrv: () => void }> {
  const ctx = createVideoChatCtx(ownAddr, chatSrv, db, emit, localDataStore, blacklistTracker);
  const {
    videoChatsObs, sessions, calls, pendingSignals, lastRejoinRelayAt, sinkGUIEvents,
  } = ctx;

  // The parts of the service, each made over the same ctx, in the order of
  // their dependencies (module map: doc/05-video-calls.md).
  const inbox = makeSignalInbox(ctx);
  const { logDroppedSignal, startupPurgeTimer } = inbox;
  const history = makeCallHistory(ctx);
  const { postProcessingForVideoChat } = history;
  const registry = makeCallRegistry(ctx, inbox, history, {
    // Bound late: the collisions module, made below, needs this registry.
    reportFailedCallCollision: (chatId, rival, ownSessionId) => (
      collisions.reportFailedCallCollision(chatId, rival, ownSessionId)
    ),
  });
  const { createAndRegisterCall } = registry;
  const ownDevices = makeOwnDevices(ctx, inbox);
  const { sendRejoinNotice } = ownDevices;
  const collisions = makeCallCollisions(ctx, inbox, history, registry, { joinOrDismissCallInRoom });
  const { recordFailedCallCollision } = collisions;
  const { handleIncomingWebRTCMsg } = makeIncomingSignals(ctx, inbox, ownDevices, registry, collisions);

  // Periodic cleanup of session records and orphaned buffered signals that
  // outlived their purpose.
  const heartbeatCleanupTimer = setInterval(() => {
    try {
      const now = Date.now();

      // A call that rang unanswered for too long. Normally the host's
      // 'disconnect' ends it, but that message can be consumed from the shared
      // inbox by another of the user's devices - and `ringing` has no other way
      // out (see takeRingingTimeouts), so it used to ring forever. Ended through
      // the ordinary teardown of the live call object, silently: this device
      // never was a participant, so it must send nothing about the call ('not
      // answered' is the host's own timeout to notice). No `reason:
      // 'unanswered-here'` on the GUI event - that one records "the caller
      // cancelled this call" in the chat history, which is not what happened.
      for (const record of sessions.takeRingingTimeouts(now)) {
        const { chatId } = record;
        log.info(
          `[${ownAddr}] Incoming call in chat ${chatId.chatId} rang unanswered for over `
            + `${RINGING_NO_ANSWER_TIMEOUT_MILLIS}ms; giving up on it`,
        );
        const ringingCall = calls.get(chatIdToString(chatId));
        if (ringingCall) {
          ringingCall.end({ silent: true }).catch(err => {
            log.error(`Failed to end ringing call on timeout in chat ${chatId.chatId}`, err);
          });
        } else {
          // Defensive: a `ringing` record should always have a live call behind
          // it; without one there is nothing to tear down, so move the record on
          // directly.
          sessions.transit(chatId, 'ended', now, {
            endedBy: 'self',
            provisional: undefined,
            lastBeat: undefined,
          });
        }
        sinkGUIEvents({ type: 'call-ended', chatId });
      }

      for (const { record, reason } of sessions.takeExpired(now)) {
        log.debug(
          `[${ownAddr}] Dropping ${record.state} record for chat ` +
            `${record.chatId.chatId} (${reason})`,
        );
        // Relaying lives and dies with the record it mirrors: gone the record,
        // gone the throttle, so a later call of this chat starts from a clean
        // slate rather than waiting out an interval measured against a call that
        // is over.
        lastRejoinRelayAt.delete(chatIdToString(record.chatId));
        if (record.state === 'rejoinable') {
          // The "Join Call" button has to go. The chat identity comes from the
          // record itself: a guessed isGroupChat would make the GUI fail to match
          // the chat list item for a 1-1 chat.
          sinkGUIEvents({
            type: 'call-active',
            chatId: record.chatId,
            isCallActive: false,
          });
        }
      }

      // Drop buffered signals for which no 'start' has created a CallInChat
      // within PENDING_SIGNAL_TTL_MILLIS. Without this, a lone/orphaned
      // signal (e.g. a leftover ICE candidate whose matching 'start' was
      // already consumed in a previous run, or a call that was cancelled
      // before any of its signals could be drained) would sit in memory and
      // in the inbox forever, since nothing else ever drains it.
      for (const [chatKey, pending] of pendingSignals.entries()) {
        if (calls.has(chatKey)) {
          continue;
        }
        const fresh = pending.filter(p => now - p.bufferedAt <= PENDING_SIGNAL_TTL_MILLIS);
        const expired = pending.filter(p => now - p.bufferedAt > PENDING_SIGNAL_TTL_MILLIS);
        if (expired.length > 0) {
          log.debug(
            `[${ownAddr}] Dropping ${expired.length} orphaned buffered WebRTC signal(s) ` +
              `for chat ${chatKey} (no 'start' arrived in time)`,
          );
          // Batch-remove all expired orphaned signals from the inbox at once
          // instead of issuing one removeMsg() per signal. This avoids inbox/CPU
          // congestion when many signals accumulate between calls (the "150
          // orphaned buffered" flood seen in logs).
          removeMessagesFromInboxBatch(
            expired.map(p => p.msgId),
            `[${ownAddr}] Batch-removing orphaned WebRTC signals for chat ${chatKey}`,
          );
          if (fresh.length > 0) {
            pendingSignals.set(chatKey, fresh);
          } else {
            pendingSignals.delete(chatKey);
          }
        }
      }
    } catch (err) {
      log.error(`heartbeatCleanupTimer error:`, err);
    }
  }, HEARTBEAT_CLEANUP_INTERVAL);

  async function startVideoCallForChatRoom(chatId: ChatIdObj): Promise<void> {
    let call = calls.get(chatIdToString(chatId));
    let direction: 'incoming' | 'outgoing' = 'outgoing';
    let callHostAddr: string | undefined = undefined;
    if (!call) {
      const chat = chatSrv.findChatEntry(chatId, true)!;
      // A chat marked re-joinable has a call going on in it, hosted by someone
      // whose heartbeats we have been seeing.
      const rejoinable = sessions.get(chatId);
      const isRejoiningActiveCall = rejoinable?.state === 'rejoinable';
      const rejoinTarget = rejoinTargetOf(rejoinable, ownAddr);

      if (isRejoiningActiveCall && !rejoinTarget) {
        // The button is up, but the record cannot say whose call it is about
        // (see rejoinTargetOf). Starting a call of our own instead is what the
        // run of 2026-08-17 did, and it is strictly worse than doing nothing:
        // the live call's participants refuse the invitation, their host's
        // 'disconnect' is later read as a foreign session, and the chat records
        // an outgoing call nobody attended. So the button goes away instead -
        // it was promising something this device cannot deliver. The window is
        // never opened: that happens in call.startCall(), below.
        log.warn(
          `[${ownAddr}] Refusing to re-join the call in ${chatId.chatId}: the record names `
            + `no host to join (session ${rejoinable?.callSessionId ?? 'unknown'}); `
            + `taking the "Join Call" button down`,
        );
        sessions.drop(chatId);
        sinkGUIEvents({ type: 'call-active', chatId, isCallActive: false });
        return;
      }

      if (rejoinTarget) {
        // Re-joining a call that is hosted by someone else — we must join
        // as CLIENT, not start a new call as HOST. Otherwise the GUI shows
        // "Start Call" instead of "Join" and the star topology breaks.
        // The session id comes from that host's heartbeats, so our signals
        // carry the id of the call we are joining, not a new one.
        direction = 'incoming';
        callHostAddr = rejoinTarget.hostAddr;
        log.info(`[${ownAddr}] Re-joining active call in ${chatId.chatId} as CLIENT (host: ${callHostAddr})`);
        // Tell the host we are coming back BEFORE anything else happens, so it
        // can put a "connecting…" tile up at the other participants. Until this
        // existed, the first thing anyone learned of a return was the SDP offer
        // - 13-21 KB against this message's ~250 B, and 50s of silence in the
        // group call of 2026-08-13. Deliberately not awaited: startCall() must
        // not wait on an ASMail round trip.
        sendRejoinNotice(chatId, callHostAddr, rejoinTarget.callSessionId);
        // And the user's other devices are told that this call is taken, exactly
        // as answering a ringing one tells them (joinOrDismissCallInRoom). They
        // are holding a "Join Call" button for the very call this device is
        // entering, and taking that offer would put two devices of one address
        // into it - which the host, keying peers by address, cannot tell apart.
        // Until this, the button on the neighbour stood until its record ran out
        // (run of 2026-08-17: it did eventually go, but on a timeout, with the
        // window wide open in between).
        sendCallHandledElsewhere(
          chatId, ownAddr, localDataStore.getAppDeviceId(), true, rejoinTarget.callSessionId,
        ).catch(err => {
          w3n.log('error', `Failed to tell own devices that this call is being re-joined here`, err);
        });
        call = await createAndRegisterCall(chat, chatId, {
          initialState: 'connecting',
          isRejoiningActiveCall: true,
          direction: 'incoming',
          hostAddr: callHostAddr,
          callSessionId: rejoinTarget.callSessionId,
        });
        // Pre-set role as CLIENT before startCall() so it doesn't
        // re-initialize as HOST.
        call.initializeRole('incoming', callHostAddr);
      } else {
        // A chat with no live call of anyone else's: this is a call of our own.
        // direction='outgoing', hostAddr=ownAddr, and we mint the session id
        // every participant will echo back. Nothing re-joinable reaches here -
        // a record in that state either produced a target above or took the
        // button down.
        call = await createAndRegisterCall(chat, chatId, {
          initialState: 'dialing',
          direction: 'outgoing',
          hostAddr: ownAddr,
          callSessionId: await localDataStore.nextCallSessionId(ownAddr),
        });
      }
    }
    await call.startCall();

    const { doAfterStartCall } = postProcessingForVideoChat();
    await doAfterStartCall({
      chatId, direction, sender: callHostAddr,
      callSessionId: call.getCallSessionId?.(),
    });
  }

  async function endVideoCallInChatRoom(chatId: ChatIdObj): Promise<void> {
    const call = calls.get(chatIdToString(chatId));
    if (!call) {
      // The button was armed by a call this device no longer has. Returning
      // silently left it armed until the next push event - and when the click
      // happens precisely because no event is coming, that is never (the End
      // Call button that survived the whole incident of 2026-09-10). So: put
      // the session record to rest if it is still standing, and tell the GUI
      // what the ordinary end of a call would have told it.
      log.info(
        `[${ownAddr}] End of call asked for chat ${chatId.chatId} with no call object here`,
      );
      const record = sessions.get(chatId);
      if (record && (record.state !== 'ended')) {
        sessions.transit(chatId, 'ended', Date.now(), { endedBy: 'self' });
      }
      sinkGUIEvents({
        type: 'call-ended',
        chatId,
      });
      return;
    }
    await call.endCallInGUI();
  }

  /**
   * All incoming calls go throw this controller first, creating call objects
   * that open other UI elements. Those other elements send tell to either join
   * or ignore call.
   * @param chatId
   * @param join tells to either join call (true value), or dismiss it (false)
   * @param sender who was the current call's initiator
   * @returns the session id of the call that was acted upon, for the caller to
   * name in its system message about the cancelled call.
   */
  async function joinOrDismissCallInRoom(
    chatId: ChatIdObj, join: boolean, sender?: string, expectedCallSessionId?: string,
  ): Promise<{ handled: boolean; callSessionId?: string }> {
    const call = calls.get(chatIdToString(chatId));
    const callSessionId = call?.getCallSessionId?.();
    // At `info`: this is the user's own answer to the call, and the one event
    // that tells apart "this device never rang" from "this device rang and was
    // answered/declined here".
    log.info(
      `[${ownAddr}] Call in chat ${chatId.chatId} ${join ? 'joined' : 'declined'} on this `
        + `device (${localDataStore.getAppDeviceId()}); host: ${sender ?? 'unknown'}, `
        + `session: ${callSessionId ?? 'n/a'}`,
    );
    if (!call) {
      return { handled: false };
    }
    if (expectedCallSessionId && callSessionId
      && (expectedCallSessionId !== callSessionId)) {
      // The button the user clicked was armed for a session that is over; a
      // different call is going on in this chat now. Acting on the click would
      // answer/decline the live call the user never saw ringing.
      log.info(
        `[${ownAddr}] Ignoring ${join ? 'join' : 'dismiss'} of call in chat ${chatId.chatId}: `
          + `the click was about session ${expectedCallSessionId}, but session `
          + `${callSessionId} is going on`,
      );
      return { handled: false };
    }

    // Every device of ours is ringing for this call, and nothing in the call
    // protocol would ever tell them it has been dealt with: the host hears only
    // from the device that joined. Sent before the work below, so the other
    // devices go quiet while this one is still setting up its media.
    sendCallHandledElsewhere(chatId, ownAddr, localDataStore.getAppDeviceId(), join, callSessionId)
      .catch(err => {
        w3n.log('error', `Failed to tell own devices that the call was handled here`, err);
      });

    if (join) {
      // The same notice a returning participant sends, for the same reason: the
      // host otherwise learns of the answer only from our SDP offer, which goes
      // out after the window has opened and the camera has started, and is the
      // slowest message on the ASMail path. Until it lands, the caller sits on
      // "waiting for participants" with the ringtone still playing. A host on an
      // older build ignores the notice and waits for the offer, as before.
      if (sender) {
        sendRejoinNotice(chatId, sender, callSessionId);
      }
      // Pre-set role as CLIENT before startCall() so it doesn't re-initialize as HOST.
      // sender is the host's mailerId (the call initiator).
      call.initializeRole('incoming', sender);
      await call.startCall();
      const { doAfterStartCall } = postProcessingForVideoChat();
      await doAfterStartCall({ chatId, direction: 'incoming', sender, callSessionId });
    } else {
      // Tell the host this was an explicit decline (as opposed to merely
      // being unreachable), so its connecting banner doesn't wait out the
      // no-answer timeout. sender is the host's address; skip silently if
      // it wasn't provided rather than guessing at who the host is.
      if (sender) {
        sendCallDeclined(chatId, sender, ownAddr, callSessionId).catch(err => {
          w3n.log('error', `Failed to send call-declined to host ${sender}`, err);
        });
      }
      // Silent, and said outright rather than left to the fact that no role was
      // initialized on this path: a declining device must never send
      // 'disconnect'. Peers are keyed by address, so the host would read it as
      // coming from whichever device of ours actually joined - in a one-to-one
      // chat that tears down the live call. 'call-declined' above is the signal
      // that says "not here", and it carries the address-level caveat with it.
      await call.end({ silent: true });
    }
    return { handled: true, callSessionId };
  }

  function watchVideoChats(obs: web3n.Observer<VideoChatEvent>): () => void {
    videoChatsObs.add(obs);
    return () => videoChatsObs.delete(obs);
  }

  /**
   * The declining side's 'incoming-call-cancelled' system message, acted upon
   * here as well as in the GUI.
   *
   * It is the second, independent way a decline reaches the caller: the
   * 'call-declined' signal is sent out-of-queue and is normally the faster of the
   * two, but it is a single message whose loss has no other recovery, whereas
   * this one travels the ordinary delivery queue. Acting on it here rather than
   * only in the chat window is what makes it work regardless of whether a window
   * is open - which is exactly the case a lost signal leaves behind.
   *
   * 'outgoing-call-cancelled' is the same kind of second route for the host's
   * hangup: the 'disconnect' signal is normally faster, but it can be lost
   * (never-opened DataChannel plus a degraded ASMail delivery), and a client
   * who misses it sits in a dead call window until the host-silence watchdog
   * (90s+). The system message travels the ordinary delivery queue, so acting
   * on it here tears the client's call down within seconds instead.
   *
   * Gated on the call this cancellation names, because this message is nothing
   * like the signal in how long it stays around: it sits in the inbox for days
   * and the start-up catch-up scan replays it. See admitsCallCancelSysMsg.
   */
  const stopCallSysMsgWatching = chatSrv.onIncomingCallSysMsg(params => {
    const { chatId, sender, subType, callSessionId, deliveryTS } = params;
    if (subType === 'call-collision-failed') {
      // The other host's report that our two calls never met. The record is
      // written whenever the message is seen - its id makes a replay at
      // start-up a no-op - but the notice only while it is news.
      recordFailedCallCollision(chatId, sender, callSessionId).catch(err => {
        w3n.log('error', `Failed to record the failed call collision in chat ${chatId.chatId}`, err);
      });
      if ((Date.now() - deliveryTS) <= MAX_SIGNAL_AGE_MILLIS) {
        sinkGUIEvents({
          type: 'call-collision',
          chatId,
          peerAddr: sender,
          collisionOutcome: 'unresolved',
        });
      }
      return;
    }
    if ((subType !== 'incoming-call-cancelled') && (subType !== 'outgoing-call-cancelled')) {
      return;
    }
    const call = calls.get(chatIdToString(chatId));
    if (!call) {
      return;
    }
    if (subType === 'outgoing-call-cancelled') {
      // Only a client acts on the host's withdrawal, and only when the message
      // really comes from this call's host: any other sender must not be able
      // to end someone's call with a crafted system message.
      const host = call.getHostAddr?.();
      if (!call.noteHostEndedCall || (call.getRole?.() !== 'client')
        || !host || !areAddressesEqual(host, sender)) {
        return;
      }
    } else if (!call.notePeerDeclined) {
      return;
    }
    const verdict = admitsCallCancelSysMsg({
      msgSessionId: callSessionId,
      callSessionId: call.getCallSessionId?.(),
      msgAge: Date.now() - deliveryTS,
    });
    if (verdict !== 'accept') {
      logDroppedSignal(
        verdict, `'${subType}' system message (session: ${callSessionId ?? 'n/a'})`,
        sender, chatId, true,
      );
      return;
    }
    log.info(
      `[${ownAddr}] '${subType}' system message from ${sender} for chat ${chatId.chatId} `
        + `(session ${callSessionId})`,
    );
    if (subType === 'outgoing-call-cancelled') {
      call.noteHostEndedCall!();
    } else {
      call.notePeerDeclined!(sender, callSessionId);
    }
  });

  /**
   * Whether any call is going on (or ringing) right now, in any chat. This is
   * what lets background maintenance that competes with signalling for ASMail
   * delivery (the resync pass, see msg-resync.ts) stay out of a call's way.
   */
  function hasAnyCallInProgress(): boolean {
    return sessions.all().some(({ state }) => isLiveState(state));
  }

  /**
   * Whether any call is sending signalling of its own right now.
   *
   * Narrower than hasAnyCallInProgress() by the `ringing` state, and used only by
   * traffic that yields to signalling and can wait indefinitely without being
   * lost - the journal of sync phantoms. A ringing call puts nothing of ours on
   * the wire, so making a phantom wait out an unanswered ring (up to 90 s) delays
   * the user's other devices for nothing. Resync and the reconcile sweep stay on
   * the broad check: they generate heavier traffic and have no urgency at all.
   */
  function hasAnyCallSignalling(): boolean {
    return sessions.all().some(({ state }) => isSignallingState(state));
  }

  /**
   * What this component currently believes about every chat's call.
   *
   * The push events ('call-started', 'call-ended', 'call-active') stay the way
   * call state reaches the GUI; this is how a window catches up with events it
   * never heard - one opened in the middle of a call, and, after 2026-09-10,
   * one whose background component stopped answering mid-call and left an End
   * Call button that nothing would ever clear.
   *
   * Everything but `ended`, rather than isLiveState(): the GUI needs
   * 'winding-down' (its End Call button is still up) and 'rejoinable' (it
   * offers "Join call"), neither of which counts as live here.
   */
  function getCallsState(): Promise<CallStateForGui[]> {
    return Promise.resolve(sessions.all()
      .filter(({ state }) => (state !== 'ended'))
      .map(({ chatId, state, since, hostAddr, callSessionId, role }) => ({
        chatId,
        state: state as CallStateForGui['state'],
        since,
        hostAddr,
        callSessionId,
        role,
        // From `calls`, not from the record: the record says a call exists,
        // this says we are the ones in it.
        inCallHere: calls.has(chatIdToString(chatId)),
      })));
  }

  const methods: VideoChatSrv = {
    handleIncomingWebRTCMsg,
    startVideoCallForChatRoom,
    endVideoCallInChatRoom,
    getCallsState,
    joinOrDismissCallInRoom,
    watchVideoChats,
    hasAnyCallInProgress,
    hasAnyCallSignalling,
  };

  // IPC exposure is NOT done here: it must happen at the very start of the
  // component (see index.ts), long before this service can be constructed.

  // Combined stop function that cleans up timers
  function stopVideoChatSrvWithCleanup(): void {
    clearInterval(heartbeatCleanupTimer);
    clearTimeout(startupPurgeTimer);
    stopCallSysMsgWatching();
  }

  return {
    videoChatSrv: methods,
    stopVideoChatSrv: stopVideoChatSrvWithCleanup,
  };
}
