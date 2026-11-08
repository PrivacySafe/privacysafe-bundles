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
import type { ChatIdObj, ChatSystemMessageData } from '../../../types/asmail-msgs.types.ts';
import type { OpenChatCmdArg } from '../../../types/chat-commands.types.ts';
import type { MsgDbEntry } from '../../types/index.ts';
import {
  chatIdToString, chatMessageIdForCallEvent, generateChatMessageId,
} from '../../../shared-libs/chat-ids.ts';
import { pickCallRecordToStamp } from './utils/call-record.ts';
import { replaceSystemNotification } from '../../utils/system-notifications.ts';
import { LOGO_ICON_AS_ARRAY } from '../../../src-main/common/constants/files.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import type { VideoChatCtx } from './video-chat-ctx.ts';

const log = makeLogger('VideoChatService');

/**
 * What a call leaves behind outside of its window: the record of it in the
 * chat history, and the system notification of a call ended by its host.
 */
export function makeCallHistory(ctx: VideoChatCtx) {
  const { ownAddr, chatSrv, db, emit, appSettings, callRecordIds } = ctx;

  /**
   * OS-level notification shown to a client when the host ends the call.
   * Reaches the user even if the main window is closed (unlike the
   * in-window notice, which is emitted via sinkGUIEvents / VideoChatEvent).
   */
  async function notifyUserOnHostEndedCall(
    { chatId, chatName, hostAddr }: { chatId: ChatIdObj; chatName: string; hostAddr: string; hostName: string },
  ): Promise<void> {
    const icon = Uint8Array.from(LOGO_ICON_AS_ARRAY);
    const title = await appSettings.t('chat.notification.callEndedByHost.title');
    const body = await appSettings.t('chat.notification.callEndedByHost.message', { chatName });

    await replaceSystemNotification({
      icon,
      title: title ?? 'Call Ended',
      body: body ?? '',
      cmd: {
        cmd: 'open-chat-with',
        params: [{ chatId, peerAddress: hostAddr } as OpenChatCmdArg],
      },
    });
  }

  /**
   * Post-processing for video chat events.
   * Creates system messages when calls start and updates them when calls end.
   */
  function postProcessingForVideoChat(): {
    doAfterStartCall: (params: {
      chatId: ChatIdObj;
      direction: 'incoming' | 'outgoing';
      sender?: string;
      callSessionId?: string;
    }) => Promise<void>;
    doAfterEndCall: (chatId: ChatIdObj) => Promise<void>;
  } {
    const doAfterStartCall = async ({
      chatId,
      direction,
      sender,
      callSessionId,
    }: {
      chatId: ChatIdObj;
      direction: 'incoming' | 'outgoing';
      sender?: string;
      callSessionId?: string;
    }): Promise<void> => {
      // Derived from the session id when there is one, so that every device of
      // ours that answers this call writes the very same record - two of them
      // answering used to leave two lines about one call, only one of which
      // could ever get the duration (see chatMessageIdForCallEvent).
      const { chatMessageId, timestamp } = callSessionId
        ? {
          chatMessageId: chatMessageIdForCallEvent('call', callSessionId),
          timestamp: Date.now(),
        }
        : generateChatMessageId();

      // A derived id can already be taken: by a re-join of this same session,
      // which comes back through here, or by the phantom of a device that
      // answered before us. addMessage is a bare INSERT, so this is not merely
      // a duplicate line but a primary key violation. The id is remembered
      // either way - the duration has to find this record.
      if (callSessionId && (await db.getMessage({ chatId, chatMessageId }))) {
        callRecordIds.set(chatIdToString(chatId), chatMessageId);
        return;
      }

      const chatSystemData: ChatSystemMessageData = {
        event: 'call',
        value: {
          sender: sender || ownAddr,
          direction,
        },
      };
      const msg: MsgDbEntry = {
        groupChatId: chatId.isGroupChat ? chatId.chatId : null,
        otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
        chatMessageId,
        isIncomingMsg: false,
        incomingMsgId: null,
        groupSender: chatId.isGroupChat ? sender || ownAddr : null,
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

      // Remembered so that the end of this call is stamped onto THIS record,
      // rather than onto whichever system record the chat happens to end with
      // (see pickCallRecordToStamp).
      callRecordIds.set(chatIdToString(chatId), chatMessageId);

      // A call record is created purely locally, with nothing sent to peers, so
      // it reaches the user's other devices only through this explicit phantom.
      await chatSrv.syncLocallyMadeSystemEvent(chatId, chatMessageId, chatSystemData);
    };

    const doAfterEndCall = async (chatId: ChatIdObj): Promise<void> => {
      const now = Date.now();
      const chatKey = chatIdToString(chatId);
      const notRegularMsgs = db.getNotRegularMessagesByChat(chatId);
      // Every system record of the chat, in the order the db returned them (that
      // query has no ORDER BY, so it is insertion order): choosing between them
      // is pickCallRecordToStamp's job, and it does not rely on the order.
      const candidates = notRegularMsgs.filter(m => m.chatMessageType === 'system');

      const pick = pickCallRecordToStamp(candidates, now, callRecordIds.get(chatKey));
      // Consumed either way: a call that ended has no further use for its id,
      // and keeping it would let the next call in this chat stamp the wrong one.
      callRecordIds.delete(chatKey);

      if (pick) {
        const { candidate, body } = pick;
        body.value.endTimestamp = now;

        const updatedBody = JSON.stringify(body);
        const updatedMsg = await db.updateMessageRecord(
          { chatId, chatMessageId: candidate.chatMessageId },
          { body: updatedBody },
        );

        emit.message.updated(updatedMsg);

        // Synchronized as a body update: the receiving 'call' branch only ever
        // creates a missing record, it does not update an existing one.
        await chatSrv.syncLocallyMadeSystemEvent(chatId, candidate.chatMessageId, {
          event: 'update:body',
          value: { chatMessageId: candidate.chatMessageId, body: updatedBody },
        });
      } else {
        // A normal outcome, not a loss, and the ordinary way to reach it is a
        // re-join: the record's id is derived from the call session (see
        // doAfterStartCall), so returning to the same call comes back to the
        // SAME record, and a record that already carries an `endTimestamp` is
        // refused by parseCallBody - stamping twice would move the end of a call
        // that is over.
        //
        // What follows from that, and is worth knowing before anyone reads this
        // line as a defect: for a device that left before the call ended, the
        // duration in the chat history is the one of its FIRST stretch. In the
        // run of 2026-08-17 17:07-17:11 that showed as ~48s for the address that
        // left and came back, against the ~3.5 min recorded by the participant
        // who stayed.
        log.info(
          `No unstamped 'call' record to put the duration on in chat ${chatKey}`,
        );
      }

      // Phantoms step aside while a call is on, so this is the moment they were
      // waiting for - and it must not depend on there having been a record to
      // stamp. A call that was declined or never answered has no 'call' record
      // at all, yet it is exactly the call that leaves a phantom behind (the
      // "was cancelled" line), and an early return here left it waiting on the
      // retry timer instead. Not awaited: the release spaces its deliveries
      // out, and the end of a call must not wait on ASMail.
      chatSrv.releasePendingSyncPhantoms().catch(err => log.error(
        `Failed to release sync phantoms held back by the call`, err,
      ));
    };

    return {
      doAfterStartCall,
      doAfterEndCall,
    };
  }

  function nameFromAddr(addr: string): string {
    return addr.indexOf('@') === 0 ? addr : addr.substring(0, addr.indexOf('@'));
  }

  return {
    notifyUserOnHostEndedCall,
    postProcessingForVideoChat,
    nameFromAddr,
  };
}

export type CallHistory = ReturnType<typeof makeCallHistory>;
