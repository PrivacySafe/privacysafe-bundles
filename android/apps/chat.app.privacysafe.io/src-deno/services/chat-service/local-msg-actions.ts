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
  ChatMessageId,
  ChatSystemMsgV1,
  RelatedMessage,
  UpdatedMsgBodySysMsgData,
  UpdatedMsgReactionSysMsgData,
} from '../../../types/asmail-msgs.types.ts';
import type {
  ChatMessageReaction,
  ChatMessageView,
  OutgoingAttachment,
  RegularMsgView,
} from '../../../types/chat.types.ts';
import {
  makeMsgRecordPhantom,
  queueSyncPhantom,
  sendSystemDeletableMessage as _sendSystemDeletableMessage,
} from '../mail-sending-service/index.ts';
import { msgViewFromDbEntry } from './utils/_msgs-related-methods.ts';
import { msgEntityId } from './utils/sync-versions.ts';
import type { ChatSrvCtx } from './chat-srv-ctx.ts';
import type { ChatQueries } from './chat-queries.ts';

/**
 * What the user does with messages: sending, cancelling a sending, editing and
 * reactions - together with telling peers and own devices about it.
 */
export function makeLocalMsgActions(ctx: ChatSrvCtx, { getChat }: Pick<ChatQueries, 'getChat'>) {
  const {
    data,
    ownAddr,
    getAppDeviceId,
    nextSyncStamp,
    msgSending,
    msgStatusUpdating,
    msgEditing,
    msgReactions,
  } = ctx;

  async function sendRegularMessage({
    chatId,
    chatMessageId,
    text,
    files,
    relatedMessage,
  }: {
    chatId: ChatIdObj;
    chatMessageId?: string;
    text: string;
    files: OutgoingAttachment[] | undefined;
    relatedMessage: RelatedMessage | undefined;
  }): Promise<void> {
    return msgSending.sendRegularMessage({ chatId, chatMessageId, text, files, relatedMessage });
  }

  async function cancelSendingMessage(deliveryId: string, chatMsgId: ChatMessageId): Promise<void> {
    await msgSending.cancelSendingMessage(deliveryId);
    await msgStatusUpdating.updateMessageStatus(chatMsgId, 'canceled');

    // Cancelling removes the delivery, hence no progress event will ever report
    // this terminal status. Other devices, which show the message as
    // 'syncing_self', have to be told about it explicitly.
    const msg = await data.getMessage(chatMsgId);
    if (msg) {
      await queueSyncPhantom({
        db: data,
        ownAddr,
        phantom: makeMsgRecordPhantom({
          chatId: chatMsgId.chatId,
          sourceDeviceId: getAppDeviceId(),
          timestamp: await nextSyncStamp(),
          msg,
        }),
        entity: {
          entityType: 'msg',
          entityId: msgEntityId(chatMsgId.chatId, chatMsgId.chatMessageId),
          aspect: 'record',
        },
      });
    }
  }

  async function sendSystemDeletableMessage({
    chatId,
    recipients,
    chatMessageId,
    chatSystemData,
  }: { chatId: ChatIdObj; recipients: string[] } & Pick<
    ChatSystemMsgV1,
    'chatMessageId' | 'chatSystemData'
  >): Promise<void> {
    return _sendSystemDeletableMessage({
      chatId,
      recipients,
      chatMessageId,
      chatSystemData,
    });
  }

  async function updateEarlySentMessage({
    chatId,
    chatMessageId,
    updatedBody,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
    updatedBody: string;
  }): Promise<ChatMessageView | undefined> {
    const updatedMessage = await msgEditing.editMessage({ chatId, chatMessageId, updatedBody });
    if (!updatedMessage) {
      return undefined;
    }

    const chat = await getChat(chatId);
    const recipients = chat!.isGroupChat
      ? Object.keys(chat!.members).filter(addr => addr !== ownAddr)
      : [chat!.peerAddr];

    sendSystemDeletableMessage({
      chatId,
      recipients,
      chatMessageId,
      chatSystemData: {
        event: 'update:body',
        value: {
          chatMessageId,
          body: updatedBody,
        },
      } as UpdatedMsgBodySysMsgData,
    });

    return msgViewFromDbEntry(
      updatedMessage,
      updatedMessage.relatedMessage as RegularMsgView['relatedMessage'],
      ownAddr,
    );
  }

  async function changeMessageReaction({
    chatId,
    chatMessageId,
    updatedReactions,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
    updatedReactions: Record<string, ChatMessageReaction>;
  }): Promise<ChatMessageView | undefined> {
    const updatedMessage = await msgReactions.changeMessageReactions({
      chatId,
      chatMessageId,
      updatedReactions,
    });
    if (!updatedMessage) {
      return undefined;
    }

    const chat = await getChat(chatId);
    const recipients = chat!.isGroupChat
      ? Object.keys(chat!.members).filter(addr => addr !== ownAddr)
      : [chat!.peerAddr];

    sendSystemDeletableMessage({
      chatId,
      recipients,
      chatMessageId,
      chatSystemData: {
        event: 'update:reactions',
        value: {
          chatMessageId,
          reactions: updatedReactions,
        },
      } as UpdatedMsgReactionSysMsgData,
    });

    return msgViewFromDbEntry(
      updatedMessage,
      updatedMessage.relatedMessage as RegularMsgView['relatedMessage'],
      ownAddr,
    );
  }

  return {
    sendRegularMessage,
    cancelSendingMessage,
    sendSystemDeletableMessage,
    updateEarlySentMessage,
    changeMessageReaction,
  };
}
