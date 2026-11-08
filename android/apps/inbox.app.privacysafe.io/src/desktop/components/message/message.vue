<script lang="ts" setup>
  import { computed, ref, watchEffect } from 'vue';
  import { useI18n } from 'vue-i18n';
  import size from 'lodash/size';
  import type { Nullable } from '@v1nt1248/3nclient-lib';
  import { useMessagesStore } from '@common/store';
  import messageBgImg from '@common/assets/images/message-bg.png';
  import type { IncomingMessageView, MessageAction, MessageBulkActions, OutgoingMessageView } from '@common/types';
  import MessageBulkActionsToolbar from '@desktop/components/message-bulk-actions-toolbar/message-bulk-actions-toolbar.vue';
  import MessageContent from '@common/components/message-content/message-content.vue';

  const props = withDefaults(
    defineProps<{
      folder: string;
      messageId?: string | null;
      markedMessages?: string[];
    }>(),
    {
      messageId: '',
      markedMessages: () => [],
    },
  );
  const emits = defineEmits<{
    (event: 'action', value: { action: MessageAction; message: IncomingMessageView | OutgoingMessageView }): void;
    (event: 'bulk-actions', value: { action: MessageBulkActions; messageIds: string[] }): void;
  }>();

  const { t } = useI18n();
  const messagesStore = useMessagesStore();
  const { getMessage } = messagesStore;

  const message = ref<Nullable<IncomingMessageView | OutgoingMessageView>>();

  const isBulkActionsToolbarOpen = computed(() => size(props.markedMessages) >= 2);

  watchEffect(() => {
    if (props.messageId) {
      message.value = getMessage(props.messageId);
    } else {
      message.value = null;
    }
  });
</script>

<template>
  <div :class="$style.messageWrap">
    <div
      v-if="!message"
      :class="$style.empty"
    >
      <img
        :src="messageBgImg"
        alt="bgImg"
      >

      <div :class="$style.emptyText">
        <p>
          {{ t('msg.text.no_selected.part1') }}
        </p>
        <p>
          {{ t('msg.text.no_selected.part2') }}
        </p>
      </div>
    </div>

    <template v-else>
      <message-content
        :message="message"
        @action="emits('action', $event)"
      />
    </template>

    <div
      v-if="isBulkActionsToolbarOpen"
      :class="$style.bulkActions"
    >
      <message-bulk-actions-toolbar
        :folder="folder"
        :marked-messages="markedMessages"
        @bulk-actions="emits('bulk-actions', $event)"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .messageWrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    padding: var(--spacing-s);
    background-color: var(--color-bg-chat-bubble-general-bg);
    overflow-y: auto;
  }

  .empty {
    display: flex;
    width: 100%;
    height: 100%;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: 72px;
  }

  .emptyText {
    position: relative;
    width: 180px;
    font-size: var(--font-14);
    font-weight: 400;
    line-height: var(--font-20);
    color: var(--color-text-block-primary-default);
    user-select: none;

    p {
      margin: 0;
      text-align: center;
    }
  }

  .bulkActions {
    position: absolute;
    width: 100%;
    height: var(--spacing-xxl);
    left: 0;
    top: 0;
  }
</style>
