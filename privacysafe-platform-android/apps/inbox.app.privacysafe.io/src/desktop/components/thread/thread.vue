<script lang="ts" setup>
  import { computed, ref, watchEffect } from 'vue';
  import { useI18n } from 'vue-i18n';
  import isEmpty from 'lodash/isEmpty';
  import size from 'lodash/size';
  import { Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { useMessagesStore } from '@common/store/messages.store';
  import type { IncomingMessageView, MessageAction, MessageBulkActions, OutgoingMessageView } from '@common/types';
  import messageBgImg from '@common/assets/images/message-bg.png';
  import MessageContent from '@common/components/message-content/message-content.vue';
  import MessageBulkActionsToolbar from '@desktop/components/message-bulk-actions-toolbar/message-bulk-actions-toolbar.vue';

  const props = withDefaults(
    defineProps<{
      folder: string;
      markedMessages?: string[];
    }>(),
    {
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

  const isLoading = ref(false);
  const messages = ref<(IncomingMessageView | OutgoingMessageView)[]>([]);

  const isThreadEmpty = computed(() => isEmpty(messages.value!));

  const isBulkActionsToolbarOpen = computed(() => size(props.markedMessages) >= 2);

  const threads = computed(() =>
    (messages.value || []).reduce((acc, message) => {
      if (!acc.includes(message.threadId)) {
        acc.push(message.threadId);
      }
      return acc;
    }, [] as string[]),
  );

  function messageSort(
    a: IncomingMessageView | OutgoingMessageView,
    b: IncomingMessageView | OutgoingMessageView,
  ): number {
    const aTS = (a.deliveryTS || a.cTime) as number;
    const bTS = (b.deliveryTS || b.cTime) as number;
    return bTS > aTS ? 1 : -1;
  }

  watchEffect(() => {
    try {
      isLoading.value = true;

      if (isEmpty(props.markedMessages)) {
        messages.value = [];
      } else if (size(props.markedMessages) === 1) {
        const msg = getMessage(props.markedMessages[0]);
        if (msg) {
          messages.value = [msg];
        }
      } else if (size(props.markedMessages) > 1) {
        messages.value = [];
        for (const msgId of props.markedMessages) {
          const msg = getMessage(msgId);
          msg && messages.value.push(msg);
        }
      }

      messages.value.sort(messageSort);
    } finally {
      isLoading.value = false;
    }
  });
</script>

<template>
  <div :class="$style.thread">
    <div
      v-if="isThreadEmpty || size(threads) > 1"
      :class="$style.empty"
    >
      <img
        :src="messageBgImg"
        alt="bgImg"
      >

      <div :class="$style.emptyText">
        <p>{{ t('msg.text.no_selected.part1') }}</p>
        <p>{{ t('msg.text.no_selected.part2') }}</p>
      </div>
    </div>

    <div
      v-else
      :class="[$style.threadBody, isBulkActionsToolbarOpen && $style.threadBodyWithActions]"
    >
      <template
        v-for="message in messages"
        :key="message.msgId"
      >
        <message-content
          :message="message"
          :class="$style.threadItem"
          @action="emits('action', $event)"
        />
      </template>
    </div>

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

    <div
      v-if="isLoading"
      :class="$style.loader"
    >
      <ui3n-progress-circular
        indeterminate
        size="80"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .thread {
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

  .threadItem {
    margin-bottom: var(--spacing-xs);
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

  .threadBody {
    position: relative;
    width: 100%;

    &.threadBodyWithActions {
      padding-top: var(--spacing-xxl);
    }
  }

  .bulkActions {
    position: fixed;
    left: 570px;
    right: 0;
    top: 72px;
    height: var(--spacing-xxl);
  }

  .loader {
    position: absolute;
    left: 0;
    width: 100%;
    top: 0;
    height: 100%;
    z-index: 5;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
