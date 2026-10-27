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
  import { computed, inject, onBeforeMount, onBeforeUnmount, ref, watch } from 'vue';
  import { VUEBUS_KEY, type VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { useFsStore } from '@/store';
  import { useFsWindowState } from '@/composables/useFsWindowState';
  import { USER_FS } from '@shared/constants';
  import type { AppGlobalEvents } from '@shared/types';
  import TableView from '@/components/common/table-view/table-view.vue';
  import TileView from '@/components/common/tile-view/tile-view.vue';
  import RootConflictBanner from '@/components/pages/dashboard/root-conflict-banner.vue';

  const props = defineProps<{
    windowIndex?: 1 | 2;
    tileView?: boolean;
  }>();

  const currentWindowIndex = computed(() => (!props.windowIndex || props.windowIndex === 1 ? 1 : 2));

  const { $emitter } = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { getSyncedStatus } = useFsStore();
  const { currentWindowFsId, currentWindowRootFolderId, currentWindowFolderPath } = useFsWindowState(
    computed(() => `${currentWindowIndex.value}` as '1' | '2'),
  );

  /*
   The root and the trash have their own banner above both windows (see dashboard),
   any other synced folder shows its conflict here, in the window it is open in.
  */
  const folderPath = computed(() =>
    currentWindowFsId.value === USER_FS && currentWindowRootFolderId.value === 'user-synced-root'
      ? currentWindowFolderPath.value || ''
      : '',
  );
  const isConflicting = ref(false);

  async function checkConflict() {
    const path = folderPath.value;
    if (!path) {
      isConflicting.value = false;
      return;
    }

    let state: string | undefined;
    try {
      state = (await getSyncedStatus({ fsId: USER_FS, fullPath: path }))?.state;
    } catch (err) {
      w3n.log('error', `Error checking the sync status of '${path}'. `, err);
    }
    // the window may show another folder by now
    if (path === folderPath.value) {
      isConflicting.value = state === 'conflicting';
    }
  }

  function onConflict({ path }: { path: string }) {
    if (path === folderPath.value) {
      isConflicting.value = true;
    }
  }

  function onRefresh({ path, withoutVerify }: { path: string; withoutVerify?: boolean }) {
    // a resolved conflict comes with a refresh of the folder
    if (isConflicting.value && (path === folderPath.value || withoutVerify)) {
      checkConflict();
    }
  }

  watch(folderPath, checkConflict, { immediate: true });

  onBeforeMount(() => {
    $emitter.on('sync:conflict', onConflict);
    $emitter.on('refresh:data', onRefresh);
  });

  onBeforeUnmount(() => {
    $emitter.off('sync:conflict', onConflict);
    $emitter.off('refresh:data', onRefresh);
  });
</script>

<template>
  <div :class="$style.fsFolder">
    <div
      v-if="isConflicting"
      :class="$style.banner"
    >
      <root-conflict-banner
        folder-type="folder"
        :path="folderPath"
      />
    </div>

    <div :class="$style.view">
      <tile-view
        v-if="tileView"
        :window-index="currentWindowIndex"
      />

      <table-view
        v-else
        :window-index="currentWindowIndex"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .fsFolder {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .banner {
    flex: none;
    height: var(--spacing-xxl);
  }

  .view {
    position: relative;
    flex: 1;
    min-height: 0;
  }
</style>
