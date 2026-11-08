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
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import dayjs from 'dayjs';
  import { Ui3nIcon, Ui3nTitle } from '@v1nt1248/3nclient-lib';
  import type { FolderListItem } from './types';
  import TableFileView from './table-file-view.vue';
  import TableFolderView from './table-folder-view.vue';

  const vUi3nTitle = Ui3nTitle;

  const props = defineProps<{
    item: FolderListItem;
    level: number;
  }>();

  const { t } = useI18n();

  const isFolderExpanded = ref(false);

  const childrenSorted = computed(() =>
    (props.item.children || []).sort((a, b) => {
      const aVal = `${a.type}:${a.name}`;
      const bVal = `${b.type}:${b.name}`;
      return bVal > aVal ? 1 : -1;
    }),
  );
</script>

<template>
  <div :class="$style.tableFolderViewWrapper">
    <div
      :class="[$style.tableFolderView, item?.diversity && $style.highlight]"
      @click.stop.prevent="isFolderExpanded = !isFolderExpanded"
    >
      <div :class="[$style.rowCell, $style.name]">
        <ui3n-icon
          :icon="isFolderExpanded ? 'round-keyboard-arrow-down' : 'round-keyboard-arrow-right'"
          size="16"
          :color="
            item.diversity ? 'var(--success-content-default)' : 'var(--color-icon-control-secondary-default)'
          "
          :class="$style.icon"
        />

        <ui3n-icon
          icon="round-folder"
          size="16"
          :color="
            item.diversity ? 'var(--success-content-default)' : 'var(--color-icon-control-secondary-default)'
          "
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

      <div :class="[$style.rowCell, $style.size]" />

      <div :class="[$style.rowCell, $style.date]">
        {{ item.mtime ? dayjs(item.mtime).format('YYYY-MM-DD HH:mm:ss') : '' }}
      </div>
    </div>

    <template v-if="isFolderExpanded">
      <template v-if="childrenSorted.length">
        <transition-group name="fade">
          <template
            v-for="entity in childrenSorted"
            :key="entity.name"
          >
            <table-folder-view
              v-if="entity.type === 'folder'"
              :item="entity"
              :level="level + 1"
            />

            <table-file-view
              v-if="entity.type === 'file'"
              :item="entity"
              :level="level + 1"
            />
          </template>
        </transition-group>
      </template>

      <div
        v-else
        :class="$style.emptyFolder"
      >
        <div :class="[$style.rowCell, $style.name, $style.nameEmpty]">
          {{ t('fs.table.folder.empty_shorttext') }}
        </div>

        <div :class="[$style.rowCell, $style.size, $style.sizeEmpty]" />

        <div :class="[$style.rowCell, $style.date, $style.dateEmpty]" />
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .tableFolderViewWrapper {
    --folder-level: v-bind(props.level);
    --folder-row-height: 32px;

    display: contents;
  }

  .tableFolderView {
    position: relative;
    display: contents;
    width: 100%;
    cursor: pointer;

    &.highlight {
      background-color: var(--success-fill-default);
    }
  }

  .rowCell {
    position: relative;
    width: 100%;
    height: var(--folder-row-height);
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

  .icon {
    position: absolute;
    left: calc(var(--folder-level) * 8px);
    top: calc((var(--folder-row-height) - 16px) / 2);
  }

  .name {
    column-gap: var(--spacing-xs);
    padding-left: calc(var(--spacing-m) + var(--folder-level) * 8px);

    span {
      display: block;
      @include mixins.text-overflow-ellipsis(calc(100% - 20px));
    }

    &.nameEmpty {
      width: calc(100% + var(--entity-size-width) + var(--entity-date-width));
      font-style: italic;
      color: var(--color-text-table-secondary-default);
      background-color: var(--color-bg-block-primary-default);
      border-right: none;
      justify-content: center;
    }
  }

  .size {
    width: var(--entity-size-width);
    min-width: var(--entity-size-width);
    padding-left: var(--spacing-s);

    &.sizeEmpty {
      border-left: none;
      border-right: none;
    }
  }

  .date {
    width: var(--entity-date-width);
    min-width: var(--entity-date-width);
    padding-left: var(--spacing-s);
    line-height: var(--font-13);

    &.dateEmpty {
      border-left: none;
    }
  }

  .emptyFolder {
    position: relative;
    display: contents;
  }
</style>
