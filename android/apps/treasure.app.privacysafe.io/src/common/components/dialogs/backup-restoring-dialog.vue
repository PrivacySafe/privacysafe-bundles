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
  import { computed, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import {
    Ui3nDialog,
    Ui3nProgressLinear,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@/common/stores/app.store';

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();

  const appStore = useAppStore();
  const { restoreProgress } = storeToRefs(appStore);

  const text = computed(() => {
    if (!restoreProgress.value) {
      return '';
    }

    if (restoreProgress.value.stage === 'unpacking') {
      return t('backup.restore.text.unpacking');
    }

    if (restoreProgress.value.stage === 'decrypting') {
      return t('backup.restore.text.decrypting');
    }

    if (restoreProgress.value.stage === 'restoring') {
      return t('backup.restore.text.restoring', {
        number: restoreProgress.value.processedFiles,
        total: restoreProgress.value.totalFiles,
      });
    }

    if (restoreProgress.value.stage === 'syncing') {
      if (restoreProgress.value.totalFiles > 0) {
        return t('backup.restore.text.syncingWithCount', {
          number: restoreProgress.value.processedFiles,
          total: restoreProgress.value.totalFiles,
        });
      }
      return t('backup.restore.text.syncing');
    }

    if (restoreProgress.value.stage === 'completed') {
      return t('backup.restore.text.completed');
    }

    if (restoreProgress.value.stage === 'error') {
      return t('backup.restore.error');
    }

    return '';
  });

  function handleAction(e: { event: Ui3nDialogEvent }) {
    emits('action', e);
  }

  watch(restoreProgress, val => {
    if (val === null) {
      emits('action', { event: 'close' });
    }
  });
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :class="$style.backupRestoringDialog"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.body">
        <div :class="$style.info">
          <span
            :class="[
              $style.text,
              restoreProgress?.stage === 'error' && $style.error,
            ]"
          >
            {{ text }}
          </span>

          <span :class="$style.value">
            {{
              restoreProgress && ['restoring', 'syncing', 'completed'].includes(restoreProgress?.stage)
                ? `${restoreProgress.percent}%`
                : ''
            }}
          </span>
        </div>

        <ui3n-progress-linear
          v-if="restoreProgress && ['restoring', 'syncing', 'completed'].includes(restoreProgress.stage)"
          bg-color="transparent"
          height="4"
          :value="restoreProgress.percent"
        />
        <ui3n-progress-linear
          v-else-if="restoreProgress && ['unpacking', 'decrypting'].includes(restoreProgress.stage)"
          bg-color="transparent"
          height="4"
          indeterminate
        />
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .backupRestoringDialog {
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
  }

  .value {
    padding-right: var(--spacing-s);
    font-weight: 600;
  }
</style>
