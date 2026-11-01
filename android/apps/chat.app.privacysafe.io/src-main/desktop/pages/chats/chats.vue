<!--
 Copyright (C) 2025-2026 3NSoft Inc.

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
  import { onBeforeMount } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { useRouting } from '@main/desktop/composables/useRouting';
  import { useChatsView } from '@main/common/composables/useChatsView.ts';
  import type { ChatListItemView } from '~/chat.types';
  import ChatList from '@main/common/components/chat/chat-list.vue';

  const { t } = useI18n();
  const { goToChatRoute } = useRouting();
  const { openCreateChatDialog, doBeforeMount } = useChatsView();

  function goChat(chatListItem: ChatListItemView) {
    const { isGroupChat, chatId } = chatListItem;
    goToChatRoute({ isGroupChat, chatId });
  }

  onBeforeMount(doBeforeMount);
</script>

<template>
  <div :class="$style.chats">
    <div :class="$style.blockAside">
      <div :class="$style.blockAsideToolbar">
        <ui3n-button
          :class="$style.addBtn"
          @click="() => openCreateChatDialog()"
        >
          {{ t('app.text.new') }}
        </ui3n-button>
      </div>
      <chat-list
        :class="$style.chatList"
        @click="goChat"
      />
    </div>

    <div :class="$style.chatBody">
      <router-view v-slot="{ Component }">
        <component
          :is="Component"
          v-if="Component"
        />

        <div
          v-else
          :class="$style.chatBodyEmpty"
        >
          {{ t('chat.content.empty') }}
        </div>
      </router-view>
    </div>
  </div>
</template>

<style lang="scss" module>
  .chats {
    --chats-aside-width: calc(var(--column-size) * 4);
    --chats-toolbar-height: calc(var(--spacing-s) * 8);

    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: space-between;
    align-items: stretch;
  }

  .blockAside {
    position: relative;
    width: var(--chats-aside-width);
    border-right: 1px solid var(--color-border-block-primary-default);
  }

  .blockAsideToolbar {
    position: relative;
    width: 100%;
    height: var(--chats-toolbar-height);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    padding: 0 var(--spacing-m);
  }

  .addBtn {
    width: calc(var(--spacing-s) * 7);
    font-weight: 600;
    text-transform: capitalize;
    border-radius: var(--spacing-m) !important;
  }

  .chatList {
    position: relative;
    height: calc(100% - var(--chats-toolbar-height));
  }

  .chatBody {
    position: relative;
    width: calc(100% - var(--chats-aside-width));
    height: 100%;
  }

  .chatBodyEmpty {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: center;
    align-items: center;
    background-color: var(--color-bg-chat-bubble-general-bg);
    font-size: var(--font-14);
    font-weight: 400;
    color: var(--color-text-chat-bubble-other-default);
  }
</style>
