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
import type { ChatIdObj } from '../../../../types/asmail-msgs.types.ts';
import type { ChatListItemView } from '../../../../types/chat.types.ts';
import type { ChatDbEntry, GroupChatDbEntry, MsgDbEntry, OTOChatDbEntry } from '../../../types/index.ts';
import { msgDbEntryToChatMessageView } from './_msgs-related-methods.ts';
import { areAddressesEqual, includesAddress } from '../../../../shared-libs/address-utils.ts';

export function chatViewFromOTOChatDbEntry(otoChatDbEntry: OTOChatDbEntry, options?: unknown): ChatListItemView {
  const {
    peerCAddr,
    peerAddr,
    name,
    createdAt,
    lastUpdatedAt,
    status,
    lastMsg,
    unread = 0,
    settings = {
      autoDeleteMessages: '0',
    },
  } = otoChatDbEntry;

  return {
    isGroupChat: false,
    chatId: peerCAddr,
    peerAddr,
    name,
    createdAt,
    lastUpdatedAt,
    status,
    unread,
    lastMsg: lastMsg ? msgDbEntryToChatMessageView(lastMsg) : null,
    settings: settings!,
  };
}

export function chatViewFromGroupChatDbEntry(
  groupChatDbEntry: GroupChatDbEntry,
  options?: unknown,
): ChatListItemView {
  const {
    chatId,
    admins,
    createdAt,
    lastUpdatedAt,
    members,
    name,
    status,
    lastMsg,
    unread = 0,
    settings = {
      autoDeleteMessages: '0',
    },
  } = groupChatDbEntry;

  return {
    isGroupChat: true,
    chatId,
    admins,
    createdAt,
    lastUpdatedAt,
    members,
    name,
    status,
    unread,
    lastMsg: lastMsg ? msgDbEntryToChatMessageView(lastMsg) : null,
    settings: settings!,
  };
}

export function chatViewFromChatDbEntry(chat: GroupChatDbEntry | OTOChatDbEntry): ChatListItemView {
  return (chat as OTOChatDbEntry).peerCAddr
    ? chatViewFromOTOChatDbEntry(chat as OTOChatDbEntry)
    : chatViewFromGroupChatDbEntry(chat as GroupChatDbEntry);
}

export function chatIdOfChat(chat: GroupChatDbEntry | OTOChatDbEntry): ChatIdObj {
  return (chat as OTOChatDbEntry).peerCAddr
    ? chatIdOfOTOChat(chat as OTOChatDbEntry)
    : chatIdOfGroupChat(chat as GroupChatDbEntry);
}

export function chatIdOfOTOChat({ peerCAddr }: OTOChatDbEntry): ChatIdObj {
  return {
    isGroupChat: false,
    chatId: peerCAddr,
  };
}

export function chatIdOfGroupChat({ chatId }: GroupChatDbEntry): ChatIdObj {
  return {
    isGroupChat: true,
    chatId,
  };
}

export function chatIdOfMsg(msg: MsgDbEntry): ChatIdObj {
  const { groupChatId, otoPeerCAddr } = msg;
  return {
    isGroupChat: !!groupChatId,
    chatId: groupChatId ? groupChatId : otoPeerCAddr!,
  };
}

export function excludeAddrFrom(lst: string[], excludeAddr: string): string[] {
  return lst.filter(addr => !areAddressesEqual(addr, excludeAddr));
}

export function excludeAddrsFrom(lst: string[], ...exclAddrs: string[]): string[] {
  return lst.filter(addr => !includesAddress(exclAddrs, addr));
}

export function chatViewForGroupChat(chat: GroupChatDbEntry): ChatListItemView {
  return chatViewFromGroupChatDbEntry(chat);
}

export function chatViewForOTOChat(chat: OTOChatDbEntry): ChatListItemView {
  return chatViewFromOTOChatDbEntry(chat);
}

export function recipientsInChat(chat: ChatDbEntry, ownAddr: string): string[] {
  return chat.isGroupChat
    ? Object.keys(chat.members).filter(addr => !areAddressesEqual(addr, ownAddr))
    : [chat.peerAddr];
}
