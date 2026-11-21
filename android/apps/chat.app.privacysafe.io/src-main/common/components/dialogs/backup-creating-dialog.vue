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
  import { computed, inject, onBeforeUnmount, watch } from 'vue';
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
  import { useBackupStore } from '@main/common/store/backup.store';

  /**
   * `withDefaults`, and it is NOT decoration.
   *
   * `withAttachments?: boolean` compiles to `{ type: Boolean, required: false }`,
   * and Vue casts an ABSENT Boolean prop to `false` - not to `undefined`. So a
   * dialog opened without the prop, which is every ordinary backup, would ask
   * for an archive WITHOUT ATTACHMENT BYTES.
   *
   * Whatever replaces this must keep an explicit default: the trap is in the
   * declaration, not in the callers.
   */
  const props = withDefaults(
    defineProps<{
      /** Empty when the user asked for an unencrypted archive. */
      passphrase?: string;
      /** False packs records only - the way out of an archive that is too big. */
      withAttachments?: boolean;
      dialogProps?: Ui3nDialogComponentProps<boolean>;
    }>(),
    { withAttachments: true, passphrase: undefined, dialogProps: undefined },
  );

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { appVersion } = storeToRefs(useAppStore());
  const backupStore = useBackupStore();
  const { backupProgress } = storeToRefs(backupStore);
  const { runBackupWorkflow, cancelBackup } = backupStore;

  const withProgressBar = computed(() => !!backupProgress.value
    && ['reading-attachments', 'compressing', 'encrypting', 'completed']
      .includes(backupProgress.value.stage));

  const text = computed(() => {
    const progress = backupProgress.value;
    if (!progress) {
      return '';
    }

    switch (progress.stage) {
      case 'scanning':
        return t('backup.create.text.scanning');
      case 'reading-attachments':
        return t('backup.create.text.readingAttachments', {
          number: progress.processedFiles,
          total: progress.totalFiles,
        });
      case 'compressing':
      case 'completed':
        return t('backup.create.text.compressing', {
          number: progress.processedFiles,
          total: progress.totalFiles,
        });
      case 'encrypting':
        return t('backup.create.text.encrypting');
      case 'saving':
        return t('backup.create.text.saving');
      case 'error':
        return t('backup.create.error');
      case 'cancelled':
        return t('backup.create.cancel');
      default:
        return '';
    }
  });

  // Started as the dialog is set up, so that the first progress event has
  // somewhere to land. The workflow drives backupProgress; this dialog only
  // renders it, and closes itself when it is cleared.
  runBackupWorkflow({
    passphrase: props.passphrase,
    withAttachments: props.withAttachments,
    appVersion: appVersion.value,
    t,
    $createNotice,
  });

  function handleAction(e: { event: Ui3nDialogEvent }) {
    if (e.event === 'cancel') {
      cancelBackup(t, $createNotice);
    }
    emits('action', e);
  }

  // Closing the dialog by any other route - the overlay, ESC - must stop the
  // work too, otherwise the reading and packing go on for a window that is gone.
  onBeforeUnmount(() => {
    const progress = backupProgress.value;
    if (progress && (progress.stage !== 'completed')) {
      cancelBackup(t, $createNotice);
    }
  });

  watch(backupProgress, value => {
    if (value === null) {
      emits('action', { event: 'close' });
    }
  });
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
              backupProgress?.stage === 'error' && $style.error,
              backupProgress?.stage === 'cancelled' && $style.warning,
            ]"
          >
            {{ text }}
          </span>

          <span :class="$style.value">
            {{ withProgressBar ? `${backupProgress!.percent}%` : '' }}
          </span>
        </div>

        <ui3n-progress-linear
          v-if="withProgressBar"
          bg-color="transparent"
          height="4"
          :value="backupProgress!.percent"
        />

        <!--
          The explanations of what an archive can bring back are NOT here any
          more: backup-notices-dialog.vue shows them before the work starts, as
          a step to read. Here they were on screen for exactly as long as the
          backup took, which for a small history is under a second - long enough
          to see that something was written, not long enough to read it.
        -->
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
          {{ t('app.text.cancel') }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    position: relative;
    width: 100%;
    padding: var(--spacing-ml) var(--spacing-m);
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);
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
