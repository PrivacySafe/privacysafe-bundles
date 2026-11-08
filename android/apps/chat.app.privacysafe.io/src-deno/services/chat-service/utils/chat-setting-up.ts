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
import type { ChatIdObj, UpdatedChatSettingsSysMsgData } from '../../../../types/asmail-msgs.types.ts';
import type { ChatDbEntry, ChatSettings, ChatSrvEmit, DB } from '../../../types/index.ts';
import { makeDbRecordException } from '../../../utils/exceptions.ts';
import { includesAddress } from '../../../../shared-libs/address-utils.ts';
import { generateChatMessageId } from '../../../../shared-libs/chat-ids.ts';
import { makeMsgDbEntry, msgDbEntryForIncomingSysMsg } from './_msgs-related-methods.ts';
import { excludeAddrFrom, chatIdOfChat } from './_chats-related-methods.ts';
import { sendSystemMessage, makeSystemEventPhantom, queueSyncPhantom } from '../../mail-sending-service/index.ts';
import { chatEntityId } from './sync-versions.ts';

export async function chatSettingUp({
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
  async function stampAndSyncSettings(
    chatId: ChatIdObj,
    timestamp: number,
    chatSystemData: UpdatedChatSettingsSysMsgData,
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
          aspect: 'settings',
          ts: timestamp,
          deviceId: getAppDeviceId(),
        },
      ],
    });
  }

  async function setUp(chatId: ChatIdObj, updatedData: Partial<ChatSettings>): Promise<void> {
    const chat = data.findChat(chatId);
    if (!chat) {
      throw makeDbRecordException({ chatNotFound: true });
    }

    if (chat.isGroupChat && !includesAddress(chat.admins, ownAddr)) {
      throw makeDbRecordException({ notAdmin: true });
    }

    const settings = {
      ...chat.settings,
      ...updatedData,
    };
    const updatedChat = chat.isGroupChat
      ? await data.updateGroupChatRecord(chatId.chatId, { settings })
      : await data.updateOTOChatRecord(chatId.chatId, { settings });

    if (!updatedChat) {
      return;
    }

    emit.chat.updated(updatedChat);

    const chatSystemData: UpdatedChatSettingsSysMsgData = {
      event: 'update:settings',
      value: { settings },
    };

    // Stamped and synced right where the change is applied - see the matching
    // comment in renameChat() (chat-renaming.ts).
    const syncStamp = await nextSyncStamp();
    await stampAndSyncSettings(chatId, syncStamp, chatSystemData);

    const { chatMessageId, timestamp } = generateChatMessageId();
    const msg = makeMsgDbEntry('system', chatMessageId, {
      ...(chat.isGroupChat && { groupChatId: chat.chatId }),
      ...(!chat.isGroupChat && { otoPeerCAddr: chat.peerCAddr }),
      body: JSON.stringify(chatSystemData),
      timestamp,
    });
    await data.addMessage(msg);
    emit.message.added(msg);

    const recipients = chat.isGroupChat ? excludeAddrFrom(Object.keys(chat.members), ownAddr) : [chat.peerCAddr];
    await sendSystemMessage({
      chatId,
      chatMessageId,
      recipients,
      chatSystemData,
    });
  }

  async function handleUpdateSettings(
    sender: string,
    chat: ChatDbEntry,
    chatMessageId: string,
    timestamp: number,
    chatSystemData: UpdatedChatSettingsSysMsgData,
  ): Promise<void> {
    if (chat.isGroupChat && !includesAddress(chat.admins, sender)) {
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

    const { settings } = chatSystemData.value;
    const updatedChat = chat.isGroupChat
      ? await data.updateGroupChatRecord(chat.chatId, { settings })
      : await data.updateOTOChatRecord(chat.peerCAddr, { settings });
    if (!updatedChat) {
      return;
    }
    emit.chat.updated(updatedChat);

    // Peer-originated change: stamped with the server's deliveryTS and the
    // sender, so every own device derives the same token - see the matching
    // comment in handleUpdateChatName() (chat-renaming.ts).
    await data.setSyncVersion('chat', chatEntityId(chatId), 'settings', {
      ts: timestamp,
      deviceId: sender,
    });

    const sysMsg = msgDbEntryForIncomingSysMsg(sender, chatId, chatMessageId, timestamp, chatSystemData);
    await data.addMessage(sysMsg);
    emit.message.added(sysMsg);
  }

  return {
    setUp,
    handleUpdateSettings,
  };
}
