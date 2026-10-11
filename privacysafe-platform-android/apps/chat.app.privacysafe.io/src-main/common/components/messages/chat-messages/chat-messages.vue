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
  import dayjs from 'dayjs';
  import { type Nullable, Ui3nLongPress as vUi3nLongPress, Ui3nList } from '@v1nt1248/3nclient-lib';
  import useChatMessages from './useChatMessages';
  import type { ChatListItemView, ChatMessageView, RegularMsgView } from '~/index';
  import ChatMessage from '../chat-message/chat-message.vue';
  import ChatMessageActions from '../chat-message/chat-message-actions.vue';
  import ReactionsDialog from '@main/common/components/dialogs/reactions-dialog.vue';

  export interface ChatMessagesProps {
    chat: ChatListItemView;
    messages: ChatMessageView[];
    blockedMembers: string[];
    readonly?: boolean;
  }

  export interface ChatMessagesEmits {
    (event: 'init', value: Nullable<HTMLDivElement>): void;
    (event: 'reply', value: RegularMsgView): void;
    (event: 'edit', value: RegularMsgView): void;
    (event: 'show:info', value: RegularMsgView): void;
  }

  const props = defineProps<ChatMessagesProps>();
  const emits = defineEmits<ChatMessagesEmits>();

  const chatId = computed(() => props.chat.chatId);
  const readonlyRef = computed(() => props.readonly);

  const processedMessages = computed(() =>
    Object.values(
      props.messages.reduce(
        (res, msg) => {
          const { timestamp } = msg;
          const date = dayjs(timestamp).format('YYYY-MM-DD');
          if (!res[date]) {
            res[date] = {
              date,
              items: [],
            };
          }

          res[date].items.push(msg);
          return res;
        },
        {} as Record<string, { date: string; items: ChatMessageView[] }>,
      ),
    )
      .map(dateBlock => ({
        date: dateBlock.date,
        items: dateBlock.items.sort((a, b) => a.timestamp - b.timestamp),
      }))
      .sort((a, b) => (a.date > b.date ? 1 : -1)),
  );

  const {
    showMessages,
    selectedMessages,
    messagesAreProcessing,
    msgActionsMenuProps,
    msgReactionsMenuProps,
    recentReactions,
    selectMessage,
    handleClickOnMessagesBlock,
    onMsgClick,
    clearMessageMenu,
    handleAction,
    handleSelectionReaction,
    checkIsOriginDevice,
  } = useChatMessages(chatId, readonlyRef, emits);

  function getPrevMsgSender(prevMsg: ChatMessageView) {
    const { chatMessageType, isIncomingMsg } = prevMsg;
    if (chatMessageType !== 'regular' || (chatMessageType === 'regular' && !isIncomingMsg)) {
      return '';
    }

    return prevMsg.sender;
  }
</script>

<template>
  <div
    id="chat-messages"
    ref="list-element"
    v-ui3n-long-press="{ handler: handleClickOnMessagesBlock, delay: 1000 }"
    :class="$style.chatMessages"
    @click.right="handleClickOnMessagesBlock"
    @click="onMsgClick"
  >
    <ui3n-list
      v-if="showMessages"
      :sticky="false"
      :items="processedMessages"
    >
      <template #item="{ item }">
        <ui3n-list :items="item.items">
          <template #title>
            <div :class="$style.date">
              <span :class="$style.dateValue">{{ item.date }}</span>
            </div>
          </template>

          <template #item="{ item: msg, index }">
            <chat-message
              :msg="msg"
              :selected-messages="selectedMessages"
              :messages-are-processing="messagesAreProcessing"
              :prev-msg-sender="index === 0 ? '' : getPrevMsgSender(item.items[index - 1])"
              :prev-msg-info="
                index === 0
                  ? null
                  : {
                    isIncomingMsg: item.items[index - 1].isIncomingMsg,
                    status: item.items[index - 1].status,
                  }
              "
              :related-message="(msg as RegularMsgView).relatedMessage"
              :is-origin-device="checkIsOriginDevice(msg)"
              :blocked-members="blockedMembers"
              @select="selectMessage"
            />
          </template>
        </ui3n-list>
      </template>
    </ui3n-list>

    <teleport
      v-if="msgActionsMenuProps.msg"
      :disabled="!msgActionsMenuProps.open"
      :to="`#msg-${msgActionsMenuProps.msg.chatMessageId}`"
    >
      <chat-message-actions
        :open="msgActionsMenuProps.open"
        :actions="msgActionsMenuProps.actions"
        :msg="msgActionsMenuProps.msg"
        @close="clearMessageMenu"
        @select:action="handleAction"
      />
    </teleport>

    <teleport
      v-if="msgReactionsMenuProps.msg"
      :disabled="!msgReactionsMenuProps.open"
      :to="`#msg-${msgReactionsMenuProps.msg.chatMessageId}`"
    >
      <reactions-dialog
        :open="msgReactionsMenuProps.open"
        :recent-reactions="recentReactions"
        :msg="msgReactionsMenuProps.msg"
        @close="clearMessageMenu"
        @select:reaction="handleSelectionReaction"
      />
    </teleport>
  </div>
</template>

<style lang="scss" module>
  .chatMessages {
    position: relative;
    width: 100%;
    height: 100%;
    background-color: var(--color-bg-chat-bubble-general-bg);
    overflow-y: auto;
    scrollbar-gutter: stable;

    .scroller {
      height: 100%;
    }

    & > div {
      --ui3n-list-bg-color: transparent !important;
    }
  }

  .date {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: var(--font-12);
    font-weight: 600;
    font-style: italic;
    color: var(--color-text-block-accent-default);
    padding: 2px 0;
  }

  .dateValue {
    position: relative;
    width: fit-content;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: 10px;
    background-color: var(--color-bg-block-primary-default);
  }
</style>
