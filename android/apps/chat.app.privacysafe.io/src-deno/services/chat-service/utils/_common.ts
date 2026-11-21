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
import { toCanonicalAddress } from '../../../../shared-libs/address-utils.ts';
import type {
  ChatIdObj,
  GroupChatParameters,
  InvitationProcessMsgData,
  StoredInvitationParams,
} from '../../../../types/asmail-msgs.types.ts';
import type { OpenChatCmdArg } from '../../../../types/chat-commands.types.ts';

export function inviteChatId(sender: string, inviteData: InvitationProcessMsgData): ChatIdObj | undefined {
  if (inviteData.type === 'group-chat-invite') {
    return chatIdFromGroupChatInvite(inviteData);
  }

  if (inviteData.type === 'oto-chat-invite') {
    return {
      isGroupChat: false,
      chatId: toCanonicalAddress(sender),
    };
  }

  if (inviteData.type === 'updated-members-invitation-data') {
    return inviteData.chatId;
  }

  const { groupChat, oneToOneChat } = inviteData;
  if (oneToOneChat) {
    return {
      isGroupChat: false,
      chatId: toCanonicalAddress(sender),
    };
  } else if (groupChat) {
    return chatIdFromGroupChatInvite(groupChat);
  }
}

export function chatIdFromGroupChatInvite({ groupChatId }: GroupChatParameters): ChatIdObj | undefined {
  return !groupChatId.includes('@') ? { isGroupChat: true, chatId: groupChatId } : undefined;
}

export function serializeInvitation(inviteParams: StoredInvitationParams): string {
  return JSON.stringify(inviteParams);
}

export function deserializeInvitation(msgBody: string): StoredInvitationParams | undefined {
  if (!msgBody || typeof msgBody !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(msgBody);
  } catch {
    return undefined;
  }
}

export function triggerMainUIOpening(chatId: ChatIdObj, sender: string): void {
  w3n.shell!.startAppWithParams!(null, 'open-chat-with', {
    chatId,
    peerAddress: sender,
  } as OpenChatCmdArg).catch(e => w3n.log('error', `Fail to start main UI component`, e));
}

export function isString(s: string | undefined): boolean {
  return typeof s === 'string' && s.length > 0;
}
