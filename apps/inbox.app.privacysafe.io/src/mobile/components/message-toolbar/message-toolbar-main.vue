<script lang="ts" setup>
  import { computed } from 'vue';
  import size from 'lodash/size';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useContactsStore } from '@common/store';
  import { sameAddress } from '@shared/utils/address-utils';
  import type { IncomingMessageView, MessageAction, OutgoingMessageView } from '@common/types';
  import { SYSTEM_FOLDERS } from '@common/constants';

  const props = defineProps<{
    message: OutgoingMessageView;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: MessageAction): void;
  }>();

  const { isBlacklisted } = useContactsStore();
  const appStore = useAppStore();

  const isMessageIncoming = computed(() => !!(props.message as IncomingMessageView).sender);

  const senderAddress = computed(() => (props.message as IncomingMessageView).sender);

  const isSenderBlocked = computed(() =>
    isMessageIncoming.value && !!senderAddress.value && isBlacklisted(senderAddress.value));

  // As on the desktop: blocking and reporting are about somebody else, and one's
  // own address is offered for neither.
  const isSenderSomebodyElse = computed(() =>
    isMessageIncoming.value && !!senderAddress.value && !sameAddress(senderAddress.value, appStore.user));

  const isBlockBtnShow = computed(() => isSenderSomebodyElse.value && !isSenderBlocked.value);
  const isUnblockBtnShow = computed(() => isSenderSomebodyElse.value && isSenderBlocked.value);

  // As on the desktop: replying goes, forwarding and deleting stay.
  const isReplyBtnShow = computed(() => isMessageIncoming.value && !isSenderBlocked.value);
  const isReplyAllBtnShow = computed(() =>
    isMessageIncoming.value && !isSenderBlocked.value && size(props.message.recipients) > 1);
  const isRestoreBtnShow = computed(() => props.message?.mailFolder === SYSTEM_FOLDERS.trash);
  const isMoveToTrashBtnShow = computed(() => props.message?.mailFolder !== SYSTEM_FOLDERS.trash);
</script>

<template>
  <div :class="$style.toolbarMain">
    <div :class="$style.block">
      <ui3n-button
        v-if="isReplyBtnShow"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="reply-outline"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        @click="emits('action', 'reply')"
      />

      <ui3n-button
        v-if="isReplyAllBtnShow"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="reply-all-outline"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        @click="emits('action', 'reply-all')"
      />

      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="forward-outline"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        @click="emits('action', 'forward')"
      />

      <ui3n-button
        v-if="isSenderSomebodyElse"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="outline-report-problem"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        @click="emits('action', 'report')"
      />

      <ui3n-button
        v-if="isBlockBtnShow"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="outline-account-off-circle"
        icon-color="var(--warning-content-default)"
        icon-size="20"
        @click="emits('action', 'block')"
      />

      <ui3n-button
        v-if="isUnblockBtnShow"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="outline-account-circle"
        icon-color="var(--success-content-default)"
        icon-size="20"
        @click="emits('action', 'unblock')"
      />
    </div>

    <div :class="$style.block">
      <ui3n-button
        v-if="isRestoreBtnShow"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-refresh"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        @click="emits('action', 'restore')"
      />

      <ui3n-button
        v-if="isMoveToTrashBtnShow"
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="trash-can"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        @click="emits('action', 'move-to-trash')"
      />

      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="outline-delete"
        icon-color="var(--warning-content-default)"
        icon-size="20"
        @click="emits('action', 'delete')"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .toolbarMain {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .block {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
  }
</style>
