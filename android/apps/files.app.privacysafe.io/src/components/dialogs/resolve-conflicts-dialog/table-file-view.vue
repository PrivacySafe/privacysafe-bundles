<!--
 Copyright (C) 2025 3NSoft Inc.

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
  import dayjs from 'dayjs';
  import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nIcon, Ui3nTitle } from '@v1nt1248/3nclient-lib';
  import type { FolderListItem } from './types';

  const vUi3nTitle = Ui3nTitle;

  const props = defineProps<{
    item: FolderListItem;
    level: number;
  }>();
</script>

<template>
  <div :class="[$style.tableFileView, item?.diversity && $style.highlight]">
    <div :class="[$style.rowCell, $style.name]">
      <ui3n-icon
        icon="round-subject"
        size="16"
        :color="item.diversity ? 'var(--success-content-default)' : 'var(--color-icon-control-secondary-default)'"
      />

      <span
        v-ui3n-title="{
          text: item.name,
          bgColor: 'var(--color-bg-block-tritery-default)',
          color: 'var(--color-text-block-darkery-default)',
        }"
      >
        {{ item.name }}
      </span>
    </div>

    <div :class="[$style.rowCell, $style.size]">
      {{ item.size ? formatFileSize(item.size) : '' }}
    </div>

    <div :class="[$style.rowCell, $style.date]">
      {{ item.mtime ? dayjs(item.mtime).format('YYYY-MM-DD HH:mm:ss') : '' }}
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .tableFileView {
    --file-level: v-bind(props.level);
    --file-row-height: 32px;

    position: relative;
    display: contents;
    height: var(--file-row-height);
    justify-content: flex-start;
    align-items: center;

    &.highlight {
      background-color: var(--success-fill-default);
    }
  }

  .rowCell {
    position: relative;
    width: 100%;
    height: var(--file-row-height);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    font-size: var(--font-10);
    font-weight: 600;
    line-height: 1;
    color: var(--color-text-table-primary-default);
    border-left: 1px solid var(--color-border-table-primary-pressed);
    border-right: 1px solid var(--color-border-table-primary-pressed);
    border-bottom: 1px solid var(--color-border-table-primary-pressed);
  }

  .name {
    column-gap: var(--spacing-xs);
    padding-left: calc(var(--spacing-m) + var(--file-level) * 8px);
    padding-right: var(--spacing-s);

    span {
      display: block;
      @include mixins.text-overflow-ellipsis(calc(100% - 20px));
    }
  }

  .size {
    width: var(--entity-size-width);
    min-width: var(--entity-size-width);
    padding-left: var(--spacing-s);
  }

  .date {
    width: var(--entity-date-width);
    min-width: var(--entity-date-width);
    padding-left: var(--spacing-s);
    line-height: var(--font-13);
  }
</style>
