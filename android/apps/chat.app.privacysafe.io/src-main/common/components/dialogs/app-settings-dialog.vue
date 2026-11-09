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
<!--
 The app's settings on this device. The same shape as the settings dialog of
 the Storage app: a row per setting, with an Off / On switch.

 The state of the automatic backup is shown right under its switch, live: a
 user deciding whether to rely on it has to see when it last worked.
-->
<script lang="ts" setup>
  import { computed, inject } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import {
    Ui3nDialog,
    Ui3nSwitch,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { useSettingsStore } from '@main/common/store/settings.store';
  import { AUTO_BACKUP_INTERVAL_MILLIS } from '@shared/constants/auto-backup';
  import type { AppSettings } from '~/auto-backup.types';

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);

  const settingsStore = useSettingsStore();
  const { autoBackupInfo } = storeToRefs(settingsStore);

  const intervalHours = AUTO_BACKUP_INTERVAL_MILLIS / (60 * 60 * 1000);

  const statusText = computed(() => {
    const info = autoBackupInfo.value;
    if (info.inProgress) {
      return t('autoBackup.settings.inProgress');
    }
    return info.lastAt
      ? t('autoBackup.settings.lastAt', { date: new Date(info.lastAt).toLocaleString() })
      : t('autoBackup.settings.never');
  });

  const errorText = computed(() => {
    const error = autoBackupInfo.value.lastError;
    return error
      ? t('autoBackup.settings.error', { date: new Date(error.at).toLocaleString(), message: error.message })
      : '';
  });

  async function toggle(field: keyof AppSettings): Promise<void> {
    try {
      await settingsStore.setSetting(field, !autoBackupInfo.value.settings[field]);
    } catch {
      notifications?.$createNotice({
        type: 'error',
        content: t('autoBackup.settings.saveError'),
        duration: 4000,
      });
    }
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.appSettings">
        <div :class="$style.section">
          <div :class="$style.row">
            <div :class="$style.label">
              {{ t('autoBackup.settings.autoBackup') }}
            </div>

            <div :class="$style.value">
              <span :class="$style.text">{{ t('autoBackup.settings.off') }}</span>

              <ui3n-switch
                size="16"
                :model-value="autoBackupInfo.settings.autoBackup"
                @change="toggle('autoBackup')"
              />

              <span :class="$style.text">{{ t('autoBackup.settings.on') }}</span>
            </div>
          </div>

          <div :class="$style.hint">
            {{ t('autoBackup.settings.autoBackupHint', { hours: intervalHours }) }}
          </div>

          <div :class="$style.status">
            {{ statusText }}
          </div>

          <div
            v-if="errorText"
            :class="[$style.status, $style.error]"
          >
            {{ errorText }}
          </div>
        </div>

        <div :class="$style.section">
          <div :class="$style.row">
            <div :class="$style.label">
              {{ t('autoBackup.settings.showRestore') }}
            </div>

            <div :class="$style.value">
              <span :class="$style.text">{{ t('autoBackup.settings.off') }}</span>

              <ui3n-switch
                size="16"
                :model-value="autoBackupInfo.settings.showAutoBackupRestore"
                @change="toggle('showAutoBackupRestore')"
              />

              <span :class="$style.text">{{ t('autoBackup.settings.on') }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .appSettings {
    position: relative;
    padding: var(--spacing-s) var(--spacing-m) var(--spacing-m);
  }

  .section {
    padding: var(--spacing-s) 0;

    &:not(:last-child) {
      border-bottom: 1px solid var(--color-border-block-primary-default);
    }
  }

  .row {
    display: flex;
    width: 100%;
    min-height: var(--spacing-xl);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-m);
  }

  .label {
    font-size: var(--font-14);
    font-weight: 500;
    line-height: var(--font-20);
    color: var(--color-text-control-primary-default);
  }

  .value {
    position: relative;
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    gap: var(--spacing-s);
  }

  .text {
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
  }

  .hint {
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-block-secondary-default);
  }

  .status {
    margin-top: var(--spacing-xs);
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-16);
    color: var(--color-text-control-primary-default);

    &.error {
      color: var(--error-content-default);
      word-break: break-word;
    }
  }
</style>
