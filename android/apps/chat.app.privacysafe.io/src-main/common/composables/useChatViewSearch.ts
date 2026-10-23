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
import { nextTick, provide, ref } from 'vue';
import type { ChatMessageId } from '~/index';
import { useMessagesStore } from '@main/common/store/messages.store';
import {
  MESSAGE_SEARCH_HIGHLIGHT_KEY,
  type MessageSearchHighlight,
} from '@main/common/composables/useMessageSearchHighlight';

/**
 * The state of message search in the open chat: the results, the query they
 * were found for, and which of them is currently navigated to. Shared down to
 * the bubbles by injection, so that the found message is marked inside the list.
 */
export function useChatViewSearch() {
  const { loadOlderUntilMessageIsLoaded } = useMessagesStore();

  const foundMessages = ref<ChatMessageId[] | undefined>(undefined);

  /**
   * chatMessageId of the found message currently navigated to, so that it is
   * highlighted in the list. Cleared when the search changes or the chat does.
   */
  const highlightedMessageId = ref<string | undefined>(undefined);
  const searchQuery = ref('');

  provide(MESSAGE_SEARCH_HIGHLIGHT_KEY, {
    highlightedMessageId,
    query: searchQuery,
  } satisfies MessageSearchHighlight);

  function setFoundMessages(value: ChatMessageId[] | undefined, query: string) {
    foundMessages.value = value;
    searchQuery.value = query.trim();
    highlightedMessageId.value = undefined;
  }

  /**
   * Brings the found message at the given (1-based) position into view and
   * marks it as highlighted.
   *
   * The result may be older than the loaded page of history, so older pages are
   * pulled in first - the way a jump to a quoted message does it; without that
   * there is no element to scroll to.
   */
  async function scrollToMessage(index: number) {
    const target = foundMessages.value?.[index - 1];
    if (!target) {
      return;
    }

    const loaded = await loadOlderUntilMessageIsLoaded(target.chatMessageId);
    if (!loaded) {
      return;
    }

    highlightedMessageId.value = target.chatMessageId;

    await nextTick();
    document
      .getElementById(`msg-${target.chatMessageId}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /**
   * Drops the results and the highlight of the chat being left: all three
   * belong to the chat they were made in. Used on a change of chat.
   */
  function resetSearch() {
    highlightedMessageId.value = undefined;
    foundMessages.value = undefined;
    searchQuery.value = '';
  }

  return {
    foundMessages,
    highlightedMessageId,
    searchQuery,
    setFoundMessages,
    scrollToMessage,
    resetSearch,
  };
}

export type ChatViewSearch = ReturnType<typeof useChatViewSearch>;
