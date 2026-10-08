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
  import type { ChatListItemView } from '~/chat.types';
  import { useNavigation } from '@main/mobile/composables/useNavigation';
  import ChatList from '@main/common/components/chat/chat-list.vue';
  import { useChatsView } from '@main/common/composables/useChatsView.ts';

  const { openCreateChatDialog } = useChatsView();

  const { navigateToChat } = useNavigation();

  function goChat(chatListItem: ChatListItemView) {
    const { isGroupChat, chatId } = chatListItem;
    navigateToChat({
      params: {
        chatType: isGroupChat ? 'g' : 's',
        chatId,
      },
    });
  }
</script>

<template>
  <chat-list
    :is-mobile-mode="true"
    :open-create-chat-dialog="openCreateChatDialog"
    :class="$style.chats"
    @click="goChat"
  />
</template>

<style lang="scss" module>
  .chats {
    position: relative;
    width: 100%;
    height: 100%;
    background-color: var(--color-bg-block-primary-default);
    overflow-y: auto;
  }
</style>
