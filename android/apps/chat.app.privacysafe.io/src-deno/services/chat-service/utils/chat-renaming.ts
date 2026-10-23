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
import type { ChatIdObj, UpdatedChatNameSysMsgData } from '../../../../types/asmail-msgs.types.ts';
import type { ChatDbEntry, ChatSrvEmit, DB } from '../../../types/index.ts';
import { includesAddress } from '../../../../shared-libs/address-utils.ts';
import { generateChatMessageId } from '../../../../shared-libs/chat-ids.ts';
import { chatIdOfChat, excludeAddrFrom } from './_chats-related-methods.ts';
import { makeMsgDbEntry, msgDbEntryForIncomingSysMsg } from './_msgs-related-methods.ts';
import { sendSystemMessage, makeSystemEventPhantom, queueSyncPhantom } from '../../mail-sending-service/index.ts';
import { makeDbRecordException } from '../../../utils/exceptions.ts';
import { chatEntityId } from './sync-versions.ts';

export async function chatRenaming({
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
  async function stampAndSyncChatName(
    chatId: ChatIdObj,
    timestamp: number,
    chatSystemData: UpdatedChatNameSysMsgData,
  ): Promise<void> {
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeSystemEventPhantom({
        chatId,
        sourceDeviceId: getAppDeviceId(),
        timestamp,
        chatSystemData,
      }),
      versions: [
        {
          entityType: 'chat',
          entityId: chatEntityId(chatId),
          aspect: 'name',
          ts: timestamp,
          deviceId: getAppDeviceId(),
        },
      ],
    });
  }

  async function renameChat(chatId: ChatIdObj, name: string): Promise<void> {
    if (!chatId.isGroupChat) {
      throw new Error(`Only group chat can be renamed. One-to-one chat needs contact details update`);
    }
    const chat = data.findChat(chatId);
    if (!chat) {
      throw makeDbRecordException({ chatNotFound: true });
    } else if (!chat.isGroupChat) {
      throw makeDbRecordException({ notGroupChat: true });
    } else if (!includesAddress(chat.admins, ownAddr)) {
      throw makeDbRecordException({ notAdmin: true });
    } else if (chat.name === name) {
      return;
    }

    // do local changes and notifications
    const updatedChat = await data.updateGroupChatRecord(chatId.chatId, { name });
    if (!updatedChat) {
      return;
    }
    emit.chat.updated(updatedChat);

    const chatSystemData: UpdatedChatNameSysMsgData = {
      event: 'update:chatName',
      value: { name },
    };

    // Stamp this change and sync it to the user's own devices right here, at the
    // point the change is applied - not from the delivery-progress hook, which
    // would tie it to reaching peers and stamp it with the time delivery ended.
    const syncStamp = await nextSyncStamp();
    await stampAndSyncChatName(chatId, syncStamp, chatSystemData);

    // send request to other members, recording it locally, as well
    const { chatMessageId, timestamp } = generateChatMessageId();
    const msg = makeMsgDbEntry('system', chatMessageId, {
      groupChatId: chat.chatId,
      body: JSON.stringify(chatSystemData),
      timestamp,
    });
    await data.addMessage(msg);
    emit.message.added(msg);

    const recipients = excludeAddrFrom(Object.keys(chat.members), ownAddr);
    await sendSystemMessage({
      chatId,
      chatMessageId,
      recipients,
      chatSystemData,
    });
  }

  async function handleUpdateChatName(
    sender: string,
    chat: ChatDbEntry,
    chatMessageId: string,
    timestamp: number,
    chatSystemData: UpdatedChatNameSysMsgData,
  ): Promise<void> {
    if (!chatMessageId || !chat.isGroupChat || !includesAddress(chat.admins, sender)) {
      return;
    }

    const chatId = chatIdOfChat(chat);
    const existingMsg = await data.getMessage({ chatId, chatMessageId });
    if (existingMsg) {
      // Already processed - see the matching comment in handleRegularMsg()
      // (msg-sending.ts). Note updateGroupChatRecord()/updateOTOChatRecord()
      // always bump lastUpdatedAt, so `if (!updatedChat) return` below never
      // actually catches a redelivery on its own.
      return;
    }

    const { name } = chatSystemData.value;
    const updatedChat = await data.updateGroupChatRecord(chat.chatId, { name });
    if (!updatedChat) {
      return;
    }
    emit.chat.updated(updatedChat);

    // A peer's change lands in the shared inbox and is applied by every one of
    // this user's devices on its own, so it needs no phantom - but it still has
    // to be stamped, or a stale phantom of an older own rename would overwrite
    // it. deliveryTS is stamped by the ASMail server and the sender address is
    // fixed, so all own devices derive the very same token and cannot diverge.
    await data.setSyncVersion('chat', chatEntityId(chatId), 'name', {
      ts: timestamp,
      deviceId: sender,
    });

    await data.addMessage(msgDbEntryForIncomingSysMsg(sender, chatId, chatMessageId, timestamp, chatSystemData));
    const sysMsg = await data.getMessage({
      chatId: chatId,
      chatMessageId,
    });
    emit.message.added(sysMsg!);
  }

  return {
    renameChat,
    handleUpdateChatName,
  };
}
