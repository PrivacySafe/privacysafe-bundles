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
  import { computed, ComputedRef, inject, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import size from 'lodash/size';
  import isEmpty from 'lodash/isEmpty';
  import cloneDeep from 'lodash/cloneDeep';
  import difference from 'lodash/difference';
  import uniq from 'lodash/uniq';
  import { prepareDateAsSting } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nBadge, Ui3nCheckbox, Ui3nIcon, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useContactsStore } from '@common/store';
  import { getMessageStatusUiData, htmlToText } from '@common/utils';
  import { SYSTEM_FOLDERS, MARKED_MESSAGES_INJECTION_KEY } from '@common/constants';
  import type { IncomingMessageView, MessageThread, OutgoingMessageView } from '@common/types';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';
  import MessageListItem from '@common/components/message-list-item/message-list-item.vue';

  const props = defineProps<{
    item: MessageThread;
    folder: string;
  }>();

  const { t } = useI18n();
  const { markedMessages, setMarkedMessages } = inject(MARKED_MESSAGES_INJECTION_KEY)!;
  const { isMobileMode } = storeToRefs(useAppStore());
  const { isBlacklisted } = useContactsStore();

  const isExpanded = ref(!!props.item.isExpanded);

  const lastIncomingMessage = computed(() =>
    props.item.messages.find(
      msg => !!(msg as IncomingMessageView).sender && props.item.lastIncomingTS === msg.deliveryTS,
    ),
  ) as ComputedRef<IncomingMessageView | undefined>;

  // The thread is marked for the sender the row is showing - the one whose name
  // is on it - rather than for anybody who ever wrote into it.
  const isSenderBlocked = computed(() => {
    const senderAddr = lastIncomingMessage.value?.sender;
    return !!senderAddr && isBlacklisted(senderAddr);
  });
  // @ts-ignore
  const lastOutgoingMessage = computed(() =>
    props.item.messages.find(
      msg =>
        !(msg as IncomingMessageView).sender &&
        (props.item.lastOutgoingTS === msg.deliveryTS || props.item.lastOutgoingTS === msg.cTime),
    ),
  ) as ComputedRef<OutgoingMessageView | undefined>;

  const isUnread = computed(
    () => props.folder === SYSTEM_FOLDERS.inbox && props.item.messages.some(msg => isMessageUnread(msg)),
  );

  const sender = computed(() => {
    if (props.folder === SYSTEM_FOLDERS.inbox) {
      return lastIncomingMessage.value?.sender || 'Me';
    }

    if (props.folder === SYSTEM_FOLDERS.trash) {
      return props.item.lastIncomingTS > props.item.lastOutgoingTS ? lastIncomingMessage.value?.sender : 'Me';
    }

    return 'Me';
  });

  const time = computed(() => {
    if (props.folder === SYSTEM_FOLDERS.inbox) {
      return props.item.lastIncomingTS;
    }

    if (props.folder === SYSTEM_FOLDERS.trash) {
      return Math.max(props.item.lastIncomingTS, props.item.lastOutgoingTS);
    }

    return props.item.lastOutgoingTS;
  });

  const subject = computed(() => {
    if (props.folder === SYSTEM_FOLDERS.inbox) {
      return lastIncomingMessage.value?.subject;
    }

    if (props.folder === SYSTEM_FOLDERS.trash) {
      return props.item.lastIncomingTS > props.item.lastOutgoingTS
        ? lastIncomingMessage.value?.subject
        : lastOutgoingMessage.value?.subject;
    }

    return lastOutgoingMessage.value?.subject;
  });

  const plainTxtBody = computed(() => {
    if (props.folder === SYSTEM_FOLDERS.inbox) {
      return htmlToText({ value: lastIncomingMessage.value?.htmlTxtBody });
    }

    if (props.folder === SYSTEM_FOLDERS.trash) {
      return props.item.lastIncomingTS > props.item.lastOutgoingTS
        ? htmlToText({ value: lastIncomingMessage.value?.htmlTxtBody })
        : htmlToText({ value: lastOutgoingMessage.value?.htmlTxtBody });
    }

    return htmlToText({ value: lastOutgoingMessage.value?.htmlTxtBody });
  });

  const attachmentsInfo = computed(() => {
    if (props.folder === SYSTEM_FOLDERS.inbox) {
      return lastIncomingMessage.value?.attachmentsInfo || [];
    }

    if (props.folder === SYSTEM_FOLDERS.trash) {
      return props.item.lastIncomingTS > props.item.lastOutgoingTS
        ? lastIncomingMessage.value?.attachmentsInfo || []
        : lastOutgoingMessage.value?.attachmentsInfo || [];
    }

    return lastOutgoingMessage.value?.attachmentsInfo || [];
  });

  const status = computed(() => {
    if (props.folder === SYSTEM_FOLDERS.inbox) {
      return getMessageStatusUiData({ message: lastIncomingMessage.value, t });
    }

    if (props.folder === SYSTEM_FOLDERS.trash) {
      return props.item.lastIncomingTS > props.item.lastOutgoingTS
        ? getMessageStatusUiData({ message: lastIncomingMessage.value, t })
        : getMessageStatusUiData({ message: lastOutgoingMessage.value, t });
    }

    return getMessageStatusUiData({ message: lastOutgoingMessage.value, t });
  });

  const messages = computed(() => props.item.messages) as ComputedRef<
    (IncomingMessageView | OutgoingMessageView)[]
  >;
  const messagesIds = computed(() => (messages.value || []).map(msg => msg.msgId));

  const isThreadMarked = computed(() =>
    (messages.value || []).some(msg => markedMessages.value.includes(msg.msgId)),
  );
  const isThreadMarkedCompletely = computed(() =>
    messagesIds.value.every(msgId => markedMessages.value.includes(msgId)),
  );

  function isMessageUnread(msg: IncomingMessageView | OutgoingMessageView): boolean {
    const isIncomingMessage = !!(msg as IncomingMessageView).sender;
    return isIncomingMessage && msg.status === 'received';
  }

  function toggleExpandedMode() {
    isExpanded.value = !isExpanded.value;
  }

  function markThread() {
    const updatedMarkedMessages = isThreadMarkedCompletely.value
      ? difference(markedMessages.value, messagesIds.value)
      : uniq([...cloneDeep(markedMessages.value), ...messagesIds.value]);
    setMarkedMessages(updatedMarkedMessages);
  }
</script>

<template>
  <div :class="[$style.threadListItemMultiple, isThreadMarked && $style.marked]">
    <div :class="$style.senderIcon">
      <contact-icon
        v-if="isMobileMode"
        :size="36"
        :name="sender"
        :selected="isThreadMarked"
        :class="[$style.contactIcon, isMobileMode && $style.contactIconMobile]"
        @click.stop.prevent="markThread"
      />

      <template v-else>
        <contact-icon
          :size="36"
          :name="sender"
          readonly
          :selected="isThreadMarked"
          :class="$style.contactIcon"
        />

        <div
          :class="$style.senderIconCheckbox"
          @click.stop.prevent="markThread"
        >
          <ui3n-checkbox
            :model-value="isThreadMarkedCompletely"
            :indeterminate="isThreadMarked && !isThreadMarkedCompletely"
          />
        </div>
      </template>

      <ui3n-tooltip
        v-if="isSenderBlocked"
        :content="t('msg.content.blocked_sender')"
        position-strategy="fixed"
        placement="top-start"
      >
        <ui3n-icon
          icon="round-lock"
          :width="14"
          :height="14"
          color="var(--warning-content-default)"
          :class="$style.blockedMark"
        />
      </ui3n-tooltip>
    </div>

    <div
      :class="$style.content"
      @click.stop.prevent="toggleExpandedMode"
    >
      <div :class="$style.title">
        <div :class="[$style.sender, isUnread && $style.accented]">
          <div
            v-if="isUnread"
            :class="$style.unreadIcon"
          />

          {{ sender }}
        </div>

        <span :class="$style.time">
          {{ prepareDateAsSting(time || Date.now()) }}
        </span>
      </div>

      <div :class="$style.title">
        <div :class="$style.subject">
          <span>{{ subject }}</span>
        </div>

        <ui3n-badge
          :value="size(item.messages)"
          color="var(--color-icon-control-secondary-default)"
          text-color="var(--color-text-block-primary-default)"
        />

        <ui3n-icon
          :icon="isExpanded ? 'round-keyboard-arrow-up' : 'round-keyboard-arrow-down'"
          :width="18"
          :height="18"
          color="var(--color-icon-button-secondary-default)"
        />
      </div>

      <div
        v-if="plainTxtBody"
        :class="$style.body"
      >
        {{ plainTxtBody }}
      </div>

      <div
        v-if="!isEmpty(attachmentsInfo)"
        :class="$style.attachmentsInfo"
      >
        <div :class="$style.attachmentInfo">
          <Ui3nIcon
            icon="round-subject"
            width="12"
            height="12"
            color="var(--files-word-primary)"
          />
          <span>{{ attachmentsInfo![0].fileName }}</span>
        </div>

        <div
          v-if="size(attachmentsInfo) > 1"
          :class="$style.attachmentInfoExtra"
        >
          +{{ size(attachmentsInfo) - 1 }}
        </div>
      </div>

      <div
        v-if="status"
        :class="$style.status"
        :style="{ color: status.color }"
      >
        {{ status.text }}
      </div>
    </div>
  </div>

  <div v-if="isExpanded">
    <div
      v-for="message in messages"
      :key="message.msgId"
      :class="[$style.threadItem, markedMessages.includes(message.msgId) && $style.threadItemMarked]"
    >
      <ui3n-icon
        icon="round-subdirectory-arrow-right"
        :width="12"
        :height="12"
        color="var(--color-icon-block-secondary-default)"
        :class="$style.threadItemIcon"
      />

      <message-list-item :item="message" />
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/mixins' as mixins;

  .threadListItemMultiple {
    position: relative;
    width: 100%;
    min-height: 60px;
    padding: var(--spacing-s) var(--spacing-m) var(--spacing-s) 52px;
    background-color: var(--color-bg-block-primary-default);
    cursor: pointer;

    &.marked {
      background-color: var(--color-bg-control-primary-hover);
    }

    &:hover {
      background-color: var(--color-bg-chat-bubble-general-bg);

      .time {
        color: var(--color-text-block-accent-default);
      }

      .attachmentInfo {
        background-color: var(--color-bg-control-primary-default);
      }

      .contactIcon {
        &:not(.contactIconMobile) {
          display: none;
        }
      }

      .senderIconCheckbox {
        display: flex;
        justify-content: center;
        align-items: center;
      }
    }
  }

  .senderIconCheckbox {
    position: absolute;
    display: none;
    width: 36px;
    height: 36px;
    top: 0;
    left: 0;
    border-radius: 50%;
    border: 1px solid var(--color-border-control-secondary-default);
    cursor: pointer;
  }

  .senderIcon {
    position: absolute;
    width: 36px;
    height: 36px;
    left: var(--spacing-s);
    top: 12px;
  }

  .blockedMark {
    position: absolute;
    top: -2px;
    right: -4px;
    z-index: 1;
  }

  .content {
    position: relative;
    width: 100%;
  }

  .title {
    display: flex;
    width: 100%;
    height: var(--font-20);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .sender {
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-chat-bubble-other-default);
    @include mixins.text-overflow-ellipsis();

    &.accented {
      padding-left: var(--spacing-m);
      font-weight: 700;
    }
  }

  .unreadIcon {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    top: 5px;
    left: 0;
    background-color: var(--color-icon-block-secondary-default);
  }

  .time {
    font-size: var(--font-12);
    color: var(--color-text-chat-bubble-other-sub);
  }

  .subject {
    flex-grow: 1;
    font-size: var(--font-12);
    color: var(--color-text-chat-bubble-other-default);

    span {
      display: block;
      font-weight: 500;
      @include mixins.text-overflow-ellipsis();
    }

    &.accented {
      span {
        font-weight: 700;
      }
    }
  }

  .body {
    display: -webkit-box;
    position: relative;
    width: 100%;
    max-height: var(--spacing-l);
    font-size: var(--font-12);
    font-weight: 400;
    line-height: var(--font-16);
    color: var(--color-text-chat-bubble-other-default);
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .attachmentsInfo {
    margin-top: var(--spacing-xs);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .attachmentInfo {
    display: flex;
    width: max-content;
    max-width: 100%;
    height: 20px;
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-s) 0 var(--spacing-xs);
    border-radius: var(--spacing-xs);
    background-color: var(--color-bg-control-secondary-default);

    span {
      font-size: var(--font-10);
      font-weight: 500;
      color: var(--color-text-control-primary-default);
      @include mixins.text-overflow-ellipsis();
    }
  }

  .attachmentInfoExtra {
    font-size: var(--font-12);
    font-weight: 500;
    line-height: 20px;
    color: var(--color-text-block-accent-default);
  }

  .status {
    margin-top: var(--spacing-xs);
    position: relative;
    font-size: var(--font-12);
    font-weight: 600;
    line-height: var(--font-16);
  }

  .threadItem {
    position: relative;
    width: 100%;
    padding-left: var(--spacing-m);
    cursor: pointer;

    &.threadItemSelected {
      background-color: var(--color-bg-chat-bubble-general-bg);
    }

    &.threadItemMarked {
      background-color: var(--color-bg-control-primary-hover);
    }

    &:hover {
      background-color: var(--color-bg-chat-bubble-general-bg);
    }
  }

  .threadItemIcon {
    position: absolute;
    top: var(--spacing-ml);
    left: var(--spacing-xs);
  }
</style>
