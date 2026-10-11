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
<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import isEmpty from 'lodash/isEmpty';
  import size from 'lodash/size';
  import type { ChatMessageHistoryChange, MessageStatus, SerializedDeliveryError } from '~/index';

  const props = defineProps<{
    msgStatus: MessageStatus;
    changes: ChatMessageHistoryChange[];
    timestamp: number;
  }>();

  const { t } = useI18n();

  const errorsChanges = computed(() =>
    props.changes.filter(c => c.type === 'error').sort((a, b) => b.timestamp - a.timestamp),
  );
  const currentErrors = computed(() => {
    if (props.msgStatus !== 'error' || isEmpty(errorsChanges.value)) {
      return null;
    }

    return errorsChanges.value[0];
  });
  const errorsHistory = computed(() => {
    if (isEmpty(errorsChanges.value) || (props.msgStatus === 'error' && size(errorsChanges.value) === 1)) {
      return [] as ChatMessageHistoryChange[];
    }

    return errorsChanges.value.slice(1);
  });

  function getErrorFlag(err: SerializedDeliveryError): string {
    if (err.domainNotFound) {
      return 'domainNotFound';
    }

    if (err.unknownRecipient) {
      return 'unknownRecipient';
    }

    if (err.senderNotAllowed) {
      return 'senderNotAllowed';
    }

    if (err.inboxIsFull) {
      return 'inboxIsFull';
    }

    if (err.badRedirect) {
      return 'badRedirect';
    }

    if (err.authFailedOnDelivery) {
      return 'authFailedOnDelivery';
    }

    if (err.msgTooBig) {
      return 'msgTooBig';
    }

    if (err.allowedSize) {
      return 'allowedSize';
    }

    if (err.recipientHasNoPubKey) {
      return 'recipientHasNoPubKey';
    }

    if (err.recipientPubKeyFailsValidation) {
      return 'recipientPubKeyFailsValidation';
    }

    if (err.msgNotFound) {
      return 'msgNotFound';
    }

    if (err.msgCancelled) {
      return 'msgCancelled';
    }

    if (err.type === 'connect') {
      return 'connectError';
    }

    return '';
  }

  function prepareErrorText({
    address,
    errorFlag,
    message,
  }: {
    address: string;
    errorFlag: string;
    message: string;
  }): string {
    const domain = address.includes('@') ? address.split('@')[1] : '';

    if (errorFlag === 'unknownRecipient') {
      return `[${address}] ${t('chat.message.info.error.unknownRecipient')}`;
    }

    if (errorFlag === 'msgTooBig') {
      return `[${address}] ${t('chat.message.info.error.msgTooBig')}`;
    }

    if (errorFlag === 'inboxIsFull') {
      return `[${address}] ${t('chat.message.info.error.inboxIsFull')}`;
    }

    if (errorFlag === 'domainNotFound') {
      return `[${domain}] ${t('chat.message.info.error.domainNotFound')}`;
    }

    if (errorFlag === 'noServiceRecord') {
      return `[${domain}] ${t('chat.message.info.error.noServiceRecord')}`;
    }

    if (errorFlag === 'recipientPubKeyFailsValidation') {
      return `[${address}] ${t('chat.message.info.error.recipientPubKeyFailsValidation')}`;
    }

    if (errorFlag === 'connectError') {
      return `[${address}] ${t('chat.message.info.error.connectError')}`;
    }

    return `[${address}] ${message || t('chat.message.info.error.noDescription')}`;
  }

  function getErrorText(address: string, err: SerializedDeliveryError): string {
    const errorFlag = getErrorFlag(err);
    return prepareErrorText({ address, errorFlag, message: err.message });
  }
</script>

<template>
  <div :class="$style.chatMessageInfoErrors">
    <h4 :class="$style.label">
      {{ t('chat.message.info.label.now') }}
    </h4>

    <div :class="$style.now">
      <div :class="$style.item">
        <template v-if="currentErrors">
          <div :class="$style.errors">
            <div
              v-for="(error, addr) in currentErrors.value"
              :key="addr"
              :class="$style.error"
            >
              {{
                getErrorText(
                  addr as string,
                  error as SerializedDeliveryError,
                )
              }}
            </div>
          </div>
        </template>

        <div
          v-else
          :class="$style.noData"
        >
          {{ t('chat.message.info.text.no_errors') }}
        </div>
      </div>
    </div>

    <hr :class="$style.delimiter">

    <h4 :class="$style.label">
      {{ t('chat.message.info.label.history') }}
    </h4>

    <div
      v-if="isEmpty(errorsHistory)"
      :class="$style.noData"
    >
      {{ t('chat.message.info.text.no_changes') }}
    </div>

    <div
      v-else
      :class="$style.changes"
    >
      <div
        v-for="change in errorsChanges"
        :key="change.timestamp"
        :class="$style.item"
      >
        <div :class="$style.errors">
          <template v-if="!isEmpty(change.value)">
            <div
              v-for="(error, addr) in change.value"
              :key="addr"
              :class="$style.error"
            >
              {{
                getErrorText(
                  addr as string,
                  error as SerializedDeliveryError,
                )
              }}
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  .chatMessageInfoErrors {
    position: relative;
    width: 100%;
    height: 100%;
    overflow-y: auto;
  }

  .label {
    width: 100%;
    font-weight: 500;
    text-align: center;
    color: var(--color-text-block-primary-default);
    margin: 0 0 var(--spacing-s) 0;
  }

  .now,
  .changes {
    width: 92%;
    margin: 0 4%;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    row-gap: var(--spacing-m);
  }

  .now {
    align-items: flex-start;
    padding-right: var(--spacing-m);

    .item {
      align-items: flex-start;
    }
  }

  .changes {
    align-items: flex-end;
    padding-left: var(--spacing-m);

    .item {
      align-items: flex-end;
    }

    .noData {
      margin-top: var(--spacing-m);
    }
  }

  .item {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    row-gap: var(--spacing-xs);
    padding: var(--spacing-s);
    border-radius: var(--spacing-s);
    border: 1px solid var(--color-border-control-secondary-default);
  }

  .errors {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    row-gap: var(--spacing-xs);
  }

  .error {
    position: relative;
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-block-primary-default);
  }

  .delimiter {
    position: relative;
    width: 92%;
    height: 1px;
    margin: var(--spacing-m) 4%;
    border: none;
    background-color: var(--color-text-chat-bubble-other-default);
  }

  .noData {
    font-size: var(--font-16);
    font-weight: 500;
    color: var(--color-text-block-secondary-default);
    text-align: center;
  }
</style>
