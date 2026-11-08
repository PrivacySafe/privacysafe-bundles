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
import { computed, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import size from 'lodash/size';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { GroupChatView } from '~/index';
import { useAppStore } from '@main/common/store/app.store';
import { useChatStore } from '@main/common/store/chat.store';
import { toCanonicalAddress } from '@shared/address-utils';

/**
 * What the mention zone shares with the composer: the text it rewrites when a
 * member is picked, and the input element whose caret it reads.
 */
export interface ChatViewMentionsDeps {
  msgText: Ref<string>;
  inputEl: Ref<Nullable<HTMLTextAreaElement>>;
}

/**
 * The "@" member suggestions of a group chat: who is offered, which one the
 * arrow keys have selected, and the rewriting of the word at the caret into a
 * mention when one is chosen.
 */
export function useChatViewMentions({ msgText, inputEl }: ChatViewMentionsDeps) {
  const { user } = storeToRefs(useAppStore());
  const { currentChat } = storeToRefs(useChatStore());

  const mention = ref<{ startIndex: number; member: Nullable<string> }>({
    startIndex: -1,
    member: null,
  });
  const activeSuggestionIndex = ref(-1);
  const filteredMembers = computed(() =>
    currentChat.value && (currentChat.value as GroupChatView).members
      ? Object.keys((currentChat.value as GroupChatView).members).filter(addr => {
          if (mention.value.member === null) {
            return false;
          }

          const mail = toCanonicalAddress(addr.toLowerCase());
          return mail !== user.value && mail.includes(mention.value.member.toLowerCase());
        })
      : [],
  );

  watch(
    () => size(filteredMembers.value),
    val => {
      setTimeout(() => {
        if (val > 0) {
          activeSuggestionIndex.value = -1;
        }
      }, 100);
    },
    {
      immediate: true,
    },
  );

  function hideSuggestions() {
    mention.value = {
      startIndex: -1,
      member: null,
    };
    activeSuggestionIndex.value = -1;
  }

  function recognizeMention(text: string) {
    const cursorPosition = inputEl.value!.selectionStart;
    const lastAtSymbolIndex = text.lastIndexOf('@', cursorPosition - 1);
    if (lastAtSymbolIndex !== -1 && (lastAtSymbolIndex === 0 || /\s/.test(text[lastAtSymbolIndex - 1]))) {
      mention.value.startIndex = lastAtSymbolIndex + 1;
      mention.value.member = text.substring(lastAtSymbolIndex + 1, cursorPosition);
    }
  }

  function onInput(text: string) {
    if (currentChat.value?.isGroupChat) {
      recognizeMention(text);
    }
  }

  function getCharFromTheLeft(event: KeyboardEvent) {
    const target = event.target as HTMLTextAreaElement;
    const cursorPosition = target.selectionStart;
    if (cursorPosition !== null && cursorPosition > 0) {
      const text = target.value;
      return text[cursorPosition - 1];
    }

    return '';
  }

  function onKeydown(event: KeyboardEvent) {
    const { key } = event;
    switch (key) {
      case 'ArrowUp': {
        const char = getCharFromTheLeft(event);
        if (char !== '@') {
          return;
        }

        event.preventDefault();
        const possibleSuggestionIndex = activeSuggestionIndex.value - 1;
        activeSuggestionIndex.value =
          possibleSuggestionIndex === -1 ? size(filteredMembers.value) - 1 : possibleSuggestionIndex;
        break;
      }
      case 'ArrowDown': {
        const char = getCharFromTheLeft(event);
        if (char !== '@') {
          return;
        }

        event.preventDefault();
        const possibleSuggestionIndex = activeSuggestionIndex.value + 1;
        activeSuggestionIndex.value =
          possibleSuggestionIndex === size(filteredMembers.value) ? 0 : possibleSuggestionIndex;
        break;
      }
      default:
    }
  }

  function selectMention(index: number) {
    const member = filteredMembers.value[index];
    const parsedMember = member.split('@');
    const currentMention = `${parsedMember[0]}[${parsedMember[1]}]`;
    const newMsgText =
      msgText.value.slice(0, mention.value.startIndex) +
      currentMention +
      msgText.value.slice(mention.value.startIndex + 1) +
      ' ';
    msgText.value = newMsgText;

    activeSuggestionIndex.value = -1;
    mention.value = {
      startIndex: -1,
      member: null,
    };
    inputEl.value?.focus();
  }

  return {
    mention,
    activeSuggestionIndex,
    filteredMembers,
    hideSuggestions,
    onInput,
    onKeydown,
    selectMention,
  };
}

export type ChatViewMentions = ReturnType<typeof useChatViewMentions>;
