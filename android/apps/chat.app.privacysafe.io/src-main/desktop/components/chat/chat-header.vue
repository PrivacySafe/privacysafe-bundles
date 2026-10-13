<!--
 Copyright (C) 2020 - 2025 3NSoft Inc.

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
-->

<script lang="ts" setup>
  import { computed } from 'vue';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nIcon, Ui3nInput, Ui3nHtml } from '@v1nt1248/3nclient-lib';
  import { useChatHeader, type ChatHeaderEmits } from '@main/common/composables/useChatHeader';
  import { useRouting } from '@main/desktop/composables/useRouting';
  import { type ChatBlockingState, blockingIconFor, getChatName } from '@main/common/utils/chat-ui.helper';
  import type { ChatMessageView, ChatListItemView } from '~/index';
  import ChatAvatar from '@main/common/components/chat/chat-avatar.vue';
  import ChatHeaderActions from './chat-header-actions.vue';

  const vUi3nHtml = Ui3nHtml;

  const props = withDefaults(
    defineProps<{
      chat: ChatListItemView;
      messages: ChatMessageView[];
      /** Who in this chat is blocked, and whether that is everyone but the user. */
      blockingState?: ChatBlockingState;
      readonly?: boolean;
    }>(),
    { blockingState: () => ({ blockedMembers: [], allOthersBlocked: false }) },
  );

  const emits = defineEmits<ChatHeaderEmits>();

  const chatVal = computed(() => props.chat);
  const chatMessagesVal = computed(() => props.messages);
  const blockingIcon = computed(() => blockingIconFor(props.blockingState));

  const { goToChatsRoute } = useRouting();

  const {
    t,
    searchMode,
    searchText,
    foundMessages,
    currentFoundMessageIndex,
    text,
    isGroupChat,
    currentChatObjId,
    isIncomingCall,
    chatWithCall,
    isCallActive,
    callDuration,
    setSearchMode,
    changeFoundMessageIndex,
    selectAction,
    joinIncomingCall,
    dismissIncomingCall,
    startCall,
    isStartingCall,
    endCall,
    rejoinCall,
  } = useChatHeader({
    chat: chatVal,
    messages: chatMessagesVal,
    // @ts-expect-error
    goToChats: () => goToChatsRoute(),
    isMobileMode: false,
    emits,
  });
</script>

<template>
  <div :class="$style.chatHeader">
    <transition-group>
      <div
        v-if="searchMode"
        :class="$style.searchBlock"
      >
        <ui3n-input
          v-model="searchText"
          autofocus
          :placeholder="t('app.text.search')"
          clearable
          hide-bottom-space
          :class="$style.searchTxt"
        >
          <template #prepend-icon>
            <ui3n-icon
              icon="round-search"
              color="var(--color-icon-control-secondary-default)"
            />
          </template>
        </ui3n-input>

        <div
          v-if="size(foundMessages) > 0"
          :class="$style.searchResult"
        >
          <ui3n-button
            type="icon"
            square
            icon="round-arrow-upward"
            @click.stop.prevent="changeFoundMessageIndex('-')"
          />

          <span> {{ currentFoundMessageIndex }} / {{ size(foundMessages) }} {{ t('chat.search.results') }} </span>

          <ui3n-button
            type="icon"
            square
            icon="round-arrow-downward"
            @click.stop.prevent="changeFoundMessageIndex('+')"
          />
        </div>

        <ui3n-button
          type="secondary"
          @click.stop.prevent="() => setSearchMode(false)"
        >
          {{ t('app.text.cancel') }}
        </ui3n-button>
      </div>

      <template v-else>
        <div :class="$style.block">
          <div :class="$style.chatHeaderAvatar">
            <chat-avatar
              :name="getChatName(props.chat)"
              :shape="isGroupChat ? 'decagon' : 'circle'"
              :call-in-progress="chatWithCall"
              :settings="chat.settings"
            />

            <ui3n-icon
              v-if="blockingIcon"
              :icon="blockingIcon"
              color="var(--warning-content-default)"
              :class="$style.banned"
            />
          </div>

          <div :class="$style.chatHeaderContent">
            <div :class="$style.chatHeaderName">
              {{ getChatName(props.chat) }}
            </div>

            <div
              v-if="chatWithCall"
              :class="$style.chatHeaderInfo"
            >
              {{ t('chat.header.call.duration') }}: {{ callDuration }}
            </div>

            <div
              v-else
              v-ui3n-html:sanitize="chat.lastMsg?.timestamp ? t('chat.header.info', { date: text }) : ''"
              :class="$style.chatHeaderInfo"
            />
          </div>
        </div>

        <div :class="$style.block">
          <ui3n-button
            type="custom"
            color="var(--color-bg-button-tritery-default)"
            icon="round-search"
            icon-color="var(--color-icon-button-tritery-default)"
            :class="$style.asIconBtn"
            :disabled="readonly"
            @click.stop.prevent="() => setSearchMode(true)"
          />

          <ui3n-button
            v-if="chatWithCall"
            type="custom"
            color="var(--error-content-default)"
            text-color="var(--white-100)"
            icon="round-phone-disabled"
            icon-color="var(--error-fill-default)"
            icon-position="left"
            @click.stop.prevent="() => endCall(currentChatObjId)"
          >
            {{ t('va.btn.end_call') }}
          </ui3n-button>

          <template v-else-if="isIncomingCall">
            <ui3n-button
              type="custom"
              size="small"
              color="var(--success-content-default)"
              text-color="var(--success-fill-default)"
              icon="round-phone"
              icon-color="var(--success-fill-default)"
              icon-position="left"
              @click.stop.prevent="() => joinIncomingCall(currentChatObjId, chat.incomingCall!.peerAddress)"
            >
              {{ t('va.presettings.btn.join') }}
            </ui3n-button>

            <ui3n-button
              type="custom"
              size="small"
              color="var(--warning-content-default)"
              text-color="var(--warning-fill-default)"
              icon="round-call-end"
              icon-color="var(--warning-fill-default)"
              icon-position="left"
              @click.stop.prevent="() => dismissIncomingCall(currentChatObjId, false)"
            >
              {{ t('va.presettings.btn.decline') }}
            </ui3n-button>
          </template>

          <ui3n-button
            v-else-if="isCallActive"
            type="custom"
            size="small"
            color="var(--success-content-default)"
            text-color="var(--success-fill-default)"
            icon="round-phone"
            icon-color="var(--success-fill-default)"
            icon-position="left"
            :class="$style.rejoinBtn"
            @click.stop.prevent="() => rejoinCall(currentChatObjId)"
          >
            {{ t('va.btn.rejoin_call') }}
          </ui3n-button>

          <ui3n-button
            v-else
            type="custom"
            color="var(--color-bg-button-tritery-default)"
            icon="round-phone"
            icon-color="var(--color-icon-button-tritery-default)"
            :class="$style.asIconBtn"
            :disabled="readonly || isStartingCall"
            @click.stop.prevent="startCall(currentChatObjId)"
          />

          <chat-header-actions
            :chat="chat"
            :chat-with-call="chatWithCall"
            :all-others-blocked="blockingState.allOthersBlocked"
            :disabled="isIncomingCall"
            @select:action="selectAction"
          />
        </div>
      </template>
    </transition-group>
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/_mixins.scss' as mixins;

  .chatHeader {
    position: relative;
    width: 100%;
    min-height: calc(var(--spacing-l) * 2);
    height: calc(var(--spacing-l) * 2);
    background-color: var(--color-bg-block-primary-default);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--spacing-m);
    column-gap: var(--spacing-s);
  }

  .block {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .searchBlock {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    width: 100%;
    height: 64px;
    background-color: var(--color-bg-block-primary-default);

    .searchTxt {
      --ui3n-input-border-radius: 18px;
      --ui3n-input-padding-x: 12px;

      flex-grow: 1;
    }

    .searchResult {
      --ui3n-button-bg-color: var(--color-bg-button-tritery-default);

      display: flex;
      justify-content: center;
      align-items: center;
      column-gap: var(--spacing-s);
      min-width: fit-content;
      font-size: var(--font-12);
      line-height: 1;
      color: var(--color-text-chat-bubble-other-default);

      span {
        display: inline-block;
        position: relative;
        width: fit-content;
        min-width: 72px;
        text-align: center;
      }
    }

    button {
      span {
        min-width: fit-content;
      }
    }
  }

  .chatHeaderAvatar {
    position: relative;
    width: fit-content;

    .banned {
      position: absolute;
      top: -4px;
      right: -2px;
      z-index: 1;
    }
  }

  .chatHeaderContent {
    position: relative;
    flex-grow: 1;
    flex-shrink: 1;
  }

  .chatHeaderName,
  .chatHeaderInfo {
    position: relative;
    @include mixins.text-overflow-ellipsis();
  }

  .chatHeaderName {
    font-size: var(--font-16);
    font-weight: 600;
    line-height: 22px;
    color: var(--color-text-block-primary-default);
  }

  .chatHeaderInfo {
    min-height: 14px;
    font-size: var(--font-12);
    font-weight: 400;
    line-height: 14px;
    color: var(--color-text-block-secondary-default);
  }

  .asIconBtn {
    padding: 0 var(--spacing-s) !important;
    column-gap: 0 !important;
  }

  .rejoinBtn {
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.7;
    }
  }
</style>
