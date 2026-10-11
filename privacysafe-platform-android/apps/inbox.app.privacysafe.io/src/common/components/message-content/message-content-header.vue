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
  import { useI18n } from 'vue-i18n';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useContactsStore } from '@common/store';
  import { sameAddress } from '@shared/utils/address-utils';
  import type { IncomingMessageView, MessageAction, OutgoingMessageView } from '@common/types';
  import { SYSTEM_FOLDERS } from '@common/constants';

  const props = defineProps<{
    message: IncomingMessageView | OutgoingMessageView;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { action: MessageAction; message: IncomingMessageView | OutgoingMessageView }): void;
  }>();

  const { t } = useI18n();
  const { isBlacklisted } = useContactsStore();
  const appStore = useAppStore();

  const isMessageIncoming = computed(() => !!(props.message as IncomingMessageView).sender);

  const senderAddress = computed(() => (props.message as IncomingMessageView).sender);

  const isSenderBlocked = computed(
    () => isMessageIncoming.value && !!senderAddress.value && isBlacklisted(senderAddress.value),
  );

  // Blocking and reporting are both about somebody else. A message from one's
  // own address - a copy of a sync phantom above all - is neither: a blocked own
  // address would stop this mailbox's own traffic, and there is nobody to report.
  const isSenderSomebodyElse = computed(
    () => isMessageIncoming.value && !!senderAddress.value && !sameAddress(senderAddress.value, appStore.user),
  );

  const isBlockBtnShow = computed(() => isSenderSomebodyElse.value && !isSenderBlocked.value);
  const isUnblockBtnShow = computed(() => isSenderSomebodyElse.value && isSenderBlocked.value);

  // Replying is writing to them, so it goes; forwarding is writing to somebody
  // else, and whether this message is worth passing on is the user's call.
  // Deleting is not touched either - mail already received is theirs to keep.
  const isReplyBtnShow = computed(() => isMessageIncoming.value && !isSenderBlocked.value);
  const isReplyAllBtnShow = computed(
    () => isMessageIncoming.value && !isSenderBlocked.value && size(props.message.recipients) > 1,
  );
  const isRestoreBtnShow = computed(() => props.message?.mailFolder === SYSTEM_FOLDERS.trash);
</script>

<template>
  <div :class="$style.msgHeader">
    <ui3n-tooltip
      v-if="isReplyBtnShow"
      :content="t('msg.content.tooltip.reply')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="secondary"
        icon="reply-outline"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-position="left"
        @click.stop.prevent="emits('action', { action: 'reply', message })"
      >
        {{ t('msg.content.tooltip.reply') }}
      </ui3n-button>
    </ui3n-tooltip>

    <ui3n-tooltip
      v-if="isReplyAllBtnShow"
      :content="t('msg.content.tooltip.replyAll')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="secondary"
        icon="reply-all-outline"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-position="left"
        @click.stop.prevent="emits('action', { action: 'reply-all', message })"
      >
        {{ t('msg.content.tooltip.replyAll') }}
      </ui3n-button>
    </ui3n-tooltip>

    <ui3n-tooltip
      :content="t('msg.content.tooltip.forward')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="secondary"
        icon="forward-outline"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-position="left"
        @click.stop.prevent="emits('action', { action: 'forward', message })"
      >
        {{ t('msg.content.tooltip.forward') }}
      </ui3n-button>
    </ui3n-tooltip>

    <ui3n-tooltip
      v-if="isRestoreBtnShow"
      :content="t('msg.content.tooltip.restore')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="secondary"
        icon="round-refresh"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-position="left"
        @click.stop.prevent="emits('action', { action: 'restore', message })"
      >
        {{ t('msg.content.tooltip.restore') }}
      </ui3n-button>
    </ui3n-tooltip>

    <ui3n-tooltip
      v-if="isBlockBtnShow"
      :content="t('msg.content.tooltip.block')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="custom"
        color="var(--color-bg-block-primary-default)"
        text-color="var(--warning-content-default)"
        icon="outline-account-off-circle"
        icon-color="var(--warning-content-default)"
        icon-position="left"
        @click.stop.prevent="emits('action', { action: 'block', message })"
      >
        {{ t('msg.content.tooltip.block') }}
      </ui3n-button>
    </ui3n-tooltip>

    <ui3n-tooltip
      v-if="isUnblockBtnShow"
      :content="t('msg.content.tooltip.unblock')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="custom"
        color="var(--color-bg-block-primary-default)"
        text-color="var(--warning-content-default)"
        icon="outline-account-circle"
        icon-color="var(--warning-content-default)"
        icon-position="left"
        @click.stop.prevent="emits('action', { action: 'unblock', message })"
      >
        {{ t('msg.content.tooltip.unblock') }}
      </ui3n-button>
    </ui3n-tooltip>

    <ui3n-tooltip
      v-if="isSenderSomebodyElse"
      :content="t('msg.content.tooltip.report')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="secondary"
        icon="outline-report-problem"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-position="left"
        @click.stop.prevent="emits('action', { action: 'report', message })"
      >
        {{ t('msg.content.tooltip.report') }}
      </ui3n-button>
    </ui3n-tooltip>
  </div>
</template>

<style lang="scss" module>
  .msgHeader {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
    padding-left: var(--spacing-s);
  }
</style>
