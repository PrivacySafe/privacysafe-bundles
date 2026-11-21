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
import type { ChatIdObj, WebRTCMsg } from '../../../types/asmail-msgs.types.ts';
import type { IncomingCallCmdArg } from '../../../types/chat-commands.types.ts';
import type { ChatInfoForCall } from '../../../types/services.types.ts';
import type { CallInChat, ChatDbEntry } from '../../types/index.ts';
import { areAddressesEqual } from '../../../shared-libs/address-utils.ts';
import { chatIdToString } from '../../../shared-libs/chat-ids.ts';
import { removeMessagesFromInboxBatch } from '../../utils/inbox-utils.ts';
import { sendCallHandledElsewhere } from './utils/_common.ts';
import { callInChat } from './utils/call.ts';
import type { CallSessionPatch, CallState } from './utils/call-state.ts';
import { iceConfigForNewCall } from './ice-config.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import type { VideoChatCtx } from './video-chat-ctx.ts';
import type { SignalInbox } from './signal-inbox.ts';
import type { CallHistory } from './call-history.ts';

const log = makeLogger('VideoChatService');

/** `startedAt` of a 'start', when the sender's build puts one there. */
export function startedAtOf(webrtcMsg: WebRTCMsg): number | undefined {
  const data = Array.isArray(webrtcMsg.data) ? webrtcMsg.data[0] : webrtcMsg.data;
  return (typeof data?.startedAt === 'number') ? data.startedAt : undefined;
}

/**
 * Creation of call objects: the one place a CallInChat is made, entered into
 * `calls` and wired to the rest of the service, and the incoming call that
 * makes one ring.
 */
export function makeCallRegistry(
  ctx: VideoChatCtx,
  inbox: SignalInbox,
  history: CallHistory,
  { reportFailedCallCollision }: {
    /**
     * From call-collisions.ts. Passed in rather than imported: that module
     * needs this registry itself.
     */
    reportFailedCallCollision: (
      chatId: ChatIdObj,
      rival: { hostAddr: string; callSessionId?: string },
      ownSessionId: string | undefined,
    ) => void;
  },
) {
  const {
    ownAddr, localDataStore, sessions, calls, pendingSignals, signalsLeftInInbox,
    answeredAsInCall, collisionNoticesSent, sinkGUIEvents,
  } = ctx;
  const { rememberSignalLeftInInbox, drainPendingSignals } = inbox;
  const { notifyUserOnHostEndedCall, postProcessingForVideoChat, nameFromAddr } = history;

  /**
   * The window of a call gets its ICE configuration from here, in
   * `ChatInfoForCall`: STUN/TURN details, credentials among them, belong to this
   * instance and not to a window's bundle (see ice-config.ts).
   */
  async function chatInfoForNewCall(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    isRejoiningActiveCall = false,
    direction?: 'incoming' | 'outgoing',
    hostAddr?: string,
    callSessionId?: string,
  ): Promise<ChatInfoForCall> {
    const peers = chat.isGroupChat
      ? Object.keys(chat.members)
          .filter(addr => !areAddressesEqual(addr, ownAddr))
          .map(addr => ({ addr, name: nameFromAddr(addr) }))
      : [{ addr: chat.peerAddr, name: chat.name }];

    return {
      chatId,
      ownAddr,
      ownName: nameFromAddr(ownAddr),
      peers,
      chatName: chat.name,
      rtcConfig: await iceConfigForNewCall(),
      isRejoiningActiveCall,
      direction,
      hostAddr,
      callSessionId,
      participantCount: peers.length + 1,
    };
  }

  async function createAndRegisterCall(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    {
      initialState,
      isRejoiningActiveCall = false,
      direction,
      hostAddr,
      callSessionId,
      startedAt,
    }: {
      /** State the chat enters as this call is created. */
      initialState: CallState;
      isRejoiningActiveCall?: boolean;
      direction?: 'incoming' | 'outgoing';
      hostAddr?: string;
      callSessionId?: string;
      /** When the host sent its 'start'; kept for the collision tie-break. */
      startedAt?: number;
    },
  ): Promise<CallInChat> {
    const chatKey = chatIdToString(chatId);
    const callInfo = await chatInfoForNewCall(
      chat, chatId, isRejoiningActiveCall, direction, hostAddr, callSessionId,
    );
    const call = callInChat({
      info: callInfo,
      sinkGUIEvents,
      notifyUserOnHostEndedCall,
      notifyState: state => {
        if (calls.get(chatKey) === call) {
          sessions.transit(chatId, state, Date.now());
        }
      },
      detachFromParent: endState => {
        if (calls.get(chatKey) === call) {
          calls.delete(chatKey);
          // Clean up this chat's signalling messages from the inbox so they
          // don't accumulate between calls (the "150 orphaned buffered" flood
          // seen in logs) or trigger a spurious request-start / re-ring on the
          // next call: the ones still buffered, plus the ones that were handled
          // but deliberately left in the inbox.
          const pending = pendingSignals.get(chatKey);
          const leftInInbox = signalsLeftInInbox.get(chatKey);
          const msgIdsToRemove = [
            ...(pending?.map(p => p.msgId) ?? []),
            ...(leftInInbox ?? []),
          ];
          if (msgIdsToRemove.length > 0) {
            removeMessagesFromInboxBatch(
              msgIdsToRemove,
              `[${ownAddr}] Removing WebRTC signals for chat ${chatKey} on teardown`,
            );
          }
          pendingSignals.delete(chatKey);
          signalsLeftInInbox.delete(chatKey);
          // Keyed by session, so a stale entry could never mislead the next
          // call - it is dropped here only to keep the set from growing over
          // the lifetime of the component.
          for (const key of answeredAsInCall) {
            if (key.startsWith(`${chatKey}:`)) {
              answeredAsInCall.delete(key);
            }
          }
          for (const key of collisionNoticesSent) {
            if (key.startsWith(`${chatKey}:`)) {
              collisionNoticesSent.delete(key);
            }
          }

          const now = Date.now();
          // The call object is gone after this block, so the record must not
          // stay in a live state whatever the transition table says: a live
          // record with no call behind it blocks resync, the "Join Call"
          // button and any new call in this chat until a service restart.
          // On refusal, drop the record and apply the terminal state from
          // idle ('rejoinable' is an entry state and passes; 'ended' from
          // idle is refused, which leaves clean idle - equally safe).
          const transitToTerminal = (
            target: CallState, patch: CallSessionPatch,
          ): void => {
            if (sessions.transit(chatId, target, now, patch)) {
              return;
            }
            log.warn(
              `[${ownAddr}] Detach of call in ${chatId.chatId} could not record `
                + `'${target}' - dropping the session record instead`,
            );
            sessions.drop(chatId);
            sessions.transit(chatId, target, now, patch);
          };
          if (endState.kind === 'rejoinable') {
            // We left a group call that keeps running without us. Offer the
            // "Join Call" button right away instead of waiting for the host's
            // heartbeat to make a full round trip. Marked provisional: a real
            // heartbeat must confirm it, otherwise the watchdog drops it on
            // the shorter PROVISIONAL_REJOIN_TIMEOUT.
            transitToTerminal('rejoinable', {
              hostAddr: endState.hostAddr,
              callSessionId,
              lastBeat: now,
              provisional: true,
              endedBy: undefined,
              // We were in it ourselves.
              heardOnly: false,
            });
            sinkGUIEvents({
              type: 'call-active',
              chatId,
              isCallActive: true,
              reason: 'self-left',
            });
            // And the user's other devices are told, because one of them may be
            // holding its "Join Call" button down on our account: a device that
            // yielded this call to us keeps it down for as long as we are in it
            // (see admitsHeartbeat). Nothing else would lift that in time - the
            // host's heartbeats say a call is on, not who of this user's devices
            // is in it. A lost notice costs no more than the wait for the record
            // to expire, which is what used to happen always.
            sendCallHandledElsewhere(
              chatId, ownAddr, localDataStore.getAppDeviceId(), true, callSessionId,
              undefined, true,
            ).catch(err => {
              w3n.log('error', `Failed to tell own devices that this call was left here`, err);
            });
          } else {
            // The call is over. `endedBy: 'host'` is what makes a heartbeat of
            // this same session still in flight get ignored, instead of giving
            // us a "Join Call" button for a call that is over.
            transitToTerminal('ended', {
              hostAddr: endState.hostAddr,
              callSessionId,
              endedBy: (endState.kind === 'ended-by-host')
                ? 'host'
                : ((endState.kind === 'ended-by-peer') ? 'peer' : 'self'),
              provisional: undefined,
              lastBeat: undefined,
            });
          }
        }
      },
      postProcessingForVideoChat,
      onCollisionUnresolved: rival => reportFailedCallCollision(
        chatId, rival, callInfo.callSessionId,
      ),
    });

    calls.set(chatKey, call);
    sessions.transit(chatId, initialState, Date.now(), {
      role: (direction === 'outgoing') ? 'host' : 'client',
      hostAddr,
      callSessionId,
      startedAt,
      endedBy: undefined,
      provisional: undefined,
      heardOnly: undefined,
    });
    drainPendingSignals(chatId, call);
    return call;
  }

  async function handleIncomingCall(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    peer: string,
    webrtcMsg: WebRTCMsg,
    msgId: string | undefined,
    { showIncomingUI = true }: {
      /**
       * False when this device is about to join the call on its own, without
       * the user's answer (see yieldToRivalCall): the user already asked for a
       * call in this chat, and Join/Decline buttons for it would only get in
       * the way.
       */
      showIncomingUI?: boolean;
    } = {},
  ): Promise<void> {
    // At `info`, in two lines around startAppWithParams(), because "it only rang
    // on one of my devices" is answered by which of them is missing: the first
    // says this device accepted the call and is ringing, the second that it asked
    // the shell for the incoming-call UI. If both are there and no buttons showed
    // up, the fault is past this service - in the command's route into the chat
    // list (see the matching line in useChatView.ts).
    log.info(
      `[${ownAddr}] Incoming call in chat ${chatId.chatId} (isGroup: ${chatId.isGroupChat}) `
        + `from ${peer}, session ${webrtcMsg.callSessionId ?? 'n/a'}, `
        + `signal age ${Date.now() - webrtcMsg.id}ms; ringing here`,
    );

    // For incoming calls: direction='incoming', hostAddr=peer (the caller).
    // The session id comes from the 'start' itself: it is the host's, and every
    // signal we send for this call echoes it back.
    const call = await createAndRegisterCall(chat, chatId, {
      initialState: 'ringing',
      direction: 'incoming',
      hostAddr: peer,
      callSessionId: webrtcMsg.callSessionId,
      startedAt: startedAtOf(webrtcMsg),
    });
    call.handleWebRTCSignalFrom(peer, webrtcMsg);

    // The 'start' stays in the shared inbox for the user's other devices to
    // ring from, but it must not outlive the call: teardown drops the ids
    // remembered here (see signalsLeftInInbox). Before this, an accepted
    // call's 'start' was never removed at all, and its replay - by a later
    // catch-up scan or with a skewed sender clock - re-opened the incoming
    // call UI for a call that was long over.
    if (msgId) {
      rememberSignalLeftInInbox(chatId, msgId);
    }

    if (!showIncomingUI) {
      return;
    }

    const cmdArg: IncomingCallCmdArg = {
      chatId,
      peerAddress: peer,
      callSessionId: webrtcMsg.callSessionId,
      sentAt: Date.now(),
    };
    // Caught here rather than by the caller's catch-all: a failure of this one
    // call means the call rings nowhere, and that has to be named as such.
    try {
      await w3n.shell!.startAppWithParams!(null, 'incoming-call', cmdArg);
      log.info(`[${ownAddr}] Incoming-call UI requested for chat ${chatId.chatId}`);
    } catch (err) {
      log.error(
        `[${ownAddr}] Failed to open the incoming-call UI for chat ${chatId.chatId}: `
          + `the call is ringing with no Join/Decline buttons`,
        err,
      );
    }
  }

  return {
    chatInfoForNewCall,
    createAndRegisterCall,
    handleIncomingCall,
  };
}

export type CallRegistry = ReturnType<typeof makeCallRegistry>;
