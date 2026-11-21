<!--
 Copyright (C) 2026 3NSoft Inc.

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
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nAutocomplete,
    Ui3nDialog,
    Ui3nIcon,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useConnectivityStatus } from '@main/common/composables/use-connectivity-status';
  import { appContactsSrvProxy } from '@main/common/services/services-provider';
  import type { ContactListItem, ShareChannel } from '@main/types';

  const props = defineProps<{
    messageableContacts: ContactListItem[];
    isMobileFormFactor?: boolean;
    dialogProps?: Ui3nDialogComponentProps<{ recipient: string; channel: ShareChannel }>;
  }>();

  const emits = defineEmits<{
    (
      event: 'action',
      value: { event: Ui3nDialogEvent; data?: { recipient: string; channel: ShareChannel } },
    ): void;
  }>();

  const { t } = useI18n();
  const { connectivityStatus } = useConnectivityStatus();

  const recipient = ref<string[]>([]);

  const contacts = computed(() =>
    props.messageableContacts.map(c => ({
      ...c,
      name: c.name || c.displayName,
    })),
  );

  /**
   * Contacts go to the chat only when there is an active chat with the
   * recipient: without it the other side has not agreed to talk in the chat,
   * and the shared contacts may never be taken in.
   */
  const isChatChecking = ref(false);
  const isChatAvailable = ref(false);

  watch(
    () => recipient.value[0],
    async addr => {
      isChatAvailable.value = false;
      if (!addr) {
        isChatChecking.value = false;
        return;
      }

      isChatChecking.value = true;
      const isAvailable = await appContactsSrvProxy.checkChatWithPeer(addr).catch(() => false);
      // An answer for a recipient that is no longer selected says nothing.
      if (addr === recipient.value[0]) {
        isChatAvailable.value = isAvailable;
        isChatChecking.value = false;
      }
    },
  );

  const chatBtnDisable = computed(
    () => connectivityStatus.value !== 'online'
      || !recipient.value.length
      || isChatChecking.value
      || !isChatAvailable.value,
  );
  const mailBtnDisable = computed(() => connectivityStatus.value !== 'online' || !recipient.value.length);
  const showNoChatHint = computed(() => !!recipient.value.length && !isChatChecking.value && !isChatAvailable.value);

  function handleAction(e: { event: Ui3nDialogEvent }) {
    emits('action', e);
  }

  function selectChannel(v: ShareChannel) {
    emits('action', { event: 'confirm', data: { recipient: recipient.value[0], channel: v } });
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.body">
        <div :class="$style.row">
          <span :class="$style.label">{{ t('share.label') }}:</span>

          <div :class="$style.value">
            <ui3n-autocomplete
              v-model="recipient"
              :items="contacts"
              :multiple="false"
              item-value="mail"
              item-title="mail"
              :placeholder="t('share.placeholder')"
              :class="recipient.length && $style.filled"
            />
          </div>
        </div>

        <div :class="$style.actions">
          <div
            :class="[$style.action, chatBtnDisable && $style.disable]"
            @click="() => selectChannel('chat')"
          >
            <ui3n-icon
              v-if="isChatChecking"
              icon="spinner"
              size="40"
              color="var(--warning-content-default)"
            />
            <ui3n-icon
              v-else
              icon="outline-chat"
              size="40"
              color="var(--warning-content-default)"
            />

            <span :class="$style.actionLabel">
              {{ t('share.btnLabel.chat') }}
            </span>
          </div>

          <div
            :class="[$style.action, mailBtnDisable && $style.disable]"
            @click="() => selectChannel('mail')"
          >
            <ui3n-icon
              icon="outline-mail"
              size="40"
              color="var(--files-word-primary)"
            />

            <span :class="$style.actionLabel">
              {{ t('share.btnLabel.mail') }}
            </span>
          </div>
        </div>

        <div
          v-if="showNoChatHint"
          :class="$style.hint"
        >
          {{ t('share.noChatHint') }}
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    position: relative;
    width: 100%;
    color: var(--color-text-block-primary-default);
    padding: var(--spacing-m);
  }

  .row {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .label {
    position: relative;
    display: inline-block;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
  }

  .value {
    flex-grow: 1;
  }

  div[data-ui3n='autocomplete'] {
    background-color: var(--color-bg-control-secondary-default);
    border-radius: 8px;

    &.filled {
      padding: 0 8px 0 12px;
    }
  }

  .actions {
    display: flex;
    width: 100%;
    height: 120px;
    justify-content: space-around;
    align-items: center;
  }

  .action {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-s);
    cursor: pointer;

    .actionLabel {
      font-size: 12px;
      font-weight: 600;
    }

    &.disable {
      pointer-events: none;
      opacity: 0.5;
      cursor: default;
    }
  }

  .hint {
    font-size: 12px;
    line-height: 1.4;
    text-align: center;
    color: var(--color-text-block-secondary-default);
  }
</style>
