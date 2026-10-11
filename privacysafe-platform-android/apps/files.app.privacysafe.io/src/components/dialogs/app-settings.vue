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
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nDialog, Ui3nSwitch, type Ui3nDialogComponentProps, type Ui3nDialogEvent } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useFsStore } from '@/store';
  import { useNavigation } from '@/composables/useNavigation';
  import { StorageAppSettings } from '@shared/types';

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();

  const appStore = useAppStore();
  const { appStorageSettings } = storeToRefs(appStore);
  const { setAppStorageSettings } = appStore;

  const { window1RootFolderId, window2RootFolderId, navigateToRouteSingle } = useNavigation();

  const fsStore = useFsStore();
  const { fsFolderList } = storeToRefs(fsStore);
  console.log('fsFolderList => ', fsFolderList.value);

  async function changeSettingItem(field: keyof StorageAppSettings) {
    const newValue = !appStorageSettings.value[field];
    await setAppStorageSettings(field, newValue);

    if (newValue) {
      return;
    }

    const changesForRootFolder = field === 'localFoldersDisplaying'
      ? 'user-local'
      : field === 'deviceFoldersDisplaying' ? 'user-device' : 'system-';

    if (window1RootFolderId.value.includes(changesForRootFolder) || window2RootFolderId.value?.includes(changesForRootFolder)) {
      await navigateToRouteSingle({
        params: { rootFolderId: 'user-synced-root' },
        query: {
          view: 'table',
          path: '',
          activeWindow: '1',
        },
      })
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
        <div :class="$style.row">
          <div :class="$style.label">
            {{ t('app.settings.label.folders_local') }}
          </div>

          <div :class="$style.value">
            <span :class="$style.text">{{ t('app.settings.label.off') }}</span>

            <ui3n-switch
              size="16"
              :model-value="!!appStorageSettings.localFoldersDisplaying"
              @change="changeSettingItem('localFoldersDisplaying')"
            />

            <span :class="$style.text">{{ t('app.settings.label.on') }}</span>
          </div>
        </div>

        <div :class="$style.row">
          <div :class="$style.label">
            {{ t('app.settings.label.folders_system') }}
          </div>

          <div :class="$style.value">
            <span :class="$style.text">{{ t('app.settings.label.off') }}</span>

            <ui3n-switch
              size="16"
              :model-value="!!appStorageSettings.systemFoldersDisplaying"
              @change="changeSettingItem('systemFoldersDisplaying')"
            />

            <span :class="$style.text">{{ t('app.settings.label.on') }}</span>
          </div>
        </div>

        <div :class="$style.row">
          <div :class="$style.label">
            {{ t('app.settings.label.folders_device') }}
          </div>

          <div :class="$style.value">
            <span :class="$style.text">{{ t('app.settings.label.off') }}</span>

            <ui3n-switch
              size="16"
              :model-value="!!appStorageSettings.deviceFoldersDisplaying"
              @change="changeSettingItem('deviceFoldersDisplaying')"
            />

            <span :class="$style.text">{{ t('app.settings.label.on') }}</span>
          </div>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .appSettings {
    position: relative;
    min-height: 120px;
    padding: var(--spacing-m);
  }

  .row {
    display: flex;
    width: 100%;
    height: var(--spacing-xl);
    justify-content: space-between;
    align-items: center;

    &:not(:last-child) {
      border-bottom: 1px solid var(--color-border-block-primary-default);
    }
  }

  .label {
    font-size: var(--font-14);
    font-weight: 500;
    line-height: var(--font-20);
    color: var(--color-text-control-primary-default);
    text-transform: capitalize;
  }

  .value {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--spacing-s);
  }

  .text {
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    text-transform: capitalize;
  }
</style>
