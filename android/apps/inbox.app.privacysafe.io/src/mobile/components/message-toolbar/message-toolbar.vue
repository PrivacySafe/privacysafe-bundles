<script lang="ts" setup>
  import isEmpty from 'lodash/isEmpty';
  import { type Nullable, Ui3nButton } from '@v1nt1248/3nclient-lib';
  import type { IncomingMessageView, MessageAction, OutgoingMessageView } from '@common/types';
  import { SYSTEM_FOLDERS } from '@common/constants';
  import MessageToolbarDraft from './message-toolbar-draft.vue';
  import MessageToolbarOutbox from './message-toolbar-outbox.vue';
  import MessageToolbarMain from './message-toolbar-main.vue';

  defineProps<{
    folder: Nullable<string>;
    editMode?: boolean;
    message?: Nullable<IncomingMessageView | OutgoingMessageView>;
    /** The form is not ready to send: attachments are still being taken in, or one is missing. */
    busy?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: MessageAction): void;
  }>();
</script>

<template>
  <div :class="$style.toolbar">
    <template v-if="editMode">
      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="send-variant-outline"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        :disabled="busy || isEmpty(message?.recipients)"
        @click="emits('action', 'send')"
      />

      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-close"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="20"
        @click="emits('action', 'discard')"
      />
    </template>

    <template v-else>
      <div
        v-if="message"
        :class="$style.toolbarBlock"
      >
        <message-toolbar-draft
          v-if="folder === SYSTEM_FOLDERS.draft"
          :message="message as OutgoingMessageView"
          @action="emits('action', $event)"
        />

        <message-toolbar-outbox
          v-else-if="folder === SYSTEM_FOLDERS.outbox"
          :message="message as OutgoingMessageView"
          @action="emits('action', $event)"
        />

        <message-toolbar-main
          v-else
          :message="message as OutgoingMessageView"
          @action="emits('action', $event)"
        />
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
  .toolbar {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: space-between;
    align-items: center;
    padding-left: var(--spacing-s);
  }

  .toolbarBlock {
    position: relative;
    width: 100%;
    height: 100%;
  }
</style>
