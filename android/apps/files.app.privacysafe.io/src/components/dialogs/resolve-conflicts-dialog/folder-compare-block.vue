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
  import { onMounted, ref } from 'vue';
  import { Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { useFsStore } from '@/store';
  import { prepareComparativeFolderTree } from './utils';
  import { USER_FS } from '@shared/constants';
  import type { ListingEntryExtended } from '@shared/types';
  import type { FolderListItem } from './types';
  import EntityDataBlock from './entity-data-block.vue';
  import FolderEntitiesTable from './folder-entities-table.vue';
  import { EntitySyncStatus } from '@deno/types.ts';

  const props = defineProps<{
    path: string;
    parentFolder: string;
    syncStatus: EntitySyncStatus | undefined;
    statsLocal: ListingEntryExtended & { thumbnail?: string };
    statsRemote: ListingEntryExtended & { thumbnail?: string };
  }>();

  const { getFs } = useFsStore();

  const fs = getFs(USER_FS);
  const isProcessing = ref(false);
  const localFolder = ref<FolderListItem[]>([]);
  const remoteFolder = ref<FolderListItem[]>([]);

  onMounted(async () => {
    try {
      isProcessing.value = true;
      const folderDiff = await fs
        .v!.sync!.diffCurrentAndRemoteFolderVersions(props.path, props.syncStatus?.remote?.latest)
        .catch(() => undefined);
      const { localFolderTree, remoteFolderTree } = await prepareComparativeFolderTree(
        fs,
        props.path,
        props.syncStatus,
        folderDiff,
      );
      localFolder.value = localFolderTree;
      remoteFolder.value = remoteFolderTree;
    } finally {
      isProcessing.value = false;
    }
  });
</script>

<template>
  <div :class="$style.folderCompareBlock">
    <div
      v-if="isProcessing"
      :class="$style.loader"
    >
      <ui3n-progress-circular
        size="80"
        indeterminate
      />
    </div>

    <div :class="$style.block">
      <div :class="$style.blockHeader">
        <entity-data-block
          branch="cloud"
          :stats="statsRemote"
          :parent-folder="parentFolder"
          short
        />
      </div>

      <div :class="$style.blockBody">
        <folder-entities-table :data="remoteFolder" />
      </div>
    </div>

    <div :class="$style.block">
      <div :class="$style.blockHeader">
        <entity-data-block
          branch="local"
          :stats="statsLocal"
          :parent-folder="parentFolder"
          short
        />
      </div>

      <div :class="$style.blockBody">
        <folder-entities-table :data="localFolder" />
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .folderCompareBlock {
    display: flex;
    width: 100%;
    height: calc(100% - var(--spacing-m));
    justify-content: space-between;
    align-items: stretch;

    .block:first-child {
      border-right: 1px solid var(--color-border-block-primary-default);
    }
  }

  .loader {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: var(--color-bg-block-primary-default);
  }

  .block {
    --block-header-height: 56px;

    position: relative;
    width: 50%;
    height: 100%;
    padding: 0 var(--spacing-s);
  }

  .blockHeader {
    position: relative;
    width: 100%;
    height: var(--block-header-height);
    padding: var(--spacing-s) 0;
  }

  .blockBody {
    position: relative;
    width: 100%;
    height: calc(100% - var(--block-header-height));
    overflow-x: auto;

    & > div {
      padding-left: var(--spacing-xs) !important;

      & > div {
        padding-left: 0 !important;
      }
    }

    :global(::-webkit-scrollbar) {
      height: 6px;
    }

    :global(::-webkit-scrollbar-track) {
      background-color: var(--color-bg-block-primary-default);
    }

    :global(::-webkit-scrollbar-thumb) {
      background-color: var(--color-bg-control-accent-default);
      border-radius: 4px;
      min-width: 48px;
    }
  }
</style>
