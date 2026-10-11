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
import {
  ChatIdObj,
  ChatIncomingMessage,
  ChatMessageId,
  ChatOutgoingMessage,
  WebRTCMsgBodySysMsgData,
} from '../../../types/asmail-msgs.types.ts';
import type { ChatListItemView } from '../../../types/chat.types.ts';
import type { ChatSummary, UpdateEvent } from '../../../types/services.types.ts';
import type { ChatSrvEmit, DB, GroupChatDbEntry, MsgDbEntry, OTOChatDbEntry } from '../../types/index.ts';
import { ObserversSet } from '../../../shared-libs/observer-utils.ts';
import { chatIdOfChat, chatIdOfMsg, chatViewFromChatDbEntry } from './utils/_chats-related-methods.ts';
import { msgDbEntryToChatMessageView, msgViewFromDbEntry } from './utils/_msgs-related-methods.ts';

export interface ChatEventsBundle {
  /** The emit object passed to sub-modules */
  emit: ChatSrvEmit;
  /** Observable subscription for update events */
  watch: (obs: web3n.Observer<UpdateEvent>) => () => void;
  /** Direct access to the observers set, if needed */
  observers: ObserversSet<UpdateEvent>;
  /**
   * Opens a window in which per-record events are swallowed. Nestable: a
   * counter, not a flag, because a restore of a snapshot chunk can be reached
   * while a restore of an archive is already open.
   */
  beginBulkReplay: () => void;
  /** Closes it, and announces the whole change as one 'bulk'/'reload'. */
  endBulkReplay: () => void;
}

/**
 * Creates the chat events infrastructure: an ObserversSet, an emit facade
 * for sub-modules to fire events, and a watch function for consumers.
 */
export function createChatEvents(ownAddr: string, data: DB): ChatEventsBundle {
  const observers = new ObserversSet<UpdateEvent>();

  /**
   * Depth of the bulk-replay window. A counter rather than a flag: a restore
   * opens one, and a snapshot chunk received while it is open opens another.
   */
  let bulkDepth = 0;

  function beginBulkReplay(): void {
    bulkDepth += 1;
  }

  function endBulkReplay(): void {
    bulkDepth = Math.max(0, bulkDepth - 1);
    if (bulkDepth === 0) {
      emitChatEvent(() => ({ updatedEntityType: 'bulk', event: 'reload' }), false);
    }
  }

  /**
   * Events are built lazily, inside the emptiness check: with no GUI attached
   * there is nobody to receive them, and assembling a message view (let alone
   * querying chat aggregates for it) would be work done for nothing.
   *
   * `coalescable` says whether a bulk replay may swallow this event. Everything
   * about one record is coalescable; progress of a backup or a restore, and the
   * synchronization indicator, are NOT - the window a restore opens must not
   * swallow the restore's own progress, which is the whole of what the user can
   * see while it runs.
   */
  function emitChatEvent(makeEvent: () => UpdateEvent, coalescable = true): void {
    if (coalescable && (bulkDepth > 0)) {
      return;
    }
    if (!observers.isEmpty()) {
      observers.next(makeEvent());
    }
    // TODO this may turn into other notifications form later
    // if (event.updatedEntityType === 'message' && event.event === 'added') {
    //   const { chatId, sender } = event.msg;
    //   triggerMainUIOpening(chatId, sender);
    // }
  }

  /**
   * Aggregates that the GUI needs for the chat list item, shipped with every
   * event that invalidates them, so that the GUI doesn't have to ask for them
   * back with a getChat() request on each and every message.
   * lastMsg is deliberately built by the same converter that fills it in
   * findChat(), and not from the event's own message view: the latter is a
   * fuller object (reactions, history, own address as sender) and swapping one
   * for the other would change what the chat list shows.
   */
  function chatSummaryOf(chatId: ChatIdObj): ChatSummary {
    const lastMsg = data.getLatestMsgInChat(chatId);
    return {
      chatId,
      unread: data.getUnreadMsgsCountIn(chatId),
      lastMsg: lastMsg ? msgDbEntryToChatMessageView(lastMsg) : null,
    };
  }

  /**
   * Chat records come out of the tables without aggregates: getGroupChat() and
   * getOTOChat() read a plain row, and only findChat() fills lastMsg/unread. So
   * they are added here, or else every chat event would be telling the GUI that
   * the chat has no unread messages and no last message at all.
   */
  function chatViewOf(chat: GroupChatDbEntry | OTOChatDbEntry): ChatListItemView {
    if ((chat.lastMsg !== undefined) && (chat.unread !== undefined)) {
      return chatViewFromChatDbEntry(chat);
    }
    const chatId = chatIdOfChat(chat);
    return chatViewFromChatDbEntry({
      ...chat,
      lastMsg: chat.lastMsg ?? data.getLatestMsgInChat(chatId),
      unread: chat.unread ?? data.getUnreadMsgsCountIn(chatId),
    });
  }

  const emit: ChatSrvEmit = {
    // Never coalesced: the progress of a backup or a restore, and the
    // synchronization indicator, come through here.
    common: (event: UpdateEvent) => {
      emitChatEvent(() => event, false);
    },

    chat: {
      added: (chat: GroupChatDbEntry | OTOChatDbEntry) =>
        emitChatEvent(() => ({
          updatedEntityType: 'chat',
          event: 'added',
          chat: chatViewOf(chat),
        })),

      removed: (chatId: ChatIdObj) =>
        emitChatEvent(() => ({
          updatedEntityType: 'chat',
          event: 'removed',
          chatId,
        })),

      updated: (chat: GroupChatDbEntry | OTOChatDbEntry | undefined) =>
        chat
          ? emitChatEvent(() => ({
              updatedEntityType: 'chat',
              event: 'updated',
              chat: chatViewOf(chat),
            }))
          : undefined,

      allMsgsRemoved: (chatId: ChatIdObj) =>
        emitChatEvent(() => ({
          updatedEntityType: 'chat',
          event: 'messages-removed',
          chatId,
          chatSummary: chatSummaryOf(chatId),
        })),

      webRTCCall: (msg: ChatIncomingMessage | ChatOutgoingMessage, value: WebRTCMsgBodySysMsgData['value']) =>
        emitChatEvent(() => ({
          updatedEntityType: 'chat',
          event: 'webRTCCall',
          value: {
            msg,
            data: value,
          },
        })),
    },

    message: {
      added: (msg: MsgDbEntry) =>
        emitChatEvent(() => ({
          updatedEntityType: 'message',
          event: 'added',
          msg: msgViewFromDbEntry(msg, msg.relatedMessage ?? undefined, ownAddr),
          chatSummary: chatSummaryOf(chatIdOfMsg(msg)),
        })),

      removed: (msgId: ChatMessageId) =>
        emitChatEvent(() => ({
          updatedEntityType: 'message',
          event: 'removed',
          msgId,
          chatSummary: chatSummaryOf(msgId.chatId),
        })),

      removedMultiple: (chatMsgIds: ChatMessageId[]) =>
        emitChatEvent(() => ({
          updatedEntityType: 'message',
          event: 'removed-multiple',
          chatMsgIds,
          // Deletions are always emitted within a single chat, hence one summary
          chatSummary: (chatMsgIds.length > 0) ? chatSummaryOf(chatMsgIds[0].chatId) : undefined,
        })),

      updated: (msg: MsgDbEntry | undefined) =>
        msg
          ? emitChatEvent(() => ({
              updatedEntityType: 'message',
              event: 'updated',
              msg: msgViewFromDbEntry(msg, msg.relatedMessage ?? undefined, ownAddr),
              chatSummary: chatSummaryOf(chatIdOfMsg(msg)),
            }))
          : undefined,
    },
  };

  function watch(obs: web3n.Observer<UpdateEvent>): () => void {
    observers.add(obs);
    return () => observers.delete(obs);
  }

  return { emit, watch, observers, beginBulkReplay, endBulkReplay };
}