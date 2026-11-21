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
  ChatIncomingMessage,
  ChatSystemMessageData,
  ChatSystemMsgV1,
  UpdatedMsgBodySysMsgData,
  UpdatedMsgReactionSysMsgData,
} from '../../../types/asmail-msgs.types.ts';
import type { ChatDbEntry, ChatSrv } from '../../types/index.ts';
import type { ChatSrvCtx } from './chat-srv-ctx.ts';

export type CallSysMsgHandler = Parameters<ChatSrv['onIncomingCallSysMsg']>[0];

/**
 * System messages of peers: a dispatch of each event to the handler of the
 * chat operation it belongs to (utils/).
 */
export function makeIncomingSystemMsgs(ctx: ChatSrvCtx, callSysMsgHandlers: ReadonlySet<CallSysMsgHandler>) {
  const {
    data,
    msgStatusUpdating,
    msgDeletion,
    chatMembersUpdating,
    chatRenaming,
    chatSettingUp,
    chatMemberRemoval,
    webRTCCallReaction,
    msgEditing,
    msgReactions,
  } = ctx;

  async function handleSystemMsg(
    msg: ChatIncomingMessage,
    chat: ChatDbEntry,
    chatMsgBody: ChatSystemMsgV1,
  ): Promise<void> {
    const { chatSystemData: sysData, chatMessageId } = chatMsgBody;

    switch (sysData.event) {
      case 'update:status':
        await msgStatusUpdating.handleUpdateMessageStatus(msg.sender, chat, sysData.value, msg.deliveryTS);
        break;

      case 'delete:message':
        await msgDeletion.handleDeleteChatMessage(chat, sysData.value);
        break;

      case 'update:members':
        await chatMembersUpdating.handleUpdateChatMembers(
          msg.sender,
          chat,
          chatMessageId!,
          msg.deliveryTS,
          sysData.value,
        );
        break;

      case 'update:admins':
        await chatMembersUpdating.handleUpdateChatAdmins(
          msg.sender,
          chat,
          chatMessageId!,
          msg.deliveryTS,
          sysData.value,
        );
        break;

      case 'update:chatName':
        await chatRenaming.handleUpdateChatName(msg.sender, chat, chatMessageId!, msg.deliveryTS, sysData);
        break;

      case 'update:settings':
        await chatSettingUp.handleUpdateSettings(msg.sender, chat, chatMessageId!, msg.deliveryTS, sysData);
        break;

      case 'member-removed':
        await chatMemberRemoval.handleMemberRemovedChat(
          msg.sender,
          chat,
          chatMessageId!,
          msg.deliveryTS,
          sysData.chatDeleted,
        );
        break;

      case 'webrtc-call': {
        // Our own view of the chat, not the `chatId` the sender put in the body:
        // for a one-to-one chat that is the sender's projection of it, i.e. this
        // very user's address.
        const callChatId: ChatIdObj = {
          isGroupChat: chat.isGroupChat,
          chatId: chat.isGroupChat ? chat.chatId : chat.peerCAddr,
        };
        await webRTCCallReaction.handleReactionToWebRTCCall(msg, {
          ...sysData.value,
          chatId: callChatId,
        });
        // Reported to the rest of this process as well, so that acting on a
        // cancelled call does not depend on a window being open. Each handler is
        // guarded: this function's caller only takes the message out of the inbox
        // once it returns, so a throwing listener would leave it there for good.
        for (const handler of callSysMsgHandlers) {
          try {
            handler({
              chatId: callChatId,
              sender: msg.sender,
              subType: sysData.value.subType,
              callSessionId: sysData.value.callSessionId,
              deliveryTS: msg.deliveryTS,
            });
          } catch (err) {
            await w3n.log('error', `Handler of an incoming call system message threw`, err);
          }
        }
        break;
      }

      case 'update:body':
        await msgEditing.handleUpdateOfMessageBody({
          user: msg.sender,
          chatId: chat.isGroupChat
            ? { isGroupChat: true, chatId: chat.chatId }
            : { isGroupChat: false, chatId: chat.peerCAddr },
          chatMessageId: (sysData as UpdatedMsgBodySysMsgData).value.chatMessageId,
          timestamp: msg.deliveryTS,
          body: (sysData as UpdatedMsgBodySysMsgData).value.body,
        });
        break;

      case 'update:reactions':
        await msgReactions.handleChangeOfReactions({
          user: msg.sender,
          chatId: chat.isGroupChat
            ? { isGroupChat: true, chatId: chat.chatId }
            : { isGroupChat: false, chatId: chat.peerCAddr },
          chatMessageId: (sysData as UpdatedMsgReactionSysMsgData).value.chatMessageId,
          timestamp: msg.deliveryTS,
          reactions: (sysData as UpdatedMsgReactionSysMsgData).value.reactions,
        });
        break;

      default:
        await w3n.log(
          'info',
          `No handler found to handle chat system event ${(sysData as ChatSystemMessageData).event}`,
        );
        break;
    }

    // Schedule deferred removal only once the event is durably applied - if a
    // handler above threw, the message stays in the inbox and gets a chance to
    // be reprocessed on the next start-up instead of being silently lost.
    await data.scheduleInboxMsgRemoval(msg.msgId);
  }

  return { handleSystemMsg };
}
