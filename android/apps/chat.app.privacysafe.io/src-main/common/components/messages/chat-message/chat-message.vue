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
import { computed, onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import size from 'lodash/size';
import { type Nullable, Ui3nIcon, Ui3nRadio } from '@v1nt1248/3nclient-lib';
import { useChatStore } from '@main/common/store/chat.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import type { ChatInvitationMsgView, ChatMessageView, MessageStatus, RegularMsgView } from '~/index';
import ChatMessageSystem from './chat-message-system.vue';
import ChatMessageInvitationRequest from './chat-message-invitation-request.vue';
import ChatMessageRegular from './chat-message-regular.vue';

const props = defineProps<{
  msg: ChatMessageView;
  selectedMessages: string[];
  messagesAreProcessing: string[];
  relatedMessage?: RegularMsgView['relatedMessage'];
  prevMsgSender: string | undefined;
  prevMsgInfo: Nullable<{ isIncomingMsg?: boolean, status: MessageStatus | undefined }>;
  isOriginDevice?: boolean;
  /** Passed through to the system record about a contact being blocked. */
  blockedMembers?: string[];
}>();
const emits = defineEmits<{
  (event: 'click:right', value: MouseEvent): void;
  (event: 'select', value: string): void;
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const messagesStore = useMessagesStore();
const { markMessageAsRead } = messagesStore;

let intersectionObserver: IntersectionObserver | null = null;

const chatMsgElement = useTemplateRef<Nullable<Element>>('chat-msg-element');

const isIncomingMsg = computed(() => props.msg.isIncomingMsg);

const isMsgSystem = computed(() => (props.msg.chatMessageType === 'system')
  || (props.msg.chatMessageType === 'invitation'));

const isInvitationRequest = computed(() => props.msg.chatMessageType === 'invitation' && isIncomingMsg.value);

const currentMsgSender = computed<string>(() => props.msg.sender);

const isMsgFirstUnred = computed(() => props.msg.isIncomingMsg
  && props.msg.status === 'unread'
  && props.prevMsgInfo
  && (!props.prevMsgInfo.isIncomingMsg || (props.prevMsgInfo.isIncomingMsg && props.prevMsgInfo.status !== 'unread')),
);

const isSelectionMode = computed(() => size(props.selectedMessages) > 0);
const isProcessing = computed(() => props.messagesAreProcessing.includes(props.msg.chatMessageId));

function intersectHandler(
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver,
) {
  entries.forEach(async entry => {
    if (entry.isIntersecting) {
      const { chatMessageId, isIncomingMsg, chatMessageType, status, chatId } = props.msg;
      const msgIdFromDomElement = entry.target.id.replace('footer-', '');

      if (
        chatMessageId === msgIdFromDomElement
        && isIncomingMsg
        && (chatMessageType !== 'system')
        && (status === 'unread')
      ) {
        await markMessageAsRead(chatId, chatMessageId);
      }

      observer.unobserve(entry.target);
    }
  });
}

onMounted(async () => {
  if (props.msg.chatMessageType === 'regular' && props.msg.status === 'unread') {
    intersectionObserver = new IntersectionObserver(intersectHandler, {
      root: document.getElementById('chat-messages'),
      rootMargin: '0px',
      threshold: 1,
    });

    const targetElement = document.getElementById(`footer-${props.msg.chatMessageId}`);
    if (targetElement) {
      intersectionObserver.observe(targetElement);
    }
  }
});

onBeforeUnmount(() => {
  intersectionObserver && intersectionObserver.disconnect();
})
</script>

<template>
  <div
    :id="`msg-${msg.chatMessageId}`"
    ref="chat-msg-element"
    class="chat-message"
    :class="[
      $style.chatMessage,
      isSelectionMode && msg.chatMessageType === 'regular' && $style.selectionMode,
      currentMsgSender !== prevMsgSender && !isMsgSystem && $style.withOffset,
      !isMsgSystem && isIncomingMsg ? $style.chatMessageIncoming : $style.chatMessageOutgoing,
      isMsgFirstUnred && $style.withDblOffset,
    ]"
  >
    <div
      v-if="isSelectionMode && msg.chatMessageType === 'regular'"
      :class="$style.check"
    >
      <!-- @vue-expect-error -->
      <ui3n-radio
        :model-value="selectedMessages.includes(msg.chatMessageId)"
        size="32"
        @change="emits('select', msg.chatMessageId)"
        @click.stop.prevent
      >
        <template #checkedIcon>
          <ui3n-icon
            icon="round-check-circle"
            color="var(--color-icon-block-accent-default)"
            size="32"
          />
        </template>

        <template #uncheckedIcon>
          <ui3n-icon
            icon="outline-circle"
            color="var(--color-icon-block-accent-default)"
            size="32"
          />
        </template>
      </ui3n-radio>
    </div>

    <div
      v-if="isMsgFirstUnred"
      :class="$style.unredInfo"
    >
      <hr :class="$style.unredInfoLine">
      <span :class="$style.unredInfoText">
        {{ t('chat.message.label.unread', { messages: `${chatStore.currentChat?.unread || ''}` }) }}
      </span>
    </div>

    <chat-message-system
      v-if="isMsgSystem && !isInvitationRequest"
      :msg="msg"
      :blocked-members="blockedMembers"
    />

    <chat-message-invitation-request
      v-else-if="isMsgSystem && isInvitationRequest"
      :msg="msg as ChatInvitationMsgView"
    />

    <chat-message-regular
      v-else
      :msg="msg as RegularMsgView"
      :wrap-msg-element="chatMsgElement"
      :related-message="relatedMessage"
      :prev-msg-sender="prevMsgSender"
      :is-processing="isProcessing"
      :is-origin-device="isOriginDevice"
      @click.right.prevent="emits('click:right', $event)"
    />
  </div>
</template>

<style lang="scss" module>
.chatMessage {
  --message-max-width: 720px;
  --message-min-width: 112px;
  --spacing-sm: calc(var(--spacing-s) * 1.5);

  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  padding: var(--spacing-xs) var(--spacing-s);
  scroll-margin-bottom: 24px;

  &.chatMessageOutgoing {
    justify-content: flex-end;
  }

  &.chatMessageIncoming {
    justify-content: flex-start;
  }

  &.selectionMode {
    padding-left: var(--spacing-xl);
  }
}

.check {
  position: absolute;
  top: 0;
  height: 100%;
  left: 4px;
  width: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.unredInfo {
  position: absolute;
  top: -20px;
  left: 0;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.unredInfoLine {
  position: absolute;
  left: 5%;
  width: 90%;
  top: 7px;
  height: 1px;
  margin: 0;
  border: none;
  background-color: var(--color-text-chat-bubble-other-default);
}

.unredInfoText {
  display: inline-block;
  padding: 0 var(--spacing-s);
  font-size: var(--font-12);
  font-weight: 600;
  font-style: italic;
  color: var(--color-text-chat-bubble-other-default);
  background-color: var(--color-bg-chat-bubble-general-bg);
  z-index: 1;
}

.withOffset {
  margin-top: var(--spacing-s);
}

.withDblOffset {
  margin-top: var(--spacing-ml);
}
</style>
