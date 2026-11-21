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
  import { computed, inject } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useRoute, useRouter } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import hasIn from 'lodash/hasIn';
  import isEmpty from 'lodash/isEmpty';
  import size from 'lodash/size';
  import { prepareDateAsSting } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nCheckbox, Ui3nIcon, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useContactsStore } from '@common/store';
  import { getMessageStatusUiData, getStatusDescriptionText, htmlToText } from '@common/utils';
  import { MARKED_MESSAGES_INJECTION_KEY } from '@common/constants';
  import type { IncomingMessageView, OutgoingMessageView } from '@common/types';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';

  const props = defineProps<{
    item: IncomingMessageView | OutgoingMessageView;
  }>();

  const route = useRoute();
  const router = useRouter();

  const { t } = useI18n();
  const { markedMessages, markMessage, resetMarkMessages } = inject(MARKED_MESSAGES_INJECTION_KEY)!;
  const { isMobileMode } = storeToRefs(useAppStore());
  const { contactList } = storeToRefs(useContactsStore());
  const { isBlacklisted } = useContactsStore();

  const isIncomingMessage = computed(() => hasIn(props.item, 'sender'));

  // Mail that arrived before the blocking stays where it is - only the user
  // deletes mail - so it is marked rather than hidden.
  const isSenderBlocked = computed(() => {
    const senderAddr = (props.item as IncomingMessageView).sender;
    return isIncomingMessage.value && !!senderAddr && isBlacklisted(senderAddr);
  });
  const isUnread = computed(() => isIncomingMessage.value && props.item?.status === 'received');
  const isMessageMarked = computed(() => markedMessages.value.includes(props.item.msgId));

  const sender = computed(() => {
    if (!hasIn(props.item, 'sender') || !(props.item as IncomingMessageView).sender) {
      return 'Me';
    }

    const sender = (props.item as IncomingMessageView).sender;
    if (sender.includes('@')) {
      const person = contactList.value.find(c => c.mail === sender);
      return person?.name || sender;
    }

    return sender;
  });

  const time = computed(() => props.item.deliveryTS || props.item.cTime);

  const status = computed(() => getMessageStatusUiData({ message: props.item, t }));

  const statusDescription = computed(() => {
    if (isEmpty(props.item.statusDescription)) {return '';}

    return getStatusDescriptionText({ t, statusDescription: props.item.statusDescription! });
  });

  const plainTxtBody = computed(() => htmlToText({ value: props.item.htmlTxtBody }));

  async function openMessage() {
    resetMarkMessages();
    if (isMobileMode.value) {
      // resetMarkMessages();
      const folder = route.params.folderId as string | undefined;
      router.push({
        name: 'message',
        params: { msgId: props.item.msgId },
        query: {
          readonly: 'yes',
          ...(folder && { sourceFolder: folder }),
        },
      });
    } else {
      markMessage(props.item.msgId);
    }
  }
</script>

<template>
  <div :class="[$style.messageListItem, isMessageMarked && $style.marked]">
    <div :class="$style.senderIcon">
      <contact-icon
        v-if="isMobileMode"
        :size="36"
        :name="sender"
        :selected="isMessageMarked"
        :class="[$style.contactIcon, isMobileMode && $style.contactIconMobile]"
        @click="markMessage(item.msgId)"
      />

      <template v-else>
        <contact-icon
          :size="36"
          :name="sender"
          readonly
          :selected="isMessageMarked"
          :class="$style.contactIcon"
        />

        <div
          :class="$style.senderIconCheckbox"
          @click.stop.prevent="markMessage(item.msgId)"
        >
          <ui3n-checkbox :model-value="isMessageMarked" />
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
      @click="openMessage"
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

      <div
        v-if="item.subject"
        :class="$style.subject"
      >
        <span>{{ item.subject }}</span>
      </div>

      <div
        v-if="plainTxtBody"
        :class="$style.body"
      >
        {{ plainTxtBody }}
      </div>

      <div
        v-if="!isEmpty(item.attachmentsInfo)"
        :class="$style.attachmentsInfo"
      >
        <div :class="$style.attachmentInfo">
          <Ui3nIcon
            icon="round-subject"
            width="12"
            height="12"
            color="var(--files-word-primary)"
          />
          <span>{{ item.attachmentsInfo![0].fileName }}</span>
        </div>

        <div
          v-if="size(item.attachmentsInfo) > 1"
          :class="$style.attachmentInfoExtra"
        >
          +{{ size(item.attachmentsInfo) - 1 }}
        </div>
      </div>

      <div
        v-if="status"
        :class="$style.status"
        :style="{ color: status.color }"
      >
        <ui3n-tooltip
          :content="statusDescription"
          position-strategy="fixed"
          placement="top-start"
          :disabled="!statusDescription"
        >
          <span>{{ status.text }}</span>
        </ui3n-tooltip>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/mixins' as mixins;

  .messageListItem {
    position: relative;
    width: 100%;
    min-height: 60px;
    padding: var(--spacing-s) var(--spacing-m) var(--spacing-s) 56px;
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
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
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
    min-height: 44px;
  }

  .title {
    display: flex;
    width: 100%;
    height: var(--font-20);
    justify-content: space-between;
    align-items: center;
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
    display: flex;
    width: 100%;
    height: var(--font-16);
    justify-content: flex-start;
    align-items: center;
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
</style>
