/*
Copyright (C) 2025 3NSoft Inc.

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
import { computed, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { defineStore } from 'pinia';
import keyBy from 'lodash/keyBy';
import cloneDeep from 'lodash/cloneDeep';
import has from 'lodash/has';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { chatService, fileLinkStoreSrv } from '@main/common/services/external-services';
import { useAppStore } from '@main/common/store/app.store';
import { useChatsStore } from '@main/common/store/chats.store';
import { useChatStore } from '@main/common/store/chat.store';
import { useUiOutgoingStore } from '@main/common/store/ui.outgoing.store';
import { areChatIdsEqual } from '@shared/chat-ids';
import { MAX_PAGES_PER_MSG_LOOKUP, MSGS_PAGE_SIZE } from '@shared/constants';
import type {
  ChatIdObj,
  ChatMessageAttachmentsInfo,
  ChatMessageEvent,
  ChatMessageId,
  ChatMessageSendingProgressEvent,
  ChatMessageView,
  ChatSummary,
  ReadonlyFile,
  ReadonlyFS,
  RegularMsgView,
} from '~/index';
import type { DbRecordException } from '@deno/utils/exceptions';
import { makeLogger } from '@shared/logger';

const log = makeLogger('MessagesStore');

const recentReactionsLimit = 5;

export const useMessagesStore = defineStore('messages', () => {
  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const appStore = useAppStore();
  const chatsStore = useChatsStore();
  const chatStore = useChatStore();
  const uiOutgoingStore = useUiOutgoingStore();

  const objOfCurrentChatMessages = ref<Record<string, ChatMessageView>>({});

  const selectedMessages = ref<string[]>([]);
  const recentReactions = ref<string[]>([]);

  /** Whether the chat has history older than what is loaded */
  const hasMoreOlder = ref(false);
  /** Guards against a stream of scroll events starting several loads at once */
  const isFetchingOlder = ref(false);

  const currentChatMessages = computed(() =>
    Object.values(objOfCurrentChatMessages.value).sort((a, b) => a.timestamp - b.timestamp),
  );

  function setCurrentChatMessages(messages: ChatMessageView[] = []) {
    objOfCurrentChatMessages.value = keyBy(messages, 'chatMessageId');
    // Belongs to the set being replaced, so it must not leak into another chat
    hasMoreOlder.value = false;
  }

  /**
   * Loads the newest page of the chat's history.
   * When there are more unread messages than fit a page, the first load takes
   * them all plus a margin: scrollToFirstUnreadMessage() looks the message up in
   * the DOM, so the first unread one has to be among the loaded.
   */
  async function fetchMessages(): Promise<void> {
    if (!chatStore.currentChatId) {
      setCurrentChatMessages([]);
      return;
    }

    const unread = chatsStore.getChatView(chatStore.currentChatId)?.unread ?? 0;
    const limit = unread > MSGS_PAGE_SIZE ? unread + 50 : MSGS_PAGE_SIZE;
    const { msgs, hasMoreOlder: more } = await chatService.getMessagesPageByChat(chatStore.currentChatId, { limit });

    setCurrentChatMessages(msgs);
    hasMoreOlder.value = more;
  }

  /**
   * Adds the page preceding the oldest loaded message.
   */
  async function fetchOlderMessages(): Promise<void> {
    const chatId = chatStore.currentChatId;
    const oldest = currentChatMessages.value[0];
    if (!chatId || !oldest || !hasMoreOlder.value || isFetchingOlder.value) {
      return;
    }

    isFetchingOlder.value = true;
    try {
      const { msgs, hasMoreOlder: more } = await chatService.getMessagesPageByChat(chatId, {
        limit: MSGS_PAGE_SIZE,
        before: {
          timestamp: oldest.timestamp,
          chatMessageId: oldest.chatMessageId,
        },
      });

      for (const msg of msgs) {
        upsertMessageInCurrentChat(msg.chatMessageId, msg);
      }
      hasMoreOlder.value = more;
    } finally {
      isFetchingOlder.value = false;
    }
  }

  /**
   * Pulls older pages until the message is among the loaded ones, so that a jump
   * to a quoted message works when the original is older than the loaded window.
   */
  async function loadOlderUntilMessageIsLoaded(chatMessageId: string): Promise<boolean> {
    for (let page = 0; page < MAX_PAGES_PER_MSG_LOOKUP; page += 1) {
      if (objOfCurrentChatMessages.value[chatMessageId]) {
        return true;
      }
      if (!hasMoreOlder.value) {
        return false;
      }
      await fetchOlderMessages();
    }

    return !!objOfCurrentChatMessages.value[chatMessageId];
  }

  function getMessageInCurrentChat(chatMsgId: string): ChatMessageView | undefined {
    if (!chatMsgId) {
      return;
    }
    return objOfCurrentChatMessages.value[chatMsgId];
  }

  function selectMessage(chatMessageId: string) {
    const msgIndex = selectedMessages.value.indexOf(chatMessageId);
    if (msgIndex === -1) {
      selectedMessages.value.push(chatMessageId);
    } else {
      selectedMessages.value.splice(msgIndex, 1);
    }
  }

  function clearSelectedMessages(): void {
    selectedMessages.value = [];
  }

  async function cancelSendingMessage({
    deliveryId,
    chatMsgId,
  }: {
    deliveryId: string;
    chatMsgId: ChatMessageId;
  }): Promise<void> {
    return await chatService.cancelSendingMessage(deliveryId, chatMsgId);
  }

  function upsertMessageInCurrentChat(chatMsgId: string, data: Partial<ChatMessageView>) {
    const msg = getMessageInCurrentChat(chatMsgId);
    if (!msg) {
      objOfCurrentChatMessages.value[chatMsgId] = data as ChatMessageView;
      return;
    }

    // @ts-expect-error
    objOfCurrentChatMessages.value[chatMsgId] = {
      ...msg,
      ...data,
    };
  }

  async function deleteMessageInChat(chatMsgId: string, deleteForEveryone?: boolean): Promise<void> {
    const message = getMessageInCurrentChat(chatMsgId);
    if (!message) {
      return;
    }

    try {
      const { chatId, chatMessageId } = message;
      await chatService.deleteMessage({ chatId, chatMessageId }, !!deleteForEveryone);
      await chatsStore.refreshChatViewData(chatId);
    } catch (err) {
      if ((err as DbRecordException).chatNotFound) {
        await chatsStore.refreshChatList();
      } else {
        await fetchMessages();
      }
    }
  }

  /**
   * Deletes the given messages of the current chat.
   *
   * The backend deletes each message on its own, so a batch can come back
   * partly deleted. What failed stays in the database and must stay on screen -
   * hence the refresh of the list from the backend and a notice, instead of
   * assuming everything asked for is gone.
   */
  async function deleteMessagesInChat(chatMsgsIds: string[], deleteForEveryone?: boolean): Promise<void> {
    let chatId: ChatIdObj | null = null;

    for (const chatMsgId of chatMsgsIds) {
      const message = getMessageInCurrentChat(chatMsgId);
      if (!message) {
        log.error(`You are trying to delete a message (${chatMsgId}) that is not in the current chat.`);
        throw Error('Unable to delete a message');
      }
      if (!chatId) {
        chatId = message.chatId;
      }

      if (!areChatIdsEqual(chatId, message.chatId)) {
        log.error('You are trying to delete messages from different chats.');
        throw Error('Unable to delete a message');
      }
    }

    if (!chatId) {
      throw Error('Unable to delete a message');
    }

    try {
      const msgsToDelete = chatMsgsIds.map(id => ({
        chatId,
        chatMessageId: id,
      }));
      const { failed } = await chatService.deleteMessages(msgsToDelete, !!deleteForEveryone);
      if (failed.length > 0) {
        log.error(`${failed.length} of ${msgsToDelete.length} message(s) were not deleted.`);
        $createNotice({
          type: 'error',
          content: t('chat.message.action_message.error.delete'),
        });
      }
      await chatsStore.refreshChatViewData(chatId);
    } catch (err) {
      if ((err as DbRecordException).chatNotFound) {
        await chatsStore.refreshChatList();
      } else {
        await fetchMessages();
      }
    }
  }

  async function deleteAllMessagesInChat(chatId: ChatIdObj, deleteForEveryone?: boolean): Promise<void> {
    chatStore.ensureCurrentChatIsSet(chatId);
    await chatService.deleteMessagesInChat(chatId, !!deleteForEveryone);
    await fetchMessages();
  }

  async function markMessageAsRead(chatId: ChatIdObj, chatMessageId: string): Promise<void> {
    await chatService.markMessageAsReadNotifyingSender({
      chatId,
      chatMessageId,
    });
  }

  async function getChatMessage(id: ChatMessageId): Promise<ChatMessageView | undefined> {
    return await chatService.getMessage(id);
  }

  async function getMessageAttachments(
    info: ChatMessageAttachmentsInfo[],
    incomingMsgId?: string,
  ): Promise<Record<string, ReadonlyFile | ReadonlyFS>> {
    const entities: Record<string, ReadonlyFile | ReadonlyFS> = {};
    if (incomingMsgId) {
      const msg = await chatService.getIncomingMessage(incomingMsgId);

      if (msg && msg.attachments) {
        for (const { name, isFolder } of info) {
          entities[name] = isFolder
            ? await msg.attachments.readonlySubRoot(name)
            : await msg.attachments.readonlyFile(name);
        }
      }
    } else {
      for (const { id, name } of info) {
        if (id) {
          const entity = await fileLinkStoreSrv.getFile(id);
          if (entity) {
            entities[name] = entity;
          }
        }
      }
    }
    return entities;
  }

  async function changeMessageReaction({
    msg,
    reaction,
  }: {
    msg: ChatMessageView;
    reaction: Nullable<{ id: string; value: string }>;
  }): Promise<void> {
    const msgReactions = cloneDeep((msg as RegularMsgView).reactions || {});
    const isThereReactionFromUser = has(msgReactions, appStore.user);
    if (isThereReactionFromUser && reaction === null) {
      delete msgReactions[appStore.user];
    } else {
      reaction &&
        (msgReactions[appStore.user] = {
          type: 'emoji',
          name: reaction.id,
        });
    }

    const updatedMsg = await chatService.changeMessageReaction({
      chatId: msg.chatId,
      chatMessageId: msg.chatMessageId,
      updatedReactions: msgReactions,
    });

    if (updatedMsg) {
      upsertMessageInCurrentChat(updatedMsg.chatMessageId, updatedMsg);
    }
  }

  /**
   * Updates unread/lastMsg of the chat list item.
   * Events from the backend carry these aggregates, so nothing has to be asked
   * back over IPC. The fallback is for the callers that invoke the handlers
   * below directly, outside of the event stream, and thus have no aggregates at
   * hand.
   */
  async function updateChatAggregates(chatId: ChatIdObj, chatSummary?: ChatSummary): Promise<void> {
    if (chatSummary) {
      chatsStore.applyChatSummary(chatSummary);
    } else {
      await chatsStore.refreshChatViewData(chatId);
    }
  }

  async function handleAddedMsg(msg: ChatMessageView, chatSummary?: ChatSummary): Promise<void> {
    if (areChatIdsEqual(chatStore.currentChatId, msg.chatId)) {
      if (!objOfCurrentChatMessages.value[msg.chatMessageId]) {
        upsertMessageInCurrentChat(msg.chatMessageId, msg);
        chatStore.$emitter.emit('message:added', { chatId: msg.chatId });
      }
    }
    await updateChatAggregates(msg.chatId, chatSummary);
  }

  async function handleUpdatedMsg(msg: ChatMessageView, chatSummary?: ChatSummary): Promise<void> {
    if (areChatIdsEqual(chatStore.currentChatId, msg.chatId)) {
      upsertMessageInCurrentChat(msg.chatMessageId, msg);
    }
    await updateChatAggregates(msg.chatId, chatSummary);
  }

  async function handleRemovedMsg(msg: ChatMessageId, chatSummary?: ChatSummary): Promise<void> {
    if (areChatIdsEqual(chatStore.currentChatId, msg.chatId)) {
      delete objOfCurrentChatMessages.value[msg.chatMessageId];
    }
    await updateChatAggregates(msg.chatId, chatSummary);
  }

  async function handleRemovedMsgs(chatMsgIds: ChatMessageId[] = [], chatSummary?: ChatSummary): Promise<void> {
    if (chatMsgIds.length === 0) {
      return;
    }

    const { chatId } = chatMsgIds[0];
    if (areChatIdsEqual(chatStore.currentChatId, chatId)) {
      for (const id of chatMsgIds) {
        delete objOfCurrentChatMessages.value[id.chatMessageId];
      }
    }
    await updateChatAggregates(chatId, chatSummary);
  }

  /**
   * The whole history of the chat is gone, which the GUI learns about not only
   * when clearing it itself, but also when another of the user's devices or a
   * peer did it.
   */
  function handleAllMsgsRemoved(chatId: ChatIdObj): void {
    if (areChatIdsEqual(chatStore.currentChatId, chatId)) {
      setCurrentChatMessages([]);
      // Selection pointed at messages that no longer exist
      clearSelectedMessages();
    }
  }

  async function handleBackgroundMessageEvents(event: ChatMessageEvent) {
    switch (event.event) {
      case 'added':
        return handleAddedMsg(event.msg, event.chatSummary);
      case 'updated':
        return handleUpdatedMsg(event.msg, event.chatSummary);
      case 'removed':
        return handleRemovedMsg(event.msgId, event.chatSummary);
      case 'removed-multiple':
        return handleRemovedMsgs(event.chatMsgIds, event.chatSummary);
      case 'sending-progress':
        uiOutgoingStore.updateSendingProgressesList(event as ChatMessageSendingProgressEvent);
        break;
      default:
        log.error('Unknown update event from ChatService. ', event);
        break;
    }
  }

  async function fetchRecentReactions() {
    recentReactions.value = await chatService.getRecentReactions(5);
  }

  function addReactionInRecentList(reactionId: string) {
    const isReactionInRecentList = recentReactions.value.includes(reactionId);
    if (isReactionInRecentList) {
      return;
    }

    if (recentReactions.value.length === recentReactionsLimit) {
      recentReactions.value.shift();
    }
    recentReactions.value.push(reactionId);
  }

  return {
    objOfCurrentChatMessages,
    currentChatMessages,
    selectedMessages,
    recentReactions,
    hasMoreOlder,
    isFetchingOlder,
    fetchMessages,
    fetchOlderMessages,
    loadOlderUntilMessageIsLoaded,
    cancelSendingMessage,
    setCurrentChatMessages,
    upsertMessageInCurrentChat,
    getMessageInCurrentChat,
    deleteMessageInChat,
    deleteMessagesInChat,
    deleteAllMessagesInChat,
    markMessageAsRead,
    getChatMessage,
    getMessageAttachments,
    changeMessageReaction,
    selectMessage,
    clearSelectedMessages,
    handleBackgroundMessageEvents,
    handleAddedMsg,
    handleUpdatedMsg,
    handleRemovedMsg,
    handleAllMsgsRemoved,
    fetchRecentReactions,
    addReactionInRecentList,
  };
});
