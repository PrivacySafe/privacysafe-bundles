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
  import { Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import type { RecordListPlaceholder } from '@/common/utils';

  defineProps<{
    state: RecordListPlaceholder;
    searchText?: string;
  }>();

  const { t } = useI18n();
</script>

<template>
  <div
    :class="$style.placeholder"
    :role="state === 'loading' ? 'status' : undefined"
  >
    <template v-if="state === 'loading'">
      <ui3n-progress-circular
        indeterminate
        size="48"
      />
      <span :class="$style.text">{{ t('list.placeholder.loading') }}</span>
    </template>

    <span
      v-else-if="state === 'failed'"
      :class="$style.text"
    >
      {{ t('list.placeholder.failed') }}
    </span>

    <span
      v-else-if="state === 'no-matches'"
      :class="$style.text"
    >
      {{ t('list.placeholder.noMatches', { text: searchText?.trim() }) }}
    </span>

    <template v-else-if="state === 'no-records'">
      <span :class="$style.text">{{ t('list.placeholder.noRecords') }}</span>
      <span :class="$style.hint">{{ t('list.placeholder.noRecordsHint') }}</span>
    </template>

    <span
      v-else
      :class="$style.text"
    >
      {{ t('list.placeholder.groupEmpty') }}
    </span>
  </div>
</template>

<style lang="scss" module>
  .placeholder {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    row-gap: var(--spacing-s);
    width: 100%;
    padding: var(--spacing-xxl) var(--spacing-m) var(--spacing-m);
    text-align: center;
  }

  .text {
    font-size: var(--font-16);
    font-weight: 500;
    color: var(--color-text-control-secondary-default);
    overflow-wrap: anywhere;
  }

  .hint {
    font-size: var(--font-14);
    color: var(--color-text-control-secondary-default);
  }
</style>
