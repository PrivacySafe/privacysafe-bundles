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
  import { computed, type ComputedRef, watch } from 'vue';
  import { storeToRefs } from 'pinia';
  import size from 'lodash/size';
  import cloneDeep from 'lodash/cloneDeep';
  import { TaskRunner } from '@v1nt1248/3nclient-lib/utils';
  import { type Ui3nCheckboxValue, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import type { ListingEntryExtended } from '@shared/types';
  import { useFsWindowState } from '@/composables/useFsWindowState';
  import { useNavigation } from '@/composables/useNavigation';
  import { useFsFolder } from '@/composables/useFsFolder';
  import { useFsDnD } from '@/composables/useFsDnD';
  import { useAbilities } from '@/composables/useAbilities';
  import { useAppStore, useRunModeInfoStore } from '@/store';
  import TileViewToolbar from '@/components/common/tile-view-toolbar/tile-view-toolbar.vue';
  import TileViewItem from '@/components/common/tile-view-item/tile-view-item.vue';
  import TableBulkActions from '@/components/common/fs-table-bulk-actions/fs-table-bulk-actions.vue';
  import OsFilesDropArea from '@/components/common/os-files-drop-area/os-files-drop-area.vue';
  import FsEntitiesDropArea from '@/components/common/fs-entities-drop-area/fs-entities-drop-area.vue';
  import isEmpty from 'lodash/isEmpty';

  const props = defineProps<{
    windowIndex: 1 | 2;
  }>();

  const taskRunner = new TaskRunner();

  const appStore = useAppStore();
  const { commonLoading } = storeToRefs(appStore);
  const { setCommonLoading } = appStore;

  const runModeInfoStore = useRunModeInfoStore();
  const { isDragging, isMoveMode, isMoveModeQuick } = storeToRefs(runModeInfoStore);
  const { toggleCopyMoveMode, onDragEnd } = runModeInfoStore;

  const currentFsFolderWindow = computed(() => props.windowIndex ? `${props.windowIndex}` as '1' | '2' : '1');

  const { isSplittedMode, activeWindow, selectActiveWindow } = useNavigation();

  const {
    currentWindowFsId,
    currentWindowFs,
    currentWindowRootFolderId,
    currentWindowFolderPath,
    currentWindowSortConfig,
    isTrashFolderInCurrentWindow,
    isSystemFolderInCurrentWindow,
  } = useFsWindowState(currentFsFolderWindow);

  const {
    t,
    fsFolderData,
    selectedEntities,
    showToolbar,
    loadFolderData,
    sortFolderData,
    isEntitySelected,
    selectEntity,
    clearSelection,
    handleActions,
    handleBulkActions,
  } = useFsFolder(currentFsFolderWindow);

  const { draggedEntities, droppableEntity, onDragstart, onDragend, isDroppable, onDragleave, onDrop } = useFsDnD(
    currentFsFolderWindow,
    selectedEntities,
  );

  const { canDrop } = useAbilities();

  const sortedFsFolderData = computed(() => {
    const { field, direction } = currentWindowSortConfig.value;
    return [...fsFolderData.value].sort((a, b) => sortFolderData(a, b, field, direction));
  }) as ComputedRef<ListingEntryExtended[]>;

  function toggleSelectedEntities(val: Ui3nCheckboxValue) {
    if (val) {
      selectedEntities.value = cloneDeep(sortedFsFolderData.value);
    } else {
      selectedEntities.value = [];
    }
  }

  function onSelectMultiple(index: number) {
    if (!isEmpty(selectedEntities.value)) {
      const firstSelectedEntity = cloneDeep(selectedEntities.value[0]);
      const firstSelectedEntityIndex = sortedFsFolderData.value.findIndex(e => e.id === firstSelectedEntity.id);

      if (firstSelectedEntityIndex <= index) {
        selectedEntities.value = cloneDeep(sortedFsFolderData.value.slice(firstSelectedEntityIndex, index + 1));
      } else {
        const newValue = [firstSelectedEntity];

        newValue.push(...sortedFsFolderData.value.slice(index, firstSelectedEntityIndex));
        selectedEntities.value = newValue;
      }
    }
  }

  watch(
    () => size(selectedEntities.value),
    (val, oVal) => {
      if (val && val > oVal && !showToolbar.value) {
        showToolbar.value = true;
      }
    },
  );

  watch(
    [currentWindowFsId, currentWindowRootFolderId, currentWindowFolderPath],
    async ([fsIdVal, folderIdVal, pathVal], [fsIdOldVal, folderIdOldVal, pathOldVal]) => {
      if (!fsIdVal) {
        return;
      }

      if (fsIdVal !== fsIdOldVal || folderIdVal !== folderIdOldVal || pathVal !== pathOldVal) {
        await loadFolderData();
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div :class="$style.tileView">
    <tile-view-toolbar
      v-if="showToolbar"
      :selected-count="size(selectedEntities)"
      :indeterminate="size(selectedEntities) > 0 && size(selectedEntities) < size(sortedFsFolderData)"
      @toggle:selected="toggleSelectedEntities"
      @cancel="clearSelection"
    >
      <table-bulk-actions
        :fs-id="currentWindowFsId as string"
        :root-folder-id="currentWindowRootFolderId"
        :folder-path="currentWindowFolderPath"
        :window-index="windowIndex"
        :is-in-split-mode="isSplittedMode"
        :selected-entities="selectedEntities"
        :is-move-mode="isMoveMode"
        :is-move-mode-quick="isMoveModeQuick"
        :disabled="commonLoading"
        @action="handleBulkActions($event, selectedEntities)"
        @update:move-mode="toggleCopyMoveMode"
      />
    </tile-view-toolbar>

    <div
      v-if="isSplittedMode"
      :class="[$style.header, activeWindow === currentFsFolderWindow && $style.headerActive]"
      @click.stop.prevent="selectActiveWindow(currentFsFolderWindow)"
    >
      {{
        activeWindow === currentFsFolderWindow ? t('fs.tile.header.text_active') : t('fs.tile.header.text_default')
      }}
    </div>

    <div :class="[$style.body, isSplittedMode && $style.bodyWithHeader, showToolbar && $style.bodyWithToolbar]">
      <div :class="[$style.content, size(sortedFsFolderData) === 0 && $style.emptyContent]">
        <template
          v-for="(item, index) in sortedFsFolderData"
          :key="item.id"
        >
          <tile-view-item
            :window-index="windowIndex"
            :fs-id="currentWindowFsId as string"
            :root-folder-id="currentWindowRootFolderId"
            :task-runner="taskRunner"
            :item="item"
            :is-selected="isEntitySelected(item)"
            :is-droppable="
              !isSystemFolderInCurrentWindow &&
                !!droppableEntity &&
                item.fullPath === droppableEntity &&
                !draggedEntities.includes(item.fullPath) &&
                canDrop(currentWindowFsId, currentWindowRootFolderId)
            "
            :disabled="commonLoading"
            @action="handleActions"
            @select="selectEntity"
            @select:multiple="onSelectMultiple(index)"
            @dragstart="onDragstart($event, item)"
            @dragend="onDragEnd"
            @dragenter="isDroppable($event, item)"
            @dragover="isDroppable($event, item)"
            @dragleave="onDragleave($event, item)"
            @drop="onDrop($event, item)"
          />
        </template>
      </div>

      <div
        v-if="!isTrashFolderInCurrentWindow && !isSystemFolderInCurrentWindow"
        :class="$style.dropzone"
      >
        <os-files-drop-area
          v-if="!isDragging && currentWindowFsId"
          :fs-id="currentWindowFsId as string"
          :path="currentWindowFolderPath"
          :is-empty-folder-mode="size(sortedFsFolderData) === 0"
          :disabled="commonLoading"
          @loading="(ev: boolean) => setCommonLoading(ev)"
        />

        <fs-entities-drop-area
          v-if="isSplittedMode && activeWindow !== currentFsFolderWindow && isDragging"
          :path="currentWindowFolderPath"
          :droppable-entity="droppableEntity"
          :disabled="commonLoading"
          @dragend="onDragend"
          @dragenter="
            ev =>
              isDroppable(ev, { type: 'folder', fullPath: currentWindowFolderPath || '/' } as ListingEntryExtended)
          "
          @dragover="
            ev =>
              isDroppable(ev, { type: 'folder', fullPath: currentWindowFolderPath || '/' } as ListingEntryExtended)
          "
          @dragleave="
            ev =>
              onDragleave(ev, { type: 'folder', fullPath: currentWindowFolderPath || '/' } as ListingEntryExtended)
          "
          @drop="
            ev => onDrop(ev, { type: 'folder', fullPath: currentWindowFolderPath || '/' } as ListingEntryExtended)
          "
        />
      </div>
    </div>

    <div
      v-if="isSplittedMode"
      :class="$style.path"
    >
      <ui3n-tooltip
        :content="currentWindowFolderPath"
        position-strategy="fixed"
        placement="top"
      >
        <span>
          <b>[{{ currentWindowFs?.name }}]</b> {{ currentWindowFolderPath.replaceAll('/', ' / ') }}
        </span>
      </ui3n-tooltip>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins.scss' as mixins;

  .tileView {
    --header-height: 64px;
    --sidebar-width: 285px;

    position: relative;
    width: 100%;
    height: 100%;
  }

  .header {
    display: flex;
    width: 100%;
    height: var(--spacing-ml);
    justify-content: center;
    align-items: center;
    background-color: var(--color-bg-table-header-default);
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-table-primary-disabled);
    cursor: pointer;

    &.headerActive {
      background-color: var(--color-bg-table-header-pressed);
      color: var(--color-text-table-primary-default);
      cursor: default;
    }
  }

  .body {
    position: relative;
    width: 100%;
    height: calc(100% - var(--spacing-m));
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    overflow-y: auto;

    &.bodyWithToolbar {
      height: calc(100% - var(--spacing-xxl) - var(--spacing-m));
    }

    &.bodyWithHeader {
      height: calc(100% - var(--spacing-xxl) - var(--spacing-m));

      &.bodyWithToolbar {
        height: calc(100% - var(--spacing-xxl) - var(--spacing-xxl) - var(--spacing-m));
      }
    }
  }

  .content {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    column-gap: var(--spacing-s);
    row-gap: var(--spacing-m);
    padding: var(--spacing-m);

    &.emptyContent {
      padding: 0;
    }
  }

  .dropzone {
    position: relative;
    display: flex;
    width: calc(100% - var(--spacing-l));
    min-height: 120px;
    flex-grow: 1;
    justify-content: center;
    align-items: center;
    margin: 0 auto;
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

  .loader {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
