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
import { nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { useAppStore } from '@main/common/store/app.store';
import { useChatStore } from '@main/common/store/chat.store';
import { useMessagesStore } from '@main/common/store/messages.store';

/**
 * How close to an edge of the message list counts as being at it: for the bottom
 * it decides whether the "scroll down" button is shown, for the top it triggers
 * loading of the previous page.
 */
const LIST_EDGE_THRESHOLD_PX = 64;

/**
 * The message list element and everything the view does with its scroll
 * position: the "scroll down" button, loading the previous page at the top
 * without moving what is on screen, and the jump to the first unread message.
 */
export function useChatViewMessagesList() {
  const { appWindowSize } = storeToRefs(useAppStore());
  const { currentChat } = storeToRefs(useChatStore());
  const { currentChatMessages, hasMoreOlder, isFetchingOlder } = storeToRefs(useMessagesStore());
  const { fetchOlderMessages } = useMessagesStore();

  const messageListElement = ref<Nullable<HTMLDivElement>>(null);
  const messageListElementRect = ref<DOMRect | undefined>(undefined);
  const whetherShowButtonDown = ref(false);

  function setMessageListElementRect(el: Nullable<HTMLDivElement>) {
    messageListElementRect.value = el ? el.getBoundingClientRect() : undefined;
  }

  /**
   * The list element is replaced whenever chat-messages is remounted, so the
   * listener comes off the old one before it goes onto the new: without that,
   * every remount left one more subscription on a detached element, all of them
   * still firing into this composable.
   */
  function onMessageListElementInit(value: Nullable<HTMLDivElement>) {
    messageListElement.value?.removeEventListener('scroll', onMessageListScroll);
    messageListElement.value = value;
    setMessageListElementRect(value);
    value?.addEventListener('scroll', onMessageListScroll);
  }

  /**
   * Read into locals and give up when there is no list yet.
   *
   * Not only a scroll handler: the watcher on window height below calls this
   * too, and that watcher runs from the moment the chat route is rendered -
   * while chat-messages waits behind `v-if` for its messages to arrive. The
   * first resize callback of a window opened on a chat route therefore lands on
   * an empty ref, and on 2026-09-11 that was the TypeError in the console of a
   * window whose background component had stopped answering, so the list was
   * never going to arrive at all.
   */
  function onMessageListScroll() {
    const el = messageListElement.value;
    const rect = messageListElementRect.value;
    if (!el || !rect) {
      return;
    }

    whetherShowButtonDown.value = el.scrollHeight - LIST_EDGE_THRESHOLD_PX > rect.height + el.scrollTop;

    if (el.scrollTop <= LIST_EDGE_THRESHOLD_PX) {
      void loadOlderMessagesKeepingPosition();
    }
  }

  /**
   * Adds the previous page at the top of the list without moving what the user
   * is looking at: prepending pushes the content down by exactly the height it
   * adds, so the same amount goes back into the scroll position.
   */
  async function loadOlderMessagesKeepingPosition(): Promise<void> {
    const el = messageListElement.value;
    if (!el || !hasMoreOlder.value || isFetchingOlder.value) {
      return;
    }

    const heightBefore = el.scrollHeight;
    await fetchOlderMessages();
    await nextTick();
    el.scrollTop += el.scrollHeight - heightBefore;
  }

  function scrollMessageListToEnd() {
    messageListElement.value && (messageListElement.value.scrollTop = 1e12);
  }

  function scrollToFirstUnreadMessage() {
    const unread = currentChat.value?.unread || 0;
    if (unread === 0) {
      messageListElement.value && (messageListElement.value.scrollTop = 1e12);
      return;
    }

    const incomingMessages = currentChatMessages.value
      .filter(msg => msg.isIncomingMsg && msg.chatMessageType === 'regular')
      .sort((aMsg, bMsg) => bMsg.timestamp - aMsg.timestamp);

    const unreadMessages = incomingMessages.slice(0, unread);
    const firstUnreadMessage = unreadMessages[unread - 1];
    if (!firstUnreadMessage) {
      return;
    }

    const firstUnreadMessageEl = document.getElementById(`msg-${firstUnreadMessage.chatMessageId}`);
    if (!firstUnreadMessageEl) {
      return;
    }

    nextTick(() => {
      firstUnreadMessageEl.scrollIntoView(false);
    });
  }

  watch(
    () => appWindowSize.value.height,
    (val, oldVal) => {
      if (val && val !== oldVal) {
        setMessageListElementRect(messageListElement.value);
        onMessageListScroll();
      }
    },
  );

  return {
    messageListElement,
    whetherShowButtonDown,
    onMessageListElementInit,
    onMessageListScroll,
    scrollMessageListToEnd,
    scrollToFirstUnreadMessage,
  };
}

export type ChatViewMessagesList = ReturnType<typeof useChatViewMessagesList>;
