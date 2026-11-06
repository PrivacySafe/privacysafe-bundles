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
  ChatIdObj, ChatSystemMessageData, WebRTCMsg, WebRTCOffBandMessage,
} from '../../../types/asmail-msgs.types.ts';
import type { CallInChat, ChatDbEntry, MsgDbEntry, VideoChatSrv } from '../../types/index.ts';
import {
  chatIdToString, chatMessageIdForCallEvent, generateChatMessageId,
} from '../../../shared-libs/chat-ids.ts';
import { removeMessageFromInbox } from '../../utils/inbox-utils.ts';
import {
  sendCallCollision, sendCallHandledElsewhere, sendSystemMsgAboutFailedCallCollision,
} from './utils/_common.ts';
import type { CallCollisionParty } from './utils/call-state.ts';
import { callCollisionWinner, isSignallingState } from './utils/call-state.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import type { VideoChatCtx } from './video-chat-ctx.ts';
import type { SignalInbox } from './signal-inbox.ts';
import type { CallHistory } from './call-history.ts';
import type { CallRegistry } from './call-registry.ts';

const log = makeLogger('VideoChatService');

/**
 * Two calls started in one chat at the same moment: which of them stays, the
 * withdrawal of the other, and the record of a collision that was never
 * resolved.
 */
export function makeCallCollisions(
  ctx: VideoChatCtx,
  inbox: SignalInbox,
  history: CallHistory,
  registry: CallRegistry,
  { joinOrDismissCallInRoom }: {
    /** The service's own method: yielding to a rival call is answering it. */
    joinOrDismissCallInRoom: VideoChatSrv['joinOrDismissCallInRoom'];
  },
) {
  const {
    ownAddr, chatSrv, db, emit, localDataStore, sessions, calls, callRecordIds, collisionNoticesSent,
    sinkGUIEvents,
  } = ctx;
  const { rememberSignalLeftInInbox } = inbox;
  const { postProcessingForVideoChat } = history;
  const { handleIncomingCall } = registry;

  /**
   * Two calls in one chat: ours, which we host and nobody may have answered
   * yet, and the rival's, of which we just learned - by its 'start' or by its
   * host's collision notice. Settles which of the two stays (the rule and its
   * reasons: callCollisionWinner in call-state.ts) and acts on it here.
   *
   * Until this existed, the rival's 'start' went into our host call object,
   * which has nothing to do with a 'start', and both people stared at
   * "Calling..." until the no-answer timeout - each waiting for an offer from the
   * other, which neither was ever going to send.
   */
  async function resolveCallCollision(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    call: CallInChat,
    rival: CallCollisionParty,
    startMsgId: string | undefined,
  ): Promise<void> {
    const chatKey = chatIdToString(chatId);
    const own: CallCollisionParty = {
      hostAddr: ownAddr,
      callSessionId: call.getCallSessionId?.(),
      startedAt: call.getStartedAt?.(),
      established: !!call.isEstablished?.(),
    };

    // Still on the media setup screen: nobody has been invited, so there is
    // nothing to weigh and nobody to tell. The rival will see us arrive as an
    // ordinary client.
    const notStartedYet = (own.startedAt === undefined) && !own.established;
    const winner = notStartedYet ? 'b' : callCollisionWinner(own, rival);
    log.info(
      `[${ownAddr}] Calls collide in chat ${chatId.chatId}: ours (session `
        + `${own.callSessionId ?? 'n/a'}, started ${own.startedAt ?? 'not yet'}, `
        + `established ${own.established}) and ${rival.hostAddr}'s (session `
        + `${rival.callSessionId ?? 'n/a'}, started ${rival.startedAt ?? 'unknown'}, `
        + `established ${rival.established}); ${winner === 'a' ? 'ours' : 'theirs'} stays`,
    );

    // Ours went out, so the rival has it or will: our facts go along, as the
    // rival cannot otherwise know whether someone has answered us since.
    const noticeKey = `${chatKey}:${rival.callSessionId ?? rival.hostAddr}`;
    if (!notStartedYet && !collisionNoticesSent.has(noticeKey)) {
      collisionNoticesSent.add(noticeKey);
      sendCallCollision(chatId, rival.hostAddr, ownAddr, own.callSessionId, {
        startedAt: own.startedAt, established: own.established,
      }).catch(err => {
        w3n.log('error', `Failed to tell ${rival.hostAddr} of the colliding call`, err);
      });
    }

    if ((winner === 'a') || own.established) {
      // Someone is already in our call: it is not ours to give up, even if the
      // rival is too and started first. The two calls then go on apart, and the
      // timer below is what says so to the user.
      call.noteCollisionWon?.(rival.hostAddr, rival.callSessionId);
      if (startMsgId) {
        rememberSignalLeftInInbox(chatId, startMsgId);
      }
      return;
    }

    await yieldToRivalCall(chat, chatId, call, rival, startMsgId);
  }

  /**
   * Withdraws our call in favour of the rival's and joins that one as a client.
   * Everything after the withdrawal is the ordinary path of an answered call:
   * the same record, the same window, the same notice to our other devices.
   */
  async function yieldToRivalCall(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    call: CallInChat,
    rival: CallCollisionParty,
    startMsgId: string | undefined,
  ): Promise<void> {
    const chatKey = chatIdToString(chatId);
    if (!call.yieldToRivalCall) {
      return;
    }

    // The outgoing record our call put into the history is taken back: that
    // call never ran, and the call we are joining makes a record of its own.
    const ownRecordId = callRecordIds.get(chatKey);
    callRecordIds.delete(chatKey);
    const dropOwnRecord = () => {
      if (ownRecordId) {
        chatSrv.deleteMessage({ chatId, chatMessageId: ownRecordId }, false).catch(err => {
          w3n.log('error', `Failed to remove the record of a withdrawn call`, err);
        });
      }
    };
    const winner = {
      hostAddr: rival.hostAddr,
      callSessionId: rival.callSessionId,
      startedAt: rival.startedAt,
    };

    // In place first: the window stays, with the devices the user picked, and
    // only changes sides. The call window says so itself, so the main window
    // has nothing to add.
    if (await call.switchToClientOf?.(winner)) {
      sessions.transit(chatId, 'connecting', Date.now(), {
        role: 'client',
        hostAddr: rival.hostAddr,
        callSessionId: rival.callSessionId,
        startedAt: rival.startedAt,
      });
      if (startMsgId) {
        rememberSignalLeftInInbox(chatId, startMsgId);
      }
      dropOwnRecord();
      // What answering an incoming call does (joinOrDismissCallInRoom): our
      // other devices stop ringing for this call, and the history gets the
      // record of it.
      sendCallHandledElsewhere(
        chatId, ownAddr, localDataStore.getAppDeviceId(), true, rival.callSessionId,
      ).catch(err => {
        w3n.log('error', `Failed to tell own devices that the call was taken here`, err);
      });
      const { doAfterStartCall } = postProcessingForVideoChat();
      await doAfterStartCall({
        chatId, direction: 'incoming', sender: rival.hostAddr, callSessionId: rival.callSessionId,
      });
      return;
    }

    // The window could not be asked: close it and open a client one, the way
    // an answered incoming call opens.
    log.info(
      `[${ownAddr}] Could not switch the call window in chat ${chatId.chatId} in place; `
        + `reopening it as a client of ${rival.hostAddr}`,
    );
    await call.yieldToRivalCall(winner);
    dropOwnRecord();

    sinkGUIEvents({
      type: 'call-collision',
      chatId,
      peerAddr: rival.hostAddr,
      collisionOutcome: 'joining',
    });

    const startMsg: WebRTCMsg = {
      stage: 'start',
      id: Date.now(),
      callSessionId: rival.callSessionId,
      data: (typeof rival.startedAt === 'number') ? { startedAt: rival.startedAt } : {},
    };
    await handleIncomingCall(chat, chatId, rival.hostAddr, startMsg, startMsgId, {
      showIncomingUI: false,
    });
    await joinOrDismissCallInRoom(chatId, true, rival.hostAddr, rival.callSessionId);
  }

  /**
   * Puts "the call with X did not take place - you were calling each other at
   * the same moment" into this chat's history, and onto the user's other
   * devices.
   *
   * The record names the other side (`sender`) and that side's call, and its id
   * is derived from both, so every device of ours that writes it - from its own
   * timer, from the rival's system message, from a phantom - writes the same
   * one, and a second write is a no-op.
   */
  async function recordFailedCallCollision(
    chatId: ChatIdObj, otherAddr: string, otherSessionId: string | undefined,
  ): Promise<void> {
    const chatSystemData: ChatSystemMessageData = {
      event: 'webrtc-call',
      value: {
        sender: otherAddr,
        subType: 'call-collision-failed',
        chatId,
        callSessionId: otherSessionId,
      },
    };
    const { chatMessageId, timestamp } = otherSessionId
      ? {
        chatMessageId: chatMessageIdForCallEvent('call-collision-failed', otherSessionId, otherAddr),
        timestamp: Date.now(),
      }
      : generateChatMessageId();
    if (otherSessionId && (await db.getMessage({ chatId, chatMessageId }))) {
      return;
    }
    const msg: MsgDbEntry = {
      groupChatId: chatId.isGroupChat ? chatId.chatId : null,
      otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
      chatMessageId,
      isIncomingMsg: false,
      incomingMsgId: null,
      groupSender: chatId.isGroupChat ? otherAddr : null,
      body: JSON.stringify(chatSystemData),
      attachments: null,
      chatMessageType: 'system',
      relatedMessage: null,
      status: null,
      timestamp,
      removeAfter: 0,
      history: null,
      reactions: null,
      settings: null,
    };
    await db.addMessage(msg);
    emit.message.added(msg);
    // Only with a derived id, for the reason given at recordCallEvent in the
    // GUI's chats.store.ts: a generated one cannot be agreed upon, and the
    // other devices would end up with a second line about one failure.
    if (otherSessionId) {
      await chatSrv.syncLocallyMadeSystemEvent(chatId, chatMessageId, chatSystemData);
    }
  }

  /**
   * Our call won a collision, and the other host never came in (see
   * noteCollisionWon in call.ts): a build that cannot step aside, a notice lost
   * on the way, or both calls already answered. Said in three places, because
   * each reaches someone the others do not: a notice for the user looking at
   * the screen now, a record in our history, and a system message that puts
   * the same record into the rival's history - its call went nowhere as well.
   */
  function reportFailedCallCollision(
    chatId: ChatIdObj,
    rival: { hostAddr: string; callSessionId?: string },
    ownSessionId: string | undefined,
  ): void {
    sinkGUIEvents({
      type: 'call-collision',
      chatId,
      peerAddr: rival.hostAddr,
      collisionOutcome: 'unresolved',
    });
    recordFailedCallCollision(chatId, rival.hostAddr, rival.callSessionId).catch(err => {
      w3n.log('error', `Failed to record the failed call collision in chat ${chatId.chatId}`, err);
    });
    sendSystemMsgAboutFailedCallCollision({
      ownAddr, chatId, rivalHostAddr: rival.hostAddr, callSessionId: ownSessionId,
    }).catch(err => {
      w3n.log('error', `Failed to tell ${rival.hostAddr} that the calls did not meet`, err);
    });
  }

  /**
   * The rival host's collision notice. It may come before its 'start' - both
   * travel separately - or after we have settled on its 'start' alone; either
   * way the decision is taken again with the one fact only the notice carries,
   * `established`.
   */
  async function handleCallCollisionNotice(
    chat: ChatDbEntry,
    chatId: ChatIdObj,
    sender: string,
    webrtcMsg: WebRTCMsg,
    notice: NonNullable<WebRTCOffBandMessage['callCollision']>,
    msgId: string,
  ): Promise<void> {
    removeMessageFromInbox(msgId).catch(err => {
      w3n.log('error', `Failed to remove a collision notice from inbox`, err);
    });
    const call = calls.get(chatIdToString(chatId));
    const ownSession = call?.getCallSessionId?.();
    const ownState = sessions.state(chatId);
    if (!call || (call.getRole?.() !== 'host') || !ownState || !isSignallingState(ownState)
      || (webrtcMsg.callSessionId && ownSession && (webrtcMsg.callSessionId === ownSession))) {
      // No call of ours to weigh against theirs: we have already joined it,
      // or ours is over. Nothing to do.
      log.info(
        `[${ownAddr}] Collision notice from ${sender} in chat ${chatId.chatId}: `
          + `no call of ours hosted here (role: ${call?.getRole?.() ?? 'none'}); ignoring`,
      );
      return;
    }
    await resolveCallCollision(chat, chatId, call, {
      hostAddr: sender,
      callSessionId: webrtcMsg.callSessionId,
      startedAt: notice.startedAt,
      established: !!notice.established,
    }, undefined);
  }

  return {
    resolveCallCollision,
    yieldToRivalCall,
    recordFailedCallCollision,
    reportFailedCallCollision,
    handleCallCollisionNotice,
  };
}

export type CallCollisions = ReturnType<typeof makeCallCollisions>;
