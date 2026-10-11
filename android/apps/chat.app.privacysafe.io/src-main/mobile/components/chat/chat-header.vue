<!--
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
-->
<script lang="ts" setup>
  import { computed } from 'vue';
  import { Ui3nButton, Ui3nIcon, Ui3nHtml as vUi3nHtml } from '@v1nt1248/3nclient-lib';
  import { type ChatBlockingState, blockingIconFor, getChatName } from '@main/common/utils/chat-ui.helper';
  import { useChatHeader } from '@main/common/composables/useChatHeader';
  import { useNavigation } from '@main/mobile/composables/useNavigation';
  import type { ChatListItemView, ChatMessageView } from '~/chat.types';
  import ChatAvatar from '@main/common/components/chat/chat-avatar.vue';
  import ChatHeaderActions from './chat-header-actions.vue';

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

  const chatVal = computed(() => props.chat);
  const chatMessagesVal = computed(() => props.messages);
  const blockingIcon = computed(() => blockingIconFor(props.blockingState));

  const { navigateToChats } = useNavigation();

  const {
    t,
    text,
    isGroupChat,
    currentChatObjId,
    isIncomingCall,
    chatWithCall,
    isCallActive,
    callDuration,
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
    goToChats,
    isMobileMode: true,
  });

  async function goToChats() {
    await navigateToChats();
  }
</script>

<template>
  <div :class="$style.chatHeader">
    <ui3n-button
      type="icon"
      color="var(--color-bg-block-primary-default)"
      icon="round-arrow-back"
      icon-size="20"
      icon-color="var(--color-icon-block-primary-default)"
      @click.stop.prevent="goToChats"
    />

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

    <div :class="$style.content">
      <div :class="$style.headerName">
        {{ getChatName(props.chat) }}
      </div>

      <div
        v-if="chatWithCall"
        :class="$style.headerInfo"
      >
        {{ t('chat.header.call.duration') }}: {{ callDuration }}
      </div>

      <div
        v-else
        v-ui3n-html:sanitize="chat.lastMsg?.timestamp ? t('chat.header.info', { date: text }) : ''"
        :class="$style.headerInfo"
      />
    </div>

    <ui3n-button
      v-if="chatWithCall"
      type="icon"
      color="var(--error-content-default)"
      text-color="var(--white-100)"
      icon="round-phone-disabled"
      icon-color="var(--error-fill-default)"
      @click.stop.prevent="() => endCall(currentChatObjId)"
    />

    <template v-else-if="isIncomingCall">
      <ui3n-button
        type="icon"
        color="var(--success-content-default)"
        icon="round-phone"
        icon-color="var(--success-fill-default)"
        @click.stop.prevent="() => joinIncomingCall(currentChatObjId, chat.incomingCall!.peerAddress)"
      />

      <ui3n-button
        type="icon"
        color="var(--warning-content-default)"
        icon="round-call-end"
        icon-color="var(--warning-fill-default)"
        @click.stop.prevent="() => dismissIncomingCall(currentChatObjId, false)"
      />
    </template>

    <ui3n-button
      v-else-if="isCallActive"
      type="icon"
      color="var(--success-content-default)"
      icon="round-phone"
      icon-color="var(--success-fill-default)"
      :class="$style.rejoinBtn"
      @click.stop.prevent="() => rejoinCall(currentChatObjId)"
    />

    <ui3n-button
      v-else
      type="icon"
      color="var(--color-bg-block-primary-default)"
      icon="round-phone"
      icon-color="var(--color-icon-block-primary-default)"
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

<style lang="scss" module>
  @use '@main/common/assets/styles/_mixins.scss' as mixins;

  .chatHeader {
    --chat-header-height: 64px;

    display: flex;
    width: 100%;
    height: var(--chat-header-height);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-xs);
    padding: 0 12px;
    background-color: var(--color-bg-block-primary-default);
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

  .content {
    position: relative;
    flex-grow: 1;
    flex-shrink: 1;
  }

  .headerName,
  .headerInfo {
    position: relative;
    @include mixins.text-overflow-ellipsis();
  }

  .headerName {
    font-size: var(--font-16);
    font-weight: 600;
    line-height: 22px;
    color: var(--color-text-block-primary-default);
  }

  .headerInfo {
    min-height: 14px;
    font-size: var(--font-12);
    font-weight: 400;
    line-height: 14px;
    color: var(--color-text-block-secondary-default);
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
