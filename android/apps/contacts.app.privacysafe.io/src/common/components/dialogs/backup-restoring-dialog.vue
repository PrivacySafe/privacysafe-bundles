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
 Deliberately without a cancel button, unlike the dialog for creating a backup:
 a restore drops the contacts table and refills it row by row, and there is
 nothing to roll that back to. Stopping halfway would be worse than finishing.
-->
<script lang="ts" setup>
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import {
  Ui3nDialog,
  Ui3nProgressLinear,
  type Ui3nDialogComponentProps,
  type Ui3nDialogEvent,
} from '@v1nt1248/3nclient-lib';
import { useAppStore } from '@main/common/store/app.store';

defineProps<{
  dialogProps?: Ui3nDialogComponentProps<boolean>;
}>();

const emits = defineEmits<{
  (event: 'action', value: { event: Ui3nDialogEvent }): void;
}>();

const { t } = useI18n();

const appStore = useAppStore();
const { restoreProgress } = storeToRefs(appStore);

const withProgressBar = computed(() => !!restoreProgress.value
&& ['restoring-images', 'restoring-contacts', 'syncing', 'completed']
.includes(restoreProgress.value.stage));

const text = computed(() => {
  const progress = restoreProgress.value;
  if (!progress) {
    return '';
  }

  switch (progress.stage) {
    case 'unpacking':
      return t('backup.restore.text.unpacking');
    case 'decrypting':
      return t('backup.restore.text.decrypting');
    case 'restoring-images':
      return t('backup.restore.text.restoringImages', {
        number: progress.processedFiles, total: progress.totalFiles,
      });
    case 'restoring-contacts':
      return t('backup.restore.text.restoringContacts', { total: progress.totalFiles });
    case 'syncing':
      return progress.syncDeferred
        ? t('backup.restore.text.syncDeferred')
        : t('backup.restore.text.syncing');
    case 'completed':
      return t('backup.restore.text.completed');
    case 'error':
      return t('backup.restore.error');
    default:
      return '';
  }
});

watch(restoreProgress, value => {
  if (value === null) {
    emits('action', { event: 'close' });
  }
});
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="(e: { event: Ui3nDialogEvent }) => emits('action', e)"
  >
    <template #body>
      <div :class="$style.body">
        <div :class="$style.info">
          <span :class="[$style.text, restoreProgress?.stage === 'error' && $style.error]">
            {{ text }}
          </span>

          <span :class="$style.value">
            {{ withProgressBar ? `${restoreProgress!.percent}%` : '' }}
          </span>
        </div>

        <ui3n-progress-linear
          v-if="withProgressBar"
          bg-color="transparent"
          height="4"
          :value="restoreProgress!.percent"
        />
        <ui3n-progress-linear
          v-else-if="restoreProgress && restoreProgress.stage !== 'error'"
          bg-color="transparent"
          height="4"
          indeterminate
        />
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
}

.value {
  padding-right: var(--spacing-s);
  font-weight: 600;
}
</style>
