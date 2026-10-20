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
  import isEmpty from 'lodash/isEmpty';
  import { Ui3nButton, Ui3nProgressLinear, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useMessagesStore, useSendingStore } from '@common/store';
  import { getMessageStatusUiData, getStatusDescriptionText } from '@common/utils';
  import { useSendingProgress } from '@common/composables/useSendingProgress';
  import type { IncomingMessageView, MessageAction, OutgoingMessageView } from '@common/types';

  const props = defineProps<{
    message: OutgoingMessageView;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { action: MessageAction; message: IncomingMessageView | OutgoingMessageView }): void;
  }>();

  const { t } = useI18n();

  const { upsertMessage } = useMessagesStore();
  const { cancelSendMessage } = useSendingStore();

  const isSendingStopped = computed(() => ['error', 'canceled'].includes(props.message?.status));

  /**
   * The sending belongs to another device of the user.
   *
   * Cancel and resend are then both meaningless here and worse than meaningless:
   * cancel() writes status 'canceled' through upsertMessage, which would send a
   * FALSE status back to the device that is actually sending, while
   * cancelSendMessage would cancel nothing at all - there is no delivery of this
   * message on this device.
   */
  const isOnAnotherDevice = computed(() => !!props.message.originDeviceId);

  const actionBtnTitle = computed(() =>
    isSendingStopped.value ? t('msg.content.tooltip.resend') : t('msg.content.tooltip.cancel_sending'),
  );

  const status = computed(() => getMessageStatusUiData({ message: props.message, t }));


  const errorStateDescription = computed(() => {
    if (!isEmpty(props.message.statusDescription)) {
      return getStatusDescriptionText({ t, statusDescription: props.message.statusDescription! });
    }

    return t('msg.sending.error.noDescription');
  });

  const { percent, progressText } = useSendingProgress(computed(() => props.message.msgId));

  async function resend() {
    emits('action', { action: 'send', message: props.message });
  }

  async function cancel() {
    await upsertMessage({
      ...props.message,
      status: 'canceled',
    });
    await cancelSendMessage(props.message.msgId!);
  }
</script>

<template>
  <div :class="$style.headerOutbox">
    <ui3n-tooltip
      v-if="!isOnAnotherDevice"
      :content="actionBtnTitle"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-button
        type="secondary"
        :icon="isSendingStopped ? 'round-refresh' : 'cancel'"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-position="left"
        :class="$style.btn"
        @click.stop.prevent="isSendingStopped ? resend() : cancel()"
      >
        {{ actionBtnTitle }}
      </ui3n-button>
    </ui3n-tooltip>

    <div :class="$style.info">
      <div :class="$style.progress">
        <ui3n-tooltip
          v-if="isSendingStopped"
          :content="errorStateDescription"
          position-strategy="fixed"
          placement="top-start"
        >
          <span v-if="isSendingStopped">{{ errorStateDescription }}</span>
        </ui3n-tooltip>

        <!-- The progress numbers belong to a delivery of THIS device. There is
             no delivery here, so `useSendingProgress` has nothing to read and
             would report "0 of 0" - which reads as a stalled send rather than
             as somebody else's. -->
        <span v-else-if="isOnAnotherDevice">
          {{ t('msg.content.sending_on_another_device') }}
        </span>

        <span v-else>{{ progressText }}</span>

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
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/mixins' as mixins;

  .headerOutbox {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    padding-left: var(--spacing-s);
  }

  .btn {
    /* the buttons sit on the header, so they take its background */
    --ui3n-button-bg-color: var(--color-bg-block-primary-default);
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
    width: 100%;
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
