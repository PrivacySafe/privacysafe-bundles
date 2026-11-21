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
import type { ChatIdObj, ChatMessageId } from '../../../types/asmail-msgs.types.ts';
import type { ChatListItemView, ChatMessageView, MsgPageCursor } from '../../../types/chat.types.ts';
import type { ChatDbEntry } from '../../types/index.ts';
import { makeDbRecordException } from '../../utils/exceptions.ts';
import { msgViewFromDbEntry } from './utils/_msgs-related-methods.ts';
import {
  chatViewForGroupChat,
  chatViewForOTOChat,
  chatViewFromChatDbEntry,
} from './utils/_chats-related-methods.ts';
import type { ChatSrvCtx } from './chat-srv-ctx.ts';

/** Reading of chats and messages, as views for the GUI. */
export function makeChatQueries(ctx: ChatSrvCtx) {
  const { data, ownAddr } = ctx;

  async function getChatList(): Promise<ChatListItemView[]> {
    return data.getChatList().map(chat => {
      if (chat.isGroupChat) {
        return chatViewForGroupChat(chat);
      } else {
        return chatViewForOTOChat(chat);
      }
    });
  }

  async function getChat(chatId: ChatIdObj): Promise<ChatListItemView | undefined> {
    const chat = data.findChat(chatId);
    return chat ? chatViewFromChatDbEntry(chat) : undefined;
  }

  function findChatEntry(chatId: ChatIdObj, throwIfMissing = false): ChatDbEntry | undefined {
    const chat = data.findChat(chatId);

    if (chat) {
      return chat;
    }

    if (throwIfMissing) {
      throw makeDbRecordException({ chatNotFound: true });
    }
  }

  async function getMessage(id: ChatMessageId): Promise<ChatMessageView | undefined> {
    const found = await data.getMessage(id);
    if (found) {
      return msgViewFromDbEntry(found, found.relatedMessage ?? undefined, ownAddr);
    }
  }

  async function getMessagesByChat(chatId: ChatIdObj): Promise<ChatMessageView[]> {
    const msgViews: ChatMessageView[] = [];

    for (const msg of await data.getMessagesByChat(chatId)) {
      msgViews.push(msgViewFromDbEntry(msg, msg.relatedMessage ?? undefined, ownAddr));
    }

    return msgViews;
  }

  async function getMessagesPageByChat(
    chatId: ChatIdObj,
    { limit, before }: { limit: number; before?: MsgPageCursor },
  ): Promise<{ msgs: ChatMessageView[]; hasMoreOlder: boolean }> {
    // One record over the asked-for page tells whether anything precedes it,
    // sparing a second COUNT(*) query
    const entries = data.getMessagesPageInChat(chatId, limit + 1, before);
    const hasMoreOlder = entries.length > limit;
    const page = hasMoreOlder ? entries.slice(entries.length - limit) : entries;
    const msgs: ChatMessageView[] = [];

    for (const msg of page) {
      msgs.push(msgViewFromDbEntry(msg, msg.relatedMessage ?? undefined, ownAddr));
    }

    return { msgs, hasMoreOlder };
  }

  /**
   * Ids of the chat's regular messages matching the search text in their body
   * or attachment names, case-insensitively. The database owns the matching
   * (see searchMessagesInChat in the data layer); this wraps the ids it returns
   * with the chat they belong to.
   */
  async function searchMessagesInChat(chatId: ChatIdObj, searchText: string): Promise<ChatMessageId[]> {
    return data.searchMessagesInChat(chatId, searchText)
      .map(chatMessageId => ({ chatId, chatMessageId }));
  }

  return {
    getChatList,
    getChat,
    findChatEntry,
    getMessage,
    getMessagesByChat,
    getMessagesPageByChat,
    searchMessagesInChat,
  };
}

export type ChatQueries = ReturnType<typeof makeChatQueries>;
