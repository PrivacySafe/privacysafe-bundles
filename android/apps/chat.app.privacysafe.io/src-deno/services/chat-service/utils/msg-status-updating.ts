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
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ChatIdObj, ChatMessageId, UpdatedMsgStatusSysMsgData } from '../../../../types/asmail-msgs.types.ts';
import type { MessageStatus } from '../../../../types/chat.types.ts';
import type { ChatDbEntry, ChatSrvEmit, DB, MsgDbEntry } from '../../../types/index.ts';
import { makeDbRecordException } from '../../../utils/exceptions.ts';
import { serializeDeliveryError } from '../../../utils/delivery-errors.ts';
import { sendSystemMessage, makeMsgStatusPhantom, queueSyncPhantom } from '../../mail-sending-service/index.ts';
import { chatIdOfChat, recipientsInChat } from './_chats-related-methods.ts';
import { msgEntityId } from './sync-versions.ts';
import { LIFETIME_DAYS_IN_AUXILIARY_DB } from '../../../../shared-libs/constants/db.ts';

export async function msgStatusUpdating({
  data,
  emit,
  ownAddr,
  getAppDeviceId,
  nextSyncStamp,
}: {
  data: DB;
  emit: ChatSrvEmit;
  ownAddr: string;
  getAppDeviceId: () => string;
  nextSyncStamp: () => Promise<number>;
}) {
  /**
   * Stamps a locally made status change and syncs it to the user's own devices.
   *
   * The stamp and the phantom are written in one step, so that a spent
   * ordering token cannot be left without the phantom meant to spend it - see
   * sync-phantoms.ts.
   */
  async function stampAndSyncStatus(
    chatId: ChatIdObj,
    value: UpdatedMsgStatusSysMsgData['value'],
  ): Promise<void> {
    const syncStamp = await nextSyncStamp();
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeMsgStatusPhantom({
        chatId,
        sourceDeviceId: getAppDeviceId(),
        timestamp: syncStamp,
        value,
      }),
      versions: [
        {
          entityType: 'msg',
          entityId: msgEntityId(chatId, value.chatMessageId),
          aspect: 'status',
          ts: syncStamp,
          deviceId: getAppDeviceId(),
        },
      ],
    });
  }

  async function updateMessageStatus(
    chatMsgId: ChatMessageId,
    msgStatus: MessageStatus,
  ): Promise<{ chat: ChatDbEntry; updatedMsg: MsgDbEntry }> {
    const chat = data.findChat(chatMsgId.chatId);
    if (!chat) {
      throw makeDbRecordException({ chatNotFound: true });
    }

    const updatedMsg = await data.updateMessageRecord(
      { chatId: chatMsgId.chatId, chatMessageId: chatMsgId.chatMessageId },
      { status: msgStatus },
    );
    if (!updatedMsg) {
      throw makeDbRecordException({ messageNotFound: true });
    }
    emit.message.updated(updatedMsg);

    return { chat, updatedMsg };
  }

  async function markMessageAsReadNotifyingSender({ chatId, chatMessageId }: ChatMessageId): Promise<void> {
    const { chat } = await updateMessageStatus({ chatId, chatMessageId }, 'read');

    // notify peers
    const recipients = recipientsInChat(chat, ownAddr);
    await sendSystemMessage({
      chatId,
      recipients,
      chatSystemData: {
        event: 'update:status',
        value: { chatMessageId, status: 'read' },
      },
    });

    // notify own devices - unread counters and read status must match everywhere
    await stampAndSyncStatus(chatId, { chatMessageId, status: 'read' });
  }

  async function handleUpdateMessageStatus(
    sender: string,
    chat: ChatDbEntry,
    { chatMessageId, status }: UpdatedMsgStatusSysMsgData['value'],
    timestamp: number,
  ): Promise<void> {
    if (status !== 'sent' && status !== 'read') {
      return;
    }
    const chatId = chatIdOfChat(chat);
    const id = { chatId, chatMessageId };
    const msg = await data.getMessage(id);
    if (!msg || msg.isIncomingMsg) {
      return;
    }

    // Already applied (also covers redelivery of the same status) - skip to
    // avoid a redundant own-device sync phantom below.
    // XXX this should still add to history, without changing status
    if (msg.status === 'read' || msg.status === status) {
      return;
    }

    // update local data
    let updatedMsg: MsgDbEntry | undefined;
    if (chat.isGroupChat) {
      // XXX current code is simplistic.
      // XXX may want/need to update history
      updatedMsg = await data.updateMessageRecord(id, {
        status,
      });
    } else {
      // XXX may want to update history
      updatedMsg = await data.updateMessageRecord(id, {
        status,
      });
    }

    emit.message.updated(updatedMsg);

    // Own other devices only learn about this if this device explicitly tells
    // them - the peer's 'update:status' message was received by this one device.
    if (updatedMsg) {
      await stampAndSyncStatus(chatId, { chatMessageId, status });
    }
  }

  async function resolveStuckSyncingSelfMessages(): Promise<void> {
    const cutoff = Date.now() - LIFETIME_DAYS_IN_AUXILIARY_DB;
    const stuckMsgs = data.getMessagesWithSyncingSelfStatus().filter(msg => msg.timestamp < cutoff);

    for (const msg of stuckMsgs) {
      const chatId: ChatIdObj = {
        isGroupChat: !!msg.groupChatId,
        chatId: (msg.groupChatId || msg.otoPeerCAddr)!,
      };
      const history = msg.history || { changes: [] };
      if (!history.changes) {
        history.changes = [];
      }
      history.changes.push({
        user: ownAddr,
        timestamp: Date.now(),
        type: 'error',
        value: {
          [ownAddr]: serializeDeliveryError(
            new Error('Originating device never confirmed delivery of this message'),
          ),
        },
      });

      const updatedMsg = await data.updateMessageRecord(
        { chatId, chatMessageId: msg.chatMessageId },
        { status: 'error', history },
      );
      if (updatedMsg) {
        emit.message.updated(updatedMsg);
      }
    }
  }

  return {
    updateMessageStatus,
    markMessageAsReadNotifyingSender,
    handleUpdateMessageStatus,
    resolveStuckSyncingSelfMessages,
  };
}
