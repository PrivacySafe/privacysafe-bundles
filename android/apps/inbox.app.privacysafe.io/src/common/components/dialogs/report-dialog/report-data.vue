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
  import { Ui3nCheckbox } from '@v1nt1248/3nclient-lib';
  import { REASONS_MAP } from './constants';

  // Every value this step collects is owned by the dialog: it renders the steps
  // with v-if, so this component is destroyed and made anew on every move
  // between them, and anything kept here would be lost on the way back.
  const props = defineProps<{
    hasAttachments: boolean;
    reasons: string[];
    includeMessage: boolean;
    includeAttachments: boolean;
  }>();

  const emits = defineEmits<{
    (
      event: 'update:field',
      payload:
        | { field: 'reasons'; value: string[] }
        | { field: 'include-message'; value: boolean }
        | { field: 'include-attachments'; value: boolean },
    ): void;
  }>();

  const { t } = useI18n();

  function onReasonsUpdate(key: string) {
    const value = props.reasons.includes(key)
      ? props.reasons.filter(item => item !== key)
      : [...props.reasons, key];

    emits('update:field', { field: 'reasons', value });
  }

  function onFieldUpdate(field: 'include-message' | 'include-attachments', value: boolean) {
    emits('update:field', { field, value });
  }
</script>

<template>
  <div :class="$style.reportData">
    <div :class="$style.block">
      <h4 :class="$style.label">
        {{ t('dialog.report-dialog.content.reasons-label') }}
      </h4>

      <ui3n-checkbox
        v-for="(label, key) in REASONS_MAP"
        :key="key"
        size="24"
        :class="$style.reason"
        :model-value="reasons.includes(key)"
        @update:model-value="() => onReasonsUpdate(key)"
      >
        {{ t(label) }}
      </ui3n-checkbox>
    </div>

    <fieldset :class="[$style.block, $style.circled]">
      <legend>
        {{ t('dialog.report-dialog.content.fieldsetLabel') }}
      </legend>

      <div :class="$style.row">
        <span :class="$style.label">
          {{ t('dialog.report-dialog.content.reportedMessage') }}
        </span>

        <ui3n-checkbox
          size="24"
          :model-value="includeMessage"
          @update:model-value="v => onFieldUpdate('include-message', v as boolean)"
        />
      </div>

      <div
        v-if="hasAttachments"
        :class="$style.row"
      >
        <span :class="$style.label">
          {{ t('dialog.report-dialog.content.reportedAttachments') }}
        </span>

        <ui3n-checkbox
          size="24"
          :model-value="includeAttachments"
          @update:model-value="v => onFieldUpdate('include-attachments', v as boolean)"
        />
      </div>
    </fieldset>
  </div>
</template>

<style lang="scss" module>
  .reportData {
    position: relative;
    width: 100%;
    height: 100%;
    color: var(--color-text-block-primary-default);
  }

  .block {
    border-radius: var(--spacing-s);
    margin-bottom: var(--spacing-m);

    &.circled {
      padding: var(--spacing-s);
      border: 1px solid var(--color-border-control-secondary-default);
    }

    .reason {
      margin-top: var(--spacing-xs);
    }

    .row:last-child {
      margin-bottom: 0;
    }

    legend {
      text-align: center;
      font-size: var(--font-13);
      font-weight: 600;
      line-height: var(--font-16);
      color: var(--warning-content-default);
    }

    svg {
      color: var(--color-icon-control-accent-default);
    }
  }

  .row {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-s);
  }

  .label {
    font-size: var(--font-13);
    font-weight: 600;
    margin: 0 0 var(--spacing-s) 0;
  }

  .text {
    font-size: var(--font-12);
    font-weight: 500;
  }
</style>
