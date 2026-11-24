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
 The app's settings on this device, in the shape of the settings dialogs of the
 chat and the inbox apps: a section per setting. A choice is saved at once,
 there is nothing to confirm.
-->
<script lang="ts" setup>
  import { inject } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import {
    Ui3nDialog,
    Ui3nRadio,
    Ui3nRadioGroup,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
    type Ui3nRadioValue,
  } from '@v1nt1248/3nclient-lib';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { useSettingsStore } from '@main/common/store/settings.store';
  import { DATE_FORMATS, isDateFormat } from '@main/common/utils/app-settings';
  import { formatContactDate } from '@main/common/utils/contact-dates';
  import type { ContactDate } from '@main/types';

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);

  const settingsStore = useSettingsStore();
  const { dateFormat } = storeToRefs(settingsStore);

  /** A day whose month and day cannot be confused, to show the order by. */
  const SAMPLE_DATE: ContactDate = { id: 'sample', type: 'birthday', year: 1990, month: 3, day: 25 };

  const dateFormatOptions = DATE_FORMATS.map(format => ({
    value: format,
    sample: formatContactDate(SAMPLE_DATE, format),
  }));

  async function onDateFormatChange(value: Ui3nRadioValue): Promise<void> {
    if (!isDateFormat(value) || (value === dateFormat.value)) {
      return;
    }

    try {
      await settingsStore.setSetting('dateFormat', value);
    } catch (err) {
      await w3n.log('error', 'Could not save the date format', err);
      notifications?.$createNotice({
        type: 'error',
        content: t('settings.saveError'),
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
          <div :class="$style.label">
            {{ t('settings.dateFormat') }}
          </div>

          <div :class="$style.hint">
            {{ t('settings.dateFormatHint') }}
          </div>

          <ui3n-radio-group
            name="date-format"
            :model-value="dateFormat"
            :class="$style.options"
            @update:model-value="onDateFormatChange"
          >
            <ui3n-radio
              v-for="option in dateFormatOptions"
              :key="option.value"
              :checked-value="option.value"
              :data-format="option.value"
            >
              <span :class="$style.text">{{ option.value }}</span>
              <span :class="$style.sample">{{ option.sample }}</span>
            </ui3n-radio>
          </ui3n-radio-group>
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

  .label {
    font-size: var(--font-14);
    font-weight: 500;
    line-height: var(--font-20);
    color: var(--color-text-control-primary-default);
  }

  .hint {
    margin-bottom: var(--spacing-s);
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-block-secondary-default);
  }

  .options {
    row-gap: var(--spacing-s);
  }

  .text {
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
  }

  .sample {
    margin-left: var(--spacing-s);
    font-size: var(--font-12);
    color: var(--color-text-block-secondary-default);
  }
</style>
