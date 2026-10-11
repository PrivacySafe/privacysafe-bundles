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
import type { ChatIdObj, ChatMessageId, DeleteMessageSysMsgData } from '../../../../types/asmail-msgs.types.ts';
import type { MsgsDeletionResult } from '../../../../types/chat.types.ts';
import type { ChatDbEntry, ChatSrvEmit, DB, FileStoreService } from '../../../types/index.ts';
import { makeDbRecordException } from '../../../utils/exceptions.ts';
import { includesAddress } from '../../../../shared-libs/address-utils.ts';
import { removeMsgBytes, removeMsgDataNotInDB } from './_msgs-related-methods.ts';
import { removeMessagesFromInboxBatch } from '../../../utils/inbox-utils.ts';
import { chatIdOfChat, recipientsInChat } from './_chats-related-methods.ts';
import { sendSystemMessage, makeDeleteMessagePhantom, queueSyncPhantom } from '../../mail-sending-service/index.ts';
import { chatEntityId, msgEntityId } from './sync-versions.ts';

export async function msgDeletion({
  data,
  filesStore,
  emit,
  ownAddr,
  getAppDeviceId,
  nextSyncStamp,
}: {
  data: DB;
  emit: ChatSrvEmit;
  filesStore: FileStoreService;
  ownAddr: string;
  getAppDeviceId: () => string;
  nextSyncStamp: () => Promise<number>;
}) {
  /**
   * Records tombstones of the deleted messages and queues the phantom telling
   * the user's other devices about the deletion - in one step, so that a spent
   * ordering token cannot be left without its phantom (see sync-phantoms.ts).
   *
   * A tombstone is what keeps a phantom arriving after the deletion (a status
   * update, an edit, or the message record itself) from bringing the message
   * back.
   */
  async function recordAndSyncMsgDeletions(
    chatId: ChatIdObj,
    chatMessageIds: string[],
    timestamp: number,
    value: DeleteMessageSysMsgData['value'],
  ): Promise<void> {
    const deviceId = getAppDeviceId();
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeDeleteMessagePhantom({ chatId, sourceDeviceId: deviceId, timestamp, value }),
      versions: chatMessageIds.map(chatMessageId => ({
        entityType: 'msg' as const,
        entityId: msgEntityId(chatId, chatMessageId),
        aspect: 'deleted' as const,
        ts: timestamp,
        deviceId,
        tombstonedAt: Date.now(),
        dropOtherAspects: true,
      })),
    });
  }

  /**
   * Splits attempted deletions into the ones that went through and the ones
   * that did not, logging every failure. Results of allSettled() come back in
   * the order the promises were given, which is what lets them be matched back
   * to their ids.
   */
  async function partitionDeletionOutcomes(
    attempted: ChatMessageId[],
    removals: Promise<void>[],
  ): Promise<MsgsDeletionResult> {
    const outcomes = await Promise.allSettled(removals);
    const deleted: ChatMessageId[] = [];
    const failed: ChatMessageId[] = [];

    for (let i = 0; i < outcomes.length; i += 1) {
      const outcome = outcomes[i];
      if (outcome.status === 'fulfilled') {
        deleted.push(attempted[i]);
      } else {
        failed.push(attempted[i]);
        await w3n.log('error', `Failed to delete message ${attempted[i].chatMessageId}`, outcome.reason);
      }
    }

    return { deleted, failed };
  }

  async function deleteMessage(id: ChatMessageId, deleteForEveryone: boolean): Promise<void> {
    const chat = data.findChat(id.chatId);
    if (!chat) {
      throw makeDbRecordException({ chatNotFound: true });
    }
    const msg = await data.getMessage(id);
    if (!msg) {
      throw makeDbRecordException({ messageNotFound: true });
    }

    // change local data
    await removeMsgBytes(data, filesStore, id, msg);
    emit.message.removed(id);

    // Sync this deletion to the user's other devices regardless of
    // deleteForEveryone - it's a local DB change and must be replicated even
    // when not notifying peers ("delete for myself").
    const syncStamp = await nextSyncStamp();
    await recordAndSyncMsgDeletions(id.chatId, [id.chatMessageId], syncStamp, { oneMessage: id });

    if (deleteForEveryone) {
      const { chatId } = id;
      const recipients = recipientsInChat(chat, ownAddr);
      await sendSystemMessage({
        chatId,
        recipients,
        chatSystemData: {
          event: 'delete:message',
          value: { oneMessage: id },
        },
      });
    }
  }

  /**
   * Deletes messages, and tells the caller which of them are actually gone.
   *
   * Removal of a message is several steps (DB row, inbox message, attachment
   * files), and any of them can fail for one message while succeeding for
   * another. Only the ones that went through are announced to the GUI and
   * synchronized to the user's other devices - announcing all of them would
   * leave the interface showing a chat the database does not have, until the
   * next full reload.
   */
  async function deleteMessages(
    chatMsgIds: ChatMessageId[] = [],
    deleteForEveryone?: boolean,
    syncOwnDevices = true,
  ): Promise<MsgsDeletionResult> {
    const chatId = chatMsgIds.length > 0 ? chatMsgIds[0].chatId : null;
    if (!chatId) {
      throw makeDbRecordException({ chatNotFound: true });
    }

    const chat = data.findChat(chatId);
    if (!chat) {
      throw makeDbRecordException({ chatNotFound: true });
    }

    const attempted: ChatMessageId[] = [];
    const removeMsgsPr: Promise<void>[] = [];
    for (const chatMessageId of chatMsgIds) {
      const msg = await data.getMessage(chatMessageId);
      if (!msg) {
        throw makeDbRecordException({ messageNotFound: true });
      }

      attempted.push(chatMessageId);
      removeMsgsPr.push(removeMsgBytes(data, filesStore, chatMessageId, msg));
    }
    const { deleted, failed } = await partitionDeletionOutcomes(attempted, removeMsgsPr);

    if (deleted.length > 0) {
      emit.message.removedMultiple(deleted);
    }

    if (syncOwnDevices && deleted.length > 0) {
      const syncStamp = await nextSyncStamp();
      await recordAndSyncMsgDeletions(
        chatId,
        deleted.map(id => id.chatMessageId),
        syncStamp,
        { multipleMessages: { chatMsgIds: deleted } },
      );
    }

    if (deleteForEveryone && deleted.length > 0) {
      const recipients = recipientsInChat(chat, ownAddr);
      await sendSystemMessage({
        chatId,
        recipients,
        chatSystemData: {
          event: 'delete:message',
          value: {
            multipleMessages: {
              chatMsgIds: deleted,
            },
          },
        },
      });
    }

    return { deleted, failed };
  }

  async function deleteExpiredMessages(now: number): Promise<void> {
    const expiredMessages = await data.getExpiredMessages(now);
    const messagesToDelete = expiredMessages.map(msg => {
      const { chatMessageId, groupChatId, otoPeerCAddr } = msg;
      const chatId = groupChatId
        ? { isGroupChat: true, chatId: groupChatId! }
        : { isGroupChat: false, chatId: otoPeerCAddr! };

      return {
        chatId,
        chatMessageId,
      };
    });

    // Each device expires the same message independently based on its own
    // removeAfter timestamp, so there is nothing useful to sync here - doing
    // so would just add redundant sync traffic from every device.
    messagesToDelete.length > 0 && (await deleteMessages(messagesToDelete, undefined, false));
  }

  async function removeExpiredInboxMessages(now: number): Promise<void> {
    const dueMsgIds = data.getDueInboxMsgRemovals(now);
    if (dueMsgIds.length === 0) {
      return;
    }

    await removeMessagesFromInboxBatch(dueMsgIds, `Removing ${dueMsgIds.length} expired inbox message(s)`);
    await data.clearInboxMsgRemovals(dueMsgIds);
  }

  async function deleteMessagesInChat(chatId: ChatIdObj, deleteForEveryone: boolean): Promise<void> {
    const chat = data.findChat(chatId);
    if (!chat) {
      throw makeDbRecordException({ chatNotFound: true });
    }
    if (chat.isGroupChat && deleteForEveryone && !includesAddress(chat.admins, ownAddr)) {
      throw new Error(`Non-admin member can't delete message for everyone`);
    }

    // do local changes
    const msgsDataToRm = await data.deleteMessagesInChat(chatId);
    if (msgsDataToRm) {
      await removeMsgDataNotInDB(msgsDataToRm, filesStore);
    }
    emit.chat.allMsgsRemoved(chatId);

    // No per-message tombstones here: history clearing wipes an open-ended set
    // of messages, so a single chat-wide marker covers a phantom of any message
    // that predates the clearing. The chat itself lives on, so its other
    // aspects keep their versions (no dropOtherAspects).
    const syncStamp = await nextSyncStamp();
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeDeleteMessagePhantom({
        chatId,
        sourceDeviceId: getAppDeviceId(),
        timestamp: syncStamp,
        value: { allInChat: chatId },
      }),
      versions: [
        {
          entityType: 'chat',
          entityId: chatEntityId(chatId),
          aspect: 'historyCleared',
          ts: syncStamp,
          deviceId: getAppDeviceId(),
          tombstonedAt: Date.now(),
        },
      ],
    });

    // send notifications, if we need
    if (deleteForEveryone) {
      const recipients = recipientsInChat(chat, ownAddr);
      await sendSystemMessage({
        chatId,
        recipients,
        chatSystemData: {
          event: 'delete:message',
          value: { allInChat: chatId },
        },
      });
    }
  }

  async function handleDeleteChatMessage(
    chat: ChatDbEntry,
    value: DeleteMessageSysMsgData['value'],
  ): Promise<void> {
    const { oneMessage, multipleMessages } = value;

    if (oneMessage) {
      const { chatMessageId } = oneMessage;
      const chatId = chatIdOfChat(chat);
      const id = { chatId, chatMessageId };
      const msg = await data.getMessage(id);

      if (!msg) {
        return;
      }

      await removeMsgBytes(data, filesStore, id, msg);
      emit.message.removed(id);
      return;
    }

    if (multipleMessages) {
      const { chatMsgIds } = multipleMessages;

      const chatId = chatIdOfChat(chat);
      const attempted: ChatMessageId[] = [];
      const removeMsgsPr: Promise<void>[] = [];
      for (const id of chatMsgIds) {
        const { chatMessageId } = id;
        const msg = await data.getMessage({ chatId, chatMessageId });

        if (msg) {
          attempted.push({ chatId, chatMessageId });
          removeMsgsPr.push(removeMsgBytes(data, filesStore, { chatId, chatMessageId }, msg));
        }
      }
      // Messages absent from the database are left out of the event as well:
      // announcing a removal of what was never there makes the GUI drop a
      // message it may have just added.
      const { deleted } = await partitionDeletionOutcomes(attempted, removeMsgsPr);
      if (deleted.length > 0) {
        emit.message.removedMultiple(deleted);
      }
      return;
    }
  }

  return {
    deleteMessage,
    deleteMessages,
    deleteExpiredMessages,
    removeExpiredInboxMessages,
    deleteMessagesInChat,
    handleDeleteChatMessage,
  };
}
