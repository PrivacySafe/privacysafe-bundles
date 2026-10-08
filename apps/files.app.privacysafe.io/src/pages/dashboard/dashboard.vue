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
  import { computed } from 'vue';
  import { storeToRefs } from 'pinia';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nIcon, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import { useNavigation } from '@/composables/useNavigation';
  import { useFsWindowState } from '@/composables/useFsWindowState';
  import { useDashboard } from '@/composables/useDashboard';
  import { useAbilities } from '@/composables/useAbilities';
  import { useRunModeInfoStore, useSyncQueueStore } from '@/store';
  import FolderListItem from '@/components/pages/dashboard/folder-list-item/folder-list-item.vue';
  import FavoriteListItem from '@/components/pages/dashboard/favorite-list-item/favorite-list-item.vue';
  import DashboardToolbar from '@/components/common/dashboard-toolbar/dashboard-toolbar.vue';
  import FsEntityInfo from '@/components/common/fs-entity-info/fs-entity-info.vue';
  import RootConflictBanner from '@/components/pages/dashboard/root-conflict-banner.vue';

  const { isSplittedMode, isTileView, activeWindow } = useNavigation();

  const { currentWindowFsId, currentWindowRootFolderId } = useFsWindowState(activeWindow);

  const {
    t,
    userFsFolders,
    userDeviceFsFolders,
    systemFsFolders,
    processedFavoriteFolders,
    displayedFsEntityInfo,
    isFolderSelected,
    selectFolder,
    createFolder,
    uploadFile,
    goToFavoriteFolder,
    openFsEntityInfoBlock,
  } = useDashboard();

  const { canCreateFolder, canUpload } = useAbilities();

  const runModeInfoStore = useRunModeInfoStore();
  const { isDragging, isMoveMode, isMoveModeQuick } = storeToRefs(runModeInfoStore);
  const { rootFolderSyncStatus, trashFolderSyncStatus } = storeToRefs(useSyncQueueStore());

  const showResolveConflictBanner = computed(
    () =>
      (rootFolderSyncStatus.value?.state === 'conflicting' &&
        currentWindowRootFolderId.value === 'user-synced-root') ||
      (trashFolderSyncStatus.value?.state === 'conflicting' &&
        currentWindowRootFolderId.value === 'user-synced-trash'),
  );
</script>

<template>
  <div :class="$style.dashboard">
    <div :class="$style.list">
      <div :class="$style.actions">
        <ui3n-menu
          :disabled="!canCreateFolder"
          :offset-y="4"
        >
          <ui3n-button
            icon="outline-arrow-drop-down"
            icon-size="16"
            icon-color="var(--color-icon-button-primary-default)"
            icon-position="right"
            :disabled="!canCreateFolder"
          >
            {{ t('app.create') }}
          </ui3n-button>

          <template #menu>
            <div :class="$style.createContent">
              <div
                :class="$style.createContentItem"
                @click="createFolder"
              >
                <ui3n-icon
                  icon="outline-folder"
                  :width="16"
                  :height="16"
                  color="var(--color-icon-control-primary-default)"
                />
                {{ t('app.create_folder') }}
              </div>

              <div
                v-if="canUpload(currentWindowFsId, currentWindowRootFolderId)"
                :class="$style.createContentItem"
                @click="uploadFile"
              >
                <ui3n-icon
                  icon="outline-file-upload"
                  :width="16"
                  :height="16"
                  color="var(--color-icon-control-primary-default)"
                />
                {{ t('app.upload_file') }}
              </div>
            </div>
          </template>
        </ui3n-menu>
      </div>

      <div :class="$style.listBody">
        <template
          v-for="folder in userFsFolders"
          :key="folder.id"
        >
          <folder-list-item
            :folder="folder"
            :is-selected="isFolderSelected(folder)"
            @select="selectFolder"
          />
        </template>

        <div
          v-if="size(userDeviceFsFolders)"
          :class="$style.listBlock"
        >
          <template
            v-for="folder in userDeviceFsFolders"
            :key="folder.id"
          >
            <folder-list-item
              :folder="folder"
              :is-selected="isFolderSelected(folder)"
              @select="selectFolder"
            />
          </template>
        </div>

        <div
          v-if="size(systemFsFolders)"
          :class="$style.listBlock"
        >
          <template
            v-for="folder in systemFsFolders"
            :key="folder.id"
          >
            <folder-list-item
              :folder="folder"
              :is-selected="isFolderSelected(folder)"
              @select="selectFolder"
            />
          </template>
        </div>

        <div :class="$style.favorites">
          <div :class="$style.favoritesTitle">
            <span>{{ t('app.favorites_title') }}</span>
            <ui3n-icon
              icon="round-bookmark"
              :width="16"
              :height="16"
              color="var(--color-icon-control-secondary-default)"
            />
          </div>

          <div :class="$style.favoritesContent">
            <favorite-list-item
              v-for="item in processedFavoriteFolders"
              :key="item.favId"
              :item="item"
              @go="goToFavoriteFolder"
            />
          </div>
        </div>
      </div>
    </div>

    <div :class="$style.body">
      <div :class="$style.toolbar">
        <dashboard-toolbar />
      </div>

      <div
        :class="[
          $style.content,
          isSplittedMode && $style.splittedContent,
          showResolveConflictBanner && $style.withBanner,
        ]"
      >
        <div
          v-if="showResolveConflictBanner"
          :class="$style.rootConflictBanner"
        >
          <root-conflict-banner
            :folder-type="currentWindowRootFolderId === 'user-synced-root' ? 'root' : 'trash'"
          />
        </div>

        <div :class="[$style.first, isSplittedMode && $style.double]">
          <router-view v-slot="{ Component }">
            <component
              :is="Component"
              v-if="Component"
              :window-index="1"
              :tile-view="isTileView"
            />
          </router-view>
        </div>

        <div
          v-if="isSplittedMode"
          :class="$style.second"
        >
          <router-view
            v-slot="{ Component }"
            name="second"
          >
            <component
              :is="Component"
              v-if="Component"
              :window-index="2"
              :tile-view="isTileView"
            />
          </router-view>
        </div>

        <transition
          name="fade"
          mode="in-out"
        >
          <div
            v-if="displayedFsEntityInfo"
            :class="[
              $style.info,
              displayedFsEntityInfo.windowIndex === '2' && $style.left,
              isSplittedMode && $style.splitMode,
            ]"
          >
            <fs-entity-info
              :fs-id="displayedFsEntityInfo.fsId"
              :path="displayedFsEntityInfo.path"
              @close="() => openFsEntityInfoBlock(null)"
            />
          </div>
        </transition>
      </div>
    </div>

    <div
      v-if="isDragging"
      :class="$style.draggingNotice"
    >
      <ui3n-icon
        icon="drag-pan"
        color="var(--color-icon-table-accent-default)"
      />

      {{ isMoveMode || isMoveModeQuick ? t('fs.action.moving') : t('fs.action.copying') }}
    </div>

    <div
      id="app-dragging-ghost"
      :class="$style.draggingInfo"
    >
      <ui3n-icon
        icon="drag-pan"
        color="var(--color-icon-button-primary-default)"
      />

      <span>data</span>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins.scss' as mixins;

  .dashboard {
    --dashboard-list-width: 190px;
    --dashboard-toolbar-height: 64px;

    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: stretch;
  }

  .list {
    position: relative;
    width: var(--dashboard-list-width);
    border-right: 1px solid var(--color-border-block-primary-default);
    padding: var(--spacing-s) var(--spacing-xs) var(--spacing-s) var(--spacing-s);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
  }

  .listBlock {
    position: relative;
    height: auto;
    padding: var(--spacing-s) 0;
    border-top: 1px solid var(--color-border-block-primary-default);
  }

  .favorites {
    position: relative;
    height: auto;
    flex-grow: 1;
    padding: var(--spacing-m) var(--spacing-s) 0 var(--spacing-s);
  }

  .favoritesTitle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--font-12);
    line-height: var(--font-16);
    font-weight: 600;
    color: var(--color-text-control-secondary-default);
    text-transform: uppercase;
    margin-bottom: var(--spacing-s);
  }

  .favoritesContent {
    position: relative;
    height: calc(100% - 88px);
    overflow-y: auto;
  }

  .actions {
    position: relative;
    width: 100%;
    padding: var(--spacing-s) var(--spacing-s) var(--spacing-m) var(--spacing-s);
  }

  .listBody {
    position: relative;
    width: 100%;
    padding-right: var(--spacing-xs);
    height: calc(100% - var(--dashboard-toolbar-height));
    overflow-y: auto;
  }

  .createContent {
    background-color: var(--color-bg-control-secondary-default);
    padding: var(--spacing-xs);
    border-radius: var(--spacing-xs);
    width: max-content;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    @include mixins.elevation(1);
  }

  .createContentItem {
    display: flex;
    height: var(--spacing-l);
    justify-content: flex-start;
    align-items: center;
    gap: var(--spacing-s);
    text-transform: capitalize;
    padding: 0 var(--spacing-s);
    font-size: var(--font-13);
    color: var(--color-text-control-primary-default);

    &:hover {
      color: var(--color-text-control-primary-hover);
      background-color: var(--color-bg-control-primary-hover);
      cursor: pointer;

      & > div {
        color: var(--color-text-control-accent-default) !important;
      }
    }
  }

  .body {
    position: relative;
    width: calc(100% - var(--dashboard-list-width) - 1px);
  }

  .toolbar {
    position: relative;
    width: 100%;
    height: var(--dashboard-toolbar-height);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .content {
    position: relative;
    width: 100%;
    height: calc(100% - var(--dashboard-toolbar-height) - 1px);

    &.withBanner {
      padding-top: var(--spacing-xxl);
    }
  }

  .info {
    position: absolute;
    width: 285px;
    top: var(--spacing-s);
    right: var(--spacing-s);
    bottom: var(--spacing-s);
    z-index: 5;
    border-radius: var(--spacing-xs);
    border: 1px solid var(--color-border-block-primary-default);
    @include mixins.elevation(3);

    &.splitMode {
      right: auto;
      left: calc(50% + var(--spacing-s));
    }

    &.left {
      right: auto;
      left: var(--spacing-s);

      &.splitMode {
        left: auto;
        right: calc(50% + var(--spacing-s));
      }
    }
  }

  .splittedContent {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
  }

  .rootConflictBanner {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: var(--spacing-xxl);
  }

  .first {
    position: relative;
    width: 100%;
    height: 100%;
    border-right: 1px solid var(--color-border-block-primary-default);

    &.double {
      width: calc(50% - 1px);
    }
  }

  .second {
    position: relative;
    width: 50%;
    height: 100%;
  }

  .draggingNotice {
    position: fixed;
    z-index: 50;
    width: 96px;
    height: 48px;
    left: calc(50% + 95px - 48px);
    bottom: 56px;
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-xs);
    border-radius: 12px;
    color: var(--color-text-table-primary-default);
    background-color: var(--color-bg-control-secondary-default);
    font-size: var(--font-12);
    line-height: var(--font-16);
    font-weight: 500;
  }

  .draggingInfo {
    position: absolute;
    top: -200px;
    left: -1000px;
    width: max-content;
    padding: var(--spacing-xs) var(--spacing-s);
    background-color: var(--color-bg-control-accent-default);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-12);
    color: var(--color-text-avatar-primary-default);
    border-radius: 6px;
  }
</style>
