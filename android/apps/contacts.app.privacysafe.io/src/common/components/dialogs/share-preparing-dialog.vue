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
<script lang="ts" setup>
  import { computed, inject, onBeforeUnmount } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nButton,
    Ui3nDialog,
    Ui3nProgressLinear,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@main/common/store/app.store';
  import { appContactsSrvProxy } from '@main/common/services/services-provider';
  import { isBackupCancelledError } from '@main/common/store/app/backup-restore';
  import { chatApp, inboxApp } from '@main/common/constants';
  import type { OpenChatCmdArg, OpenInboxCmdArg, ShareChannel } from '@main/types';

  const props = defineProps<{
    contactIds: string[];
    recipient: string;
    channel: ShareChannel;
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: boolean }): void;
  }>();

  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const appStore = useAppStore();
  const { shareProgress } = storeToRefs(appStore);
  const { onShareProgress } = appStore;

  let isFinished = false;

  const percent = computed(() => shareProgress.value?.percent ?? 0);

  const text = computed(() => {
    const progress = shareProgress.value;
    if (!progress || (progress.stage === 'preparing')) {
      return t('share.progress.preparing', {
        number: progress?.processedContacts ?? 0,
        total: progress?.totalContacts ?? props.contactIds.length,
      });
    }

    switch (progress.stage) {
      case 'sending':
      case 'completed':
        return t(`share.progress.sending.${progress.channel}`);
      case 'error':
        return t('share.progress.error');
      case 'cancelled':
        return t('share.progress.cancelled');
      default:
        return '';
    }
  });

  const canBeCancelled = computed(() => !shareProgress.value || (shareProgress.value.stage === 'preparing'));

  function finish(event: Ui3nDialogEvent, data?: boolean) {
    if (isFinished) {
      return;
    }

    isFinished = true;
    onShareProgress(null);
    emits('action', { event, data });
  }

  /**
   * The service makes the file and hands it over to the chat or inbox app,
   * which keeps it as a draft of a message. Opening that app with the draft
   * id is up to this window, since starting other apps is a gui capability.
   */
  async function runShareWorkflow() {
    const { contactIds, recipient, channel } = props;
    try {
      const { draftId } = await appContactsSrvProxy.shareContacts({ contactIds, recipient, channel });
      if (channel === 'chat') {
        await w3n.shell!.startAppWithParams!(chatApp.domain, chatApp.openCmd, {
          peerAddress: recipient,
          draftId,
        } as OpenChatCmdArg);
      } else {
        await w3n.shell!.startAppWithParams!(inboxApp.domain, inboxApp.openCmd, {
          peerAddress: recipient,
          draftId,
        } as OpenInboxCmdArg);
      }
      finish('confirm', true);
    } catch (err) {
      if (isFinished) {
        return;
      }

      if (isBackupCancelledError(err)) {
        $createNotice({ type: 'info', content: t('share.progress.cancelled'), duration: 3000 });
        finish('cancel');
        return;
      }

      await w3n.log('error', 'Error while sharing contacts', err);
      $createNotice({ type: 'error', content: t('share.progress.error'), duration: 5000 });
      finish('close');
    }
  }

  async function cancelShare() {
    if (!canBeCancelled.value) {
      return;
    }

    await appContactsSrvProxy.cancelShareContacts().catch(() => false);
  }

  function handleAction(e: { event: Ui3nDialogEvent }) {
    if (e.event === 'cancel') {
      void cancelShare();
      return;
    }
    emits('action', e);
  }

  // Closing the dialog by any other route must stop the work too, otherwise
  // the service keeps packing a file for a window that is gone.
  onBeforeUnmount(() => {
    if (!isFinished) {
      void cancelShare();
      onShareProgress(null);
    }
  });

  onShareProgress(null);
  // Started as the dialog is set up, so that the first progress event has
  // somewhere to land.
  void runShareWorkflow();
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.body">
        <div :class="$style.info">
          <span
            :class="[
              $style.text,
              shareProgress?.stage === 'error' && $style.error,
              shareProgress?.stage === 'cancelled' && $style.warning,
            ]"
          >
            {{ text }}
          </span>

          <span :class="$style.value">{{ `${percent}%` }}</span>
        </div>

        <ui3n-progress-linear
          bg-color="transparent"
          height="4"
          :value="percent"
        />
      </div>
    </template>

    <template #actions>
      <div :class="$style.actions">
        <ui3n-button
          type="custom"
          color="var(--color-bg-block-primary-default)"
          text-color="var(--color-text-button-secondary-default)"
          :disabled="!canBeCancelled"
          @click="cancelShare"
        >
          {{ t('app.btn.cancel') }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    position: relative;
    width: 100%;
    height: 80px;
    padding: var(--spacing-ml) var(--spacing-m);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
  }

  .info {
    display: flex;
    width: 100%;
    height: var(--spacing-m);
    justify-content: space-between;
    align-items: center;
    font-size: var(--font-12);
    color: var(--color-text-control-primary-default);
  }

  .text {
    display: inline-block;
    padding-left: var(--spacing-s);
    font-weight: 400;

    &.error {
      color: var(--error-content-default);
    }

    &.warning {
      color: var(--warning-content-default);
    }
  }

  .value {
    padding-right: var(--spacing-s);
    font-weight: 600;
  }

  .actions {
    display: flex;
    width: 100%;
    height: 64px;
    padding: 0 var(--spacing-m);
    justify-content: flex-end;
    align-items: center;
  }
</style>
