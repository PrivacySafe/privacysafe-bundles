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
  import { computed, inject, watch, onBeforeUnmount } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nButton,
    Ui3nDialog,
    Ui3nProgressLinear,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@/common/stores/app.store';

  const props = defineProps<{
    /** Absent when the archive is to be saved unencrypted. */
    passphrase?: string;
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const appStore = useAppStore();
  const { backupProgress } = storeToRefs(appStore);
  const { runBackupWorkflow, cancelBackup } = appStore;

  const text = computed(() => {
    if (!backupProgress.value) {
      return '';
    }

    if (backupProgress.value.stage === 'scanning') {
      return t('backup.create.text.scanning');
    }

    if (['compressing', 'completed'].includes(backupProgress.value.stage)) {
      return t('backup.create.text.compressing', {
        number: backupProgress.value.processedFiles,
        total: backupProgress.value.totalFiles,
      });
    }

    if (backupProgress.value.stage === 'encrypting') {
      return t('backup.create.text.encrypting');
    }

    if (backupProgress.value.stage === 'saving') {
      return t('backup.create.text.saving');
    }

    if (backupProgress.value.stage === 'error') {
      return t('backup.create.error');
    }

    if (backupProgress.value.stage === 'cancelled') {
      return t('backup.create.cancel');
    }

    return '';
  });

  runBackupWorkflow({ passphrase: props.passphrase, t, $createNotice });

  async function handleAction(e: { event: Ui3nDialogEvent }) {
    if (e.event === 'cancel') {
      await cancelBackup(t, $createNotice);
    }
    emits('action', e);
  }

  onBeforeUnmount(async () => {
    if (backupProgress.value && backupProgress.value.stage !== 'completed') {
      await cancelBackup(t, $createNotice);
    }
  });

  watch(backupProgress, val => {
    if (val === null) {
      emits('action', { event: 'close' });
    }
  });
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :class="$style.backupCreatingDialog"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.body">
        <div :class="$style.info">
          <span
            :class="[
              $style.text,
              backupProgress?.stage === 'error' && $style.error,
              backupProgress?.stage === 'cancelled' && $style.warning,
            ]"
          >
            {{ text }}
          </span>

          <span :class="$style.value">
            {{
              backupProgress && ['compressing', 'encrypting', 'completed'].includes(backupProgress?.stage)
                ? `${backupProgress.percent}%`
                : ''
            }}
          </span>
        </div>

        <ui3n-progress-linear
          v-if="backupProgress && ['compressing', 'encrypting', 'completed'].includes(backupProgress.stage)"
          bg-color="transparent"
          height="4"
          :value="backupProgress.percent"
        />
      </div>
    </template>

    <template #actions>
      <div :class="$style.actions">
        <ui3n-button
          type="custom"
          color="var(--color-bg-block-primary-default)"
          text-color="var(--color-text-button-secondary-default)"
          @click="() => handleAction({ event: 'cancel' })"
        >
          {{ t('app.btn.cancel') }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .backupCreatingDialog {
    position: relative;
    width: 570px;
    max-width: 95%;
  }

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
