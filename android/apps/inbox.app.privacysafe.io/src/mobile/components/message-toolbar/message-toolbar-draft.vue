<script lang="ts" setup>
  import isEmpty from 'lodash/isEmpty';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import type { MessageAction, OutgoingMessageView } from '@common/types';

  defineProps<{
    message: OutgoingMessageView;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: MessageAction): void;
  }>();
</script>

<template>
  <div :class="$style.toolbarDraft">
    <ui3n-button
      type="icon"
      color="var(--color-bg-block-primary-default)"
      icon="round-edit"
      icon-color="var(--color-icon-block-primary-default)"
      icon-size="20"
      @click="emits('action', 'edit')"
    />

    <ui3n-button
      v-if="!isEmpty(message.recipients)"
      type="icon"
      color="var(--color-bg-block-primary-default)"
      icon="send-variant-outline"
      icon-color="var(--color-icon-block-primary-default)"
      icon-size="20"
      @click="emits('action', 'send')"
    />

    <ui3n-button
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
</template>

<style lang="scss" module>
  .toolbarDraft {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
  }
</style>
