<script lang="ts" setup>
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nProgressLinear } from '@v1nt1248/3nclient-lib';
  import type { MessageAction, OutgoingMessageView } from '@common/types';
  import { getMessageStatusUiData } from '@common/utils';
  import { useSendingProgress } from '@common/composables/useSendingProgress';

  const props = defineProps<{
    message: OutgoingMessageView;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: MessageAction): void;
  }>();

  const { t } = useI18n();

  const isSendingStopped = computed(() => ['error', 'canceled'].includes(props.message?.status));

  /**
   * The sending belongs to another device of the user; cancel and resend are
   * both meaningless here - see message-content-header-outbox.vue.
   */
  const isOnAnotherDevice = computed(() => !!props.message.originDeviceId);

  const status = computed(() => getMessageStatusUiData({ message: props.message, t }));

  const { percent, progressText } = useSendingProgress(computed(() => props.message.msgId));
</script>

<template>
  <div :class="$style.toolbarOutbox">
    <ui3n-button
      v-if="!isOnAnotherDevice"
      type="icon"
      color="var(--color-bg-block-primary-default)"
      :icon="isSendingStopped ? 'round-refresh' : 'cancel'"
      icon-color="var(--color-icon-block-primary-default)"
      icon-size="20"
      @click="emits('action', isSendingStopped ? 'send' : 'cancel')"
    />

    <div :class="$style.info">
      <div :class="$style.progress">
        <!-- The numbers belong to a delivery of THIS device; there is none here,
             so they would read "0 of 0". See message-content-header-outbox.vue. -->
        <span>
          {{ isOnAnotherDevice ? t('msg.content.sending_on_another_device') : progressText }}
        </span>

        <ui3n-progress-linear
          v-if="!isSendingStopped && !isOnAnotherDevice"
          :value="percent"
          :height="2"
          :class="$style.progressBar"
        />
      </div>

      <div
        :class="$style.status"
        :style="{ color: status?.color }"
      >
        <span>{{ status?.text }}</span>
      </div>
    </div>

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
  @use '@common/assets/styles/_mixins' as mixins;

  .toolbarOutbox {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .info {
    position: relative;
    width: calc(100% - var(--spacing-xl));
    max-width: calc(100% - var(--spacing-xl));
    font-size: var(--font-12);
    line-height: var(--font-16);
    overflow: hidden;
  }

  .progress,
  .status {
    position: relative;
    flex-grow: 1;
    height: var(--spacing-m);

    span {
      display: block;
      @include mixins.text-overflow-ellipsis();
    }
  }

  .progress {
    font-weight: 400;
    color: var(--color-text-chat-bubble-other-default);
  }

  .progressBar {
    position: absolute;
    left: 0;
    bottom: 0;
  }

  .status {
    font-weight: 600;
  }
</style>
