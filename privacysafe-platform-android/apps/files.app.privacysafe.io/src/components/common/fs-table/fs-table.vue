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
<script lang="ts" setup>
  import { computed, type ComputedRef, inject, onBeforeMount, onBeforeUnmount, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import size from 'lodash/size';
  import isEmpty from 'lodash/isEmpty';
  import cloneDeep from 'lodash/cloneDeep';
  import { VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nTable,
    Ui3nTooltip,
    type Ui3nTableProps,
    type Ui3nTableExpose,
    type Nullable,
  } from '@v1nt1248/3nclient-lib';
  import { TaskRunner } from '@v1nt1248/3nclient-lib/utils';
  import { useFsWindowState } from '@/composables/useFsWindowState';
  import { useFsDnD } from '@/composables/useFsDnD';
  import { useAbilities } from '@/composables/useAbilities';
  import { useFsTable } from './useFsTable';
  import { useAppStore, useFsStore, useFavoriteStore } from '@/store';
  import type { AppGlobalEvents, ListingEntryExtended, FsFolderEntityEvent } from '@shared/types';
  import type { FsTableProps, FsTableEmits, FsTableSlots } from './types';
  import type { FsTableRowProps } from '@/components/common/fs-table-row/types';
  import FsTableRow from '@/components/common/fs-table-row/fs-table-row.vue';
  import OsFilesDropArea from '@/components/common/os-files-drop-area/os-files-drop-area.vue';
  import FsEntitiesDropArea from '@/components/common/fs-entities-drop-area/fs-entities-drop-area.vue';

  const props = withDefaults(defineProps<FsTableProps>(), {
    basePath: () => ({ fullPath: '', title: 'Home' }),
  });
  const emits = defineEmits<FsTableEmits>();
  defineSlots<FsTableSlots>();

  const taskRunner = new TaskRunner();

  const { t } = useI18n();
  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;

  const isLoading = ref(false);
  const currentTableWindow = computed(() => `${props.windowIndex}`) as ComputedRef<'1' | '2'>;

  const {
    currentWindowFs,
    currentWindowSortConfig,
    isSyncFolderInCurrentWindow,
    isTrashFolderInCurrentWindow,
    isSystemFolderInCurrentWindow,
  } = useFsWindowState(currentTableWindow);

  const { changeSort, prepareFolderDataTable, sortFolderData } = useFsTable(currentTableWindow);

  const appStore = useAppStore();

  const { getFolderContentFilledList, setFolderAsFavorite, unsetFolderAsFavorite, renameEntity } = useFsStore();

  const { setFavoriteFolderListValue } = useFavoriteStore();

  const table = ref<Nullable<HTMLDivElement>>(null);
  const tableComponent = ref<Nullable<Ui3nTableExpose<ListingEntryExtended>>>(null);
  const folderData = ref<Ui3nTableProps<ListingEntryExtended> | null>(null);

  const selectedFsEntities = computed(
    () => tableComponent.value?.selectedRowsArray || ([] as ListingEntryExtended[]),
  );

  const pathInfo = computed(() =>
    props.path ? `${props.basePath.title}/${props.path}` : `${props.basePath.title}`,
  );

  const sortedFolderDataBody = computed(() => {
    const { field, direction } = currentWindowSortConfig.value;
    return (folderData.value?.body?.content || []).sort((a, b) => sortFolderData(a, b, field, direction));
  }) as ComputedRef<ListingEntryExtended[]>;

  const { canDrop } = useAbilities();

  const { draggedEntities, droppableEntity, onDragstart, onDragend, isDroppable, onDragleave, onDrop } = useFsDnD(
    currentTableWindow,
    selectedFsEntities,
  );

  function isRowSelected(row: ListingEntryExtended): boolean {
    if (!tableComponent.value || isEmpty(tableComponent.value?.selectedRows)) return false;

    if (Array.isArray(tableComponent.value.selectedRows)) {
      return tableComponent.value.selectedRows.includes(row.id);
    }

    return !![...tableComponent.value.selectedRows].find(e => e.id === row.id);
  }

  function onSelectMultiple(rowIndex: number) {
    if (!isEmpty(tableComponent.value!.selectedRows)) {
      const firstSelectedEntityId = (tableComponent.value!.selectedRows as string[])[0];
      const firstSelectedEntityIndex = sortedFolderDataBody.value.findIndex(e => e.id === firstSelectedEntityId);

      if (firstSelectedEntityIndex <= rowIndex) {
        tableComponent.value!.selectedRows = cloneDeep(
          sortedFolderDataBody.value.slice(firstSelectedEntityIndex, rowIndex + 1).map(e => e.id),
        );
      } else {
        const newValue = [firstSelectedEntityId];
        newValue.push(...sortedFolderDataBody.value.slice(rowIndex, firstSelectedEntityIndex).map(e => e.id));
        tableComponent.value!.selectedRows = newValue;
      }
    }
  }

  function closeGroupActionsRow() {
    tableComponent.value && tableComponent.value.closeGroupActionsRow();
  }

  async function handleActions(action: { event: FsFolderEntityEvent; payload?: unknown }) {
    const { event, payload } = action;
    switch (event) {
      case 'go': {
        const path = props.basePath.fullPath
          ? (payload as string).replace(`${props.basePath.fullPath}/`, '')
          : (payload as string);
        emits('go', path);
        return;
      }

      case 'rename': {
        if (isTrashFolderInCurrentWindow.value || isSystemFolderInCurrentWindow.value) {
          return;
        }

        const { row, newName } = payload as { row: ListingEntryExtended; newName: string };
        await renameEntity({ fsId: props.fsId, entity: row, newName });
        await loadFolderData();
        return;
      }

      case 'update:favorite': {
        if (isTrashFolderInCurrentWindow.value || isSystemFolderInCurrentWindow.value) {
          return;
        }

        const { favoriteId, fullPath } = (payload as { row: ListingEntryExtended }).row;
        const favFolderList = favoriteId
          ? await unsetFolderAsFavorite({ fsId: props.fsId, id: favoriteId, fullPath })
          : await setFolderAsFavorite({ fsId: props.fsId, fullPath });
        setFavoriteFolderListValue(favFolderList || []);
        await loadFolderData();
        return;
      }

      case 'open:info': {
        if (isTrashFolderInCurrentWindow.value) {
          return;
        }

        // @ts-ignore
        if (size(tableComponent.value?.selectedRowsArray as ListingEntryExtended[]) > 1) {
          return;
        }

        emits('open:info', (payload as FsTableRowProps<keyof ListingEntryExtended>).row.fullPath);
        return;
      }

      case 'refresh:data': {
        await loadFolderData();
        return;
      }

      case 'go:linked-folder': {
        // XXX TODO
        console.warn(
          `This should read link, and open target folder. The second part requires some dance cause new fs should be added into fs.store`,
        );
        return;
      }
    }
  }

  async function refreshData({ path, withoutVerify }: { path: string; withoutVerify?: boolean }): Promise<void> {
    const currentFolderFullPath =
      props.basePath.fullPath && props.path
        ? `${props.basePath.fullPath}/${props.path}`
        : props.basePath.fullPath || props.path;

    console.log(`   REFRESH DATA '${currentFolderFullPath}' => `, ...arguments);
    if (path === currentFolderFullPath || withoutVerify) {
      await loadFolderData();
    }
  }

  async function loadFolderData() {
    try {
      console.log('<- START FOLDER DATA LOADING ->');
      emits('loading', true);
      isLoading.value = true;
      const { rootFolderId, path, data } = await getFolderContentFilledList({
        fsId: props.fsId,
        rootFolderId: props.rootFolderId,
        path: `${props.path}`,
        basePath: props.basePath.fullPath,
        operatingSystem: appStore.operatingSystem,
      });

      if (rootFolderId === props.rootFolderId && path === props.path) {
        taskRunner.cancelTasks();
        folderData.value = prepareFolderDataTable(data || [], props.fsId, t, isSyncFolderInCurrentWindow.value);
      }

      tableComponent.value && tableComponent.value!.closeGroupActionsRow();
    } catch (error) {
      console.error(`The loading folder ${props.basePath.fullPath} error . `, error);
    } finally {
      emits('loading', false);
      console.log('<- END FOLDER DATA LOADING ->');
      isLoading.value = false;
    }
  }

  onBeforeMount(async () => {
    bus.$emitter.on('create:folder', loadFolderData);
    bus.$emitter.on('upload:file', loadFolderData);
    bus.$emitter.on('refresh:data', refreshData);
    bus.$emitter.on('drag:end', closeGroupActionsRow);
  });

  onBeforeUnmount(() => {
    bus.$emitter.off('create:folder', loadFolderData);
    bus.$emitter.off('upload:file', loadFolderData);
    bus.$emitter.off('refresh:data', refreshData);
    bus.$emitter.off('drag:end', closeGroupActionsRow);
  });

  watch(
    () => tableComponent.value,
    () => {
      if (tableComponent.value) {
        emits('init', tableComponent.value!);
      }
    },
    { immediate: true },
  );

  watch(
    [() => props.rootFolderId, () => props.path],
    async ([rootFolderIdVal, pathVal], [rootFolderIdOldVal, pathOvalVal]) => {
      if (rootFolderIdVal !== rootFolderIdOldVal || pathVal !== pathOvalVal) {
        await loadFolderData();
      }
    },
    {
      immediate: true,
    },
  );

  watch(
    // @ts-ignore
    () => size(tableComponent.value?.selectedRowsArray as ListingEntryExtended[]),
    (val, oVal) => {
      if (val !== oVal) {
        emits('open:info', null);
      }
    },
  );
</script>

<template>
  <div
    v-if="folderData"
    ref="table"
    :class="[
      $style.fsTable,
      isInSplitMode && $style.fsTableInSplitMode,
      tableComponent?.hasGroupActionsRow && $style.fsTableShort,
      isActive && $style.fsTableActive,
    ]"
    v-on="isInSplitMode && !isActive ? { click: () => emits('make:active') } : {}"
  >
    <ui3n-table
      ref="tableComponent"
      :config="{
        ...folderData.config,
        sortOrder: currentWindowSortConfig,
        minHeightUnusedPlace: 120,
      }"
      :head="folderData.head"
      :body="{ content: sortedFolderDataBody }"
      @change:sort="changeSort"
      @select:row="emits('select:entity', $event)"
    >
      <template #group-actions="{ selectedRows }">
        <slot
          name="group-actions"
          :selected-rows="selectedRows"
        />
      </template>

      <template #row="{ row, columnStyle, rowIndex, events }">
        <fs-table-row
          :fs-id="fsId"
          :root-folder-id="rootFolderId"
          :task-runner="taskRunner"
          :row="row"
          :row-index="rowIndex"
          :is-loading-data="isLoading"
          :is-row-selected="isRowSelected(row)"
          :is-droppable="
            !isSystemFolderInCurrentWindow &&
              !!droppableEntity &&
              row.fullPath === droppableEntity &&
              !draggedEntities.includes(row.fullPath) &&
              canDrop(fsId, rootFolderId)
          "
          :column-style="columnStyle"
          :events="events"
          :window-index="windowIndex"
          @action="handleActions"
          @select:multiple="onSelectMultiple(rowIndex)"
          @dragstart="onDragstart($event, row)"
          @dragend="onDragend()"
          @dragenter="isDroppable($event, row)"
          @dragover="isDroppable($event, row)"
          @dragleave="onDragleave($event, row)"
          @drop="onDrop($event, row)"
        />
      </template>

      <template #unused-place>
        <template v-if="!isTrashFolderInCurrentWindow && !isSystemFolderInCurrentWindow">
          <div
            v-if="!isInDraggingMode"
            :class="$style.noData"
          >
            <os-files-drop-area
              :fs-id="fsId"
              :path="path"
              :is-empty-folder-mode="true"
              @loading="emits('loading', $event)"
            />
          </div>

          <fs-entities-drop-area
            v-if="isInSplitMode && !isActive && isInDraggingMode"
            :path="path || '/'"
            :droppable-entity="droppableEntity"
            @dragend="onDragend"
            @dragenter="ev => isDroppable(ev, { type: 'folder', fullPath: path || '/' } as ListingEntryExtended)"
            @dragover="ev => isDroppable(ev, { type: 'folder', fullPath: path || '/' } as ListingEntryExtended)"
            @dragleave="ev => onDragleave(ev, { type: 'folder', fullPath: path || '/' } as ListingEntryExtended)"
            @drop="ev => onDrop(ev, { type: 'folder', fullPath: path || '/' } as ListingEntryExtended)"
          />
        </template>
      </template>

      <template #no-data>
        <div
          v-if="isTrashFolderInCurrentWindow || isSystemFolderInCurrentWindow"
          :class="$style.noData"
        >
          <div :class="$style.trashNoData">
            {{ t('fs.table.folder.empty_shorttext') }}
          </div>
        </div>
      </template>
    </ui3n-table>

    <div
      v-if="isInSplitMode"
      :class="$style.path"
    >
      <ui3n-tooltip
        :content="pathInfo"
        position-strategy="fixed"
        placement="top"
      >
        <span>
          <b>[{{ currentWindowFs?.name }}]</b> {{ pathInfo.replaceAll('/', ' / ') }}
        </span>
      </ui3n-tooltip>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .fsTable {
    --dragging-content: '';

    position: relative;
    width: 100%;
    height: 100%;

    & > div:first-child {
      & > div:last-child {
        height: calc(100% - 36px);
      }
    }

    &.fsTableShort > div:first-child {
      & > div:last-child {
        height: calc(100% - 84px);
      }
    }
  }

  .fsTableInSplitMode {
    padding-bottom: 24px;

    & > div:first-child {
      & > div:last-child {
        height: calc(100% - 60px);
      }
    }

    &.fsTableShort > div:first-child {
      & > div:last-child {
        height: calc(100% - 108px);
      }
    }
  }

  .fsTableActive {
    & > div {
      --ui3n-table-header-bg-color: var(--color-bg-table-header-pressed);
    }
  }

  .noData {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .trashNoData {
    padding-top: var(--spacing-xxl);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-secondary-default);
  }

  .path {
    position: absolute;
    left: 0;
    width: 100%;
    bottom: 0;
    height: var(--spacing-ml);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-s);
    border-top: 1px solid var(--color-border-table-primary-default);

    span {
      font-size: var(--font-11);
      color: var(--color-text-control-primary-default);
      @include mixins.text-overflow-ellipsis();
    }
  }

  .droppablePlace {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: center;
    align-items: center;
    opacity: 0;
    transition: all 0.2s ease-in-out;
    background-color: transparent;
  }

  .droppablePlaceShow {
    opacity: 1;
    transition: all 0.2s ease-in-out;
    background-color: var(--color-bg-control-primary-hover);
  }
</style>
