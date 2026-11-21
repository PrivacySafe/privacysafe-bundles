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
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type { FolderListItem } from './types';
  import TableFileView from './table-file-view.vue';
  import TableFolderView from './table-folder-view.vue';

  const props = defineProps<{
    data: FolderListItem[];
  }>();

  const { t } = useI18n();

  const sortedData = computed(() =>
    (props.data || []).sort((a, b) => {
      const aVal = `${a.type}:${a.name}`;
      const bVal = `${b.type}:${b.name}`;
      return bVal > aVal ? 1 : -1;
    }),
  );
</script>

<template>
  <div :class="$style.folderEntitiesTable">
    <div :class="$style.header">
      <div :class="[$style.headerCell, $style.name]">
        {{ t('fs.table.header.name') }}
      </div>

      <div :class="[$style.headerCell, $style.size]">
        {{ t('fs.table.header.size') }}
      </div>

      <div :class="[$style.headerCell, $style.date]">
        {{ t('fs.table.header.date') }}
      </div>
    </div>

    <template
      v-for="entity in sortedData"
      :key="entity.name"
    >
      <table-file-view
        v-if="entity.type === 'file'"
        :item="entity"
        :level="0"
      />

      <table-folder-view
        v-if="entity.type === 'folder'"
        :item="entity"
        :level="0"
      />
    </template>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .folderEntitiesTable {
    --entity-size-width: 80px;
    --entity-date-width: 84px;
    --entity-name-width: calc(100% - var(--entity-size-width) - var(--entity-date-width));
    --folder-table-header-height: 24px;

    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns:
      minmax(var(--entity-name-width), max-content)
      var(--entity-size-width)
      var(--entity-date-width);
    align-items: start;
    grid-auto-rows: max-content;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .header {
    display: contents;
    position: relative;
    height: var(--folder-table-header-height);
    background-color: var(--color-bg-table-header-default);
  }

  .headerCell {
    position: relative;
    width: 100%;
    height: var(--folder-table-header-height);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    background-color: var(--color-bg-table-header-default);
    font-size: var(--font-12);
    font-weight: 600;
    line-height: 1;
    color: var(--color-text-table-primary-default);
  }

  .name {
    padding-left: var(--spacing-m);
  }

  .size {
    padding-left: var(--spacing-s);
  }

  .date {
    padding-left: var(--spacing-s);
  }
</style>
