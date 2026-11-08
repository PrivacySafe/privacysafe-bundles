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
  import { computed, ComputedRef, ref } from 'vue';
  import { useRoute } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nTable, type Nullable, type Ui3nTableExpose } from '@v1nt1248/3nclient-lib';
  import { useSyncStore } from '@/common/stores/sync.store';
  import { useTreasuresTable } from './use-treasures-table';
  import type { SyncType, TreasureRecord } from '@shared/@types';
  import TreasuresTableRow from './treasures-table-row.vue';
  import ImagesSlider from '@/desktop/components/images-slider.vue';
  import CustomScrollBar from '@/common/components/custom-scroll-bar.vue';

  const props = defineProps<{
    selectedGroup: string;
    records: TreasureRecord[];
  }>();
  const emits = defineEmits<{
    (event: 'edit', value: TreasureRecord): void;
    (event: 'set:favorite', value: TreasureRecord): void;
  }>();

  const { t } = useI18n();
  const route = useRoute();
  const { syncProcesses } = storeToRefs(useSyncStore());

  const tableComponent = ref<Nullable<Ui3nTableExpose<TreasureRecord>>>(null);
  const optionsOfShowingImages = ref<string[] | null>(null);

  const tableSort = computed(() => {
    const { sortBy = 'name', sortOrder = 'asc' } = route.query as {
      sortBy?: 'name' | 'username';
      sortOrder: 'asc' | 'desc';
    };

    return { field: sortBy, direction: sortOrder };
  }) as ComputedRef<{ field: 'name' | 'username'; direction: 'asc' | 'desc' }>;

  const { prepareTreasuresTableData, changeSort, sortTreasuresTableData } = useTreasuresTable();

  const currentSelectedGroup = computed(() => props.selectedGroup);

  const tableData = computed(() => prepareTreasuresTableData(props.records, currentSelectedGroup));

  const sortedTableData = computed(() =>
    (tableData.value?.body?.content || []).sort((a, b) =>
      sortTreasuresTableData(a, b, tableSort.value.field, tableSort.value.direction),
    ),
  );

  function recordSyncProcess(id: string): { type: SyncType; value: number } | undefined {
    return syncProcesses.value[id];
  }
</script>

<template>
  <div :class="$style.treasuresTable">
    <custom-scroll-bar :thumb-height="240">
      <ui3n-table
        ref="tableComponent"
        :config="{
          ...tableData.config,
          sortOrder: tableSort,
        }"
        :head="tableData.head"
        :body="{ content: sortedTableData }"
        @change:sort="changeSort"
      >
        <template #row="{ row, columnStyle }">
          <treasures-table-row
            :row="row"
            :column-style="columnStyle"
            :sync-process="recordSyncProcess(row.id)"
            :selected-group="selectedGroup"
            @open="emits('edit', $event)"
            @set:favorite="emits('set:favorite', $event)"
            @show:images="(v: string[]) => (optionsOfShowingImages = v)"
          />
        </template>

        <template #unused-place>
          <div
            v-if="!sortedTableData.length"
            :class="$style.noData"
          >
            <span :class="$style.noDataText">
              {{ t('treasuresTable.nodata') }}
            </span>
          </div>
        </template>
      </ui3n-table>
    </custom-scroll-bar>

    <teleport
      v-if="optionsOfShowingImages"
      to="#main"
    >
      <images-slider
        :image-ids="optionsOfShowingImages"
        @close="() => (optionsOfShowingImages = null)"
      />
    </teleport>
  </div>
</template>

<style lang="scss" module>
  .treasuresTable {
    position: relative;
    width: 100%;
    height: 100%;

    div[class*='ui3nTable'] {
      height: auto;
      overflow: visible !important;
    }
  }

  .noData {
    position: relative;
    width: 100%;
    height: 100%;

    .noDataText {
      padding-top: var(--spacing-xxl);
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      font-size: var(--font-16);
      font-weight: 500;
      color: var(--color-text-control-secondary-default);
    }
  }
</style>
