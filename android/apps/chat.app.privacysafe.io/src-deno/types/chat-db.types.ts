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
import type { ChatIdObj } from '../../types/asmail-msgs.types.ts';
import type { GroupChatStatus, SingleChatStatus } from '../../types/chat.types.ts';
import type { MsgDbEntry, RefsToMsgsDataNoInDB } from './msgs-db.types.ts';

export interface ChatSettings {
  autoDeleteMessages?: string;
  msgOwnersDeviceId?: string;
  [key: string]: unknown;
}

export interface GroupChatDbEntry extends GroupChatTableFields, FieldsFromMsgsDb {}

export interface GroupChatTableFields {
  chatId: string;
  members: Record<string, { hasAccepted: boolean }>;
  admins: string[];
  name: string;
  createdAt: number;
  lastUpdatedAt: number;
  status: GroupChatStatus;
  settings: ChatSettings | null;
}

export interface FieldsFromMsgsDb {
  lastMsg?: MsgDbEntry | null;
  unread?: number;
}

export type GroupChatDbRecord = Omit<GroupChatDbEntry, 'members' | 'admins'> & {
  members: string;
  admins: string;
};

export interface OTOChatDbEntry extends OTOChatTableFields, FieldsFromMsgsDb {}

export interface OTOChatTableFields {
  peerCAddr: string;
  peerAddr: string;
  name: string;
  createdAt: number;
  lastUpdatedAt: number;
  status: SingleChatStatus;
  settings: ChatSettings | null;
}

export type ChatDbEntry = (GroupChatDbEntry & { isGroupChat: true }) | (OTOChatDbEntry & { isGroupChat: false });

export interface ChatsDb {
  /** See MsgsDb.flush() - same contract, for the chats database file. */
  flush(): Promise<void>;
  findChat(chatIdObj: ChatIdObj): ChatDbEntry | undefined;
  addOneToOneChat(
    params: Omit<OTOChatDbEntry, 'createdAt' | 'lastUpdatedAt' | 'peerCAddr'>,
  ): Promise<OTOChatDbEntry>;
  addGroupChat(chat: Omit<GroupChatDbEntry, 'createdAt' | 'lastUpdatedAt'>): Promise<GroupChatDbEntry>;
  /**
   * Inserts the row verbatim - createdAt, lastUpdatedAt and settings included -
   * and returns undefined when the chat is already there. What a restore needs
   * and what add*Chat above cannot give: those overwrite exactly the fields an
   * archive is the only source of.
   */
  addOTOChatRecord(chat: OTOChatTableFields): Promise<OTOChatDbEntry | undefined>;
  addGroupChatRecord(chat: GroupChatTableFields): Promise<GroupChatDbEntry | undefined>;
  updateOTOChatRecord(peerCAddr: string, toUpdate: Partial<OTOChatDbEntry>): Promise<OTOChatDbEntry | undefined>;
  updateGroupChatRecord(
    chatId: string,
    toUpdate: Partial<GroupChatDbEntry>,
  ): Promise<GroupChatDbEntry | undefined>;
  getChatList(): ChatDbEntry[];
  /**
   * Chats this address takes part in - the one-to-one chat with it, and every
   * group chat it is a member of.
   *
   * Apart from getChatList() because that one asks the messages db for a last
   * message and an unread count of every chat, and a caller that only wants to
   * know where an address appears has no use for either.
   */
  getChatsWithParticipant(cAddr: string): ChatIdObj[];
  deleteChat(chatId: ChatIdObj): Promise<RefsToMsgsDataNoInDB | undefined>;
}
