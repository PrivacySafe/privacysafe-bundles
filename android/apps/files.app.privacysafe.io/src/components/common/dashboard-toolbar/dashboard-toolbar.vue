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
  import { computed, inject } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useNavigation } from '@/composables/useNavigation';
  import { useFsStore, useRunModeInfoStore } from '@/store';
  import { USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER } from '@shared/constants';
  import type { FsEntityInfoProvideProps } from '@shared/types';
  import FsSystemsSelector from '@/components/common/dashboard-toolbar/fs-systems-selector.vue';
  import SortingSelector from '@/components/common/dashboard-toolbar/sorting-selector.vue';
  import FolderPath from '@/components/common/dashboard-toolbar/folder-path.vue';

  const { t } = useI18n();

  const { isTileView, isSplittedMode, activeWindow, navigateToRouteSingle, navigateToRouteDouble } =
    useNavigation();

  const { fsAvailableFolderList } = storeToRefs(useFsStore());

  const runModeInfoStore = useRunModeInfoStore();
  const { processedPath, currentRootFsFolder, isCurrentRootFsFolderTrash } = storeToRefs(runModeInfoStore);
  const { toggleView, toggleMode } = runModeInfoStore;

  const { openFsEntityInfoBlock } = inject<FsEntityInfoProvideProps>('fsEntityInfo')!;

  const availableFsFolders = computed(() =>
    fsAvailableFolderList.value.filter(fsFolder =>
      isSplittedMode.value ? ![USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(fsFolder.id) : true,
    ),
  );

  function changeFsFolder(id: string) {
    openFsEntityInfoBlock(null);

    if (isSplittedMode.value) {
      return navigateToRouteDouble({
        params: {
          ...(activeWindow.value === '1' && { rootFolderId: id }),
          ...(activeWindow.value === '2' && { rootFolder2Id: id }),
        },
        query: {
          view: isTileView.value ? 'tile' : 'table',
          ...(activeWindow.value === '1' && { path: '' }),
          ...(activeWindow.value === '2' && { path2: '' }),
        },
      });
    }

    return navigateToRouteSingle({
      params: { rootFolderId: id },
      query: { view: isTileView.value ? 'tile' : 'table' },
    });
  }
</script>

<template>
  <div :class="[$style.dashboardToolbar, activeWindow === '2' && $style.reverse]">
    <div
      :class="[
        $style.block,
        activeWindow === '2' && $style.reverse,
        $style.breadcrumbsBlock,
        isTileView && $style.tileBreadcrumbsBlock,
        isCurrentRootFsFolderTrash && $style.breadcrumbsBlockLong,
      ]"
    >
      <fs-systems-selector
        :model-value="currentRootFsFolder"
        :available-fs-folders="availableFsFolders"
        @update:model-value="changeFsFolder"
      />

      <div :class="$style.path">
        <folder-path
          :current-fs-folder="currentRootFsFolder"
          :path="processedPath"
        />
      </div>
    </div>

    <div :class="[$style.block, activeWindow === '2' && $style.reverse]">
      <sorting-selector
        v-if="isTileView"
        :class="$style.withOffset"
      />

      <ui3n-tooltip
        :content="
          isTileView ? t('dashboard.toolbar.tooltip.table_view') : t('dashboard.toolbar.tooltip.tile_view')
        "
        position-strategy="fixed"
        placement="top-end"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="isTileView ? 'rectangles-two' : 'squares-four'"
          icon-color="var(--color-icon-button-secondary-default)"
          @click="toggleView"
        />
      </ui3n-tooltip>

      <template v-if="!isCurrentRootFsFolderTrash">
        <ui3n-tooltip
          :content="
            isSplittedMode ? t('dashboard.toolbar.tooltip.simple_mode') : t('dashboard.toolbar.tooltip.split_mode')
          "
          position-strategy="fixed"
          placement="top-end"
        >
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            :icon="isSplittedMode ? 'round-check-box-outline-blank' : 'splitscreen-right'"
            icon-color="var(--color-icon-button-secondary-default)"
            @click="toggleMode"
          />
        </ui3n-tooltip>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
  .dashboardToolbar {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-m);
    column-gap: var(--spacing-s);
  }

  .reverse {
    flex-direction: row-reverse;
  }

  .block {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    height: 100%;

    button[disabled] {
      opacity: 0.5;
    }
  }

  .breadcrumbsBlock {
    width: calc(100% - 64px);

    &.tileBreadcrumbsBlock {
      width: calc(100% - 210px);
    }
  }

  .breadcrumbsBlockLong {
    width: calc(100% - 32px);

    &.tileBreadcrumbsBlock {
      width: calc(100% - 180px);
    }
  }

  .path {
    position: relative;
    width: calc(100% - 220px);
    height: 100%;
    margin-left: var(--spacing-xs);
  }

  .withOffset {
    margin-right: var(--spacing-xs);
  }
</style>
