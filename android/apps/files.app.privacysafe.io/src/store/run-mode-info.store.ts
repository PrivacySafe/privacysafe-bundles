/*
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
*/
import { computed, type ComputedRef, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { defineStore, storeToRefs } from 'pinia';
import isEmpty from 'lodash/isEmpty';
import size from 'lodash/size';
import { useNavigation } from '@/composables/useNavigation';
import { useAppStore, useFsStore } from '@/store';
import { getEntityNameAndParent } from '@shared/utils/fs-utils';
import type { ListingEntryExtended, RouteDouble, RouteSingle } from '@shared/types';
import type { Nullable } from '@v1nt1248/3nclient-lib';

export const useRunModeInfoStore = defineStore('run-mode-info', () => {
  const { t } = useI18n();

  const {
    route,
    isSplittedMode,
    isTileView,
    activeWindow,
    navigateToRouteSingle,
    navigateToRouteDouble,
    selectActiveWindow,
  } = useNavigation();

  const { setCommonLoading, $emitter, $createNotice } = useAppStore();

  const fsStore = useFsStore();
  const { fsFolderList } = storeToRefs(fsStore);
  const { deleteEntities, copyMoveEntities } = fsStore;

  const isDragging = ref(false);
  const isMoveMode = ref(false);
  const isMoveModeQuick = ref(false);

  const processedPath = computed(() => {
    const { path = '', path2 = '' } = route.query as RouteDouble['query'];

    if (isSplittedMode.value) {
      return activeWindow.value === '1' ? path : path2;
    }

    return path;
  });

  const parentSelectedFolder = computed(() => route.params.rootFolderId) as ComputedRef<string>;

  const currentRootFsFolder = computed(() =>
    isSplittedMode.value && activeWindow.value === '2' ? route.params.rootFolder2Id : route.params.rootFolderId,
  ) as ComputedRef<string>;

  const currentFsId = computed(() => {
    if (!currentRootFsFolder.value) {
      return null;
    }

    const fsFolder = fsFolderList.value.find(f => f.id === currentRootFsFolder.value);
    return fsFolder ? (fsFolder.fsId as string) : null;
  });

  const isCurrentRootFsFolderTrash = computed(() => currentRootFsFolder.value.includes('-trash'));

  const isCurrentRootFsFolderSystem = computed(() => currentRootFsFolder.value.includes('system-'));

  function toggleCopyMoveMode(val: boolean) {
    isMoveMode.value = val;
  }

  async function toggleView() {
    const newView = isTileView.value ? 'table' : 'tile';

    if (isSplittedMode.value) {
      return navigateToRouteDouble({
        query: { view: newView },
      });
    }

    return navigateToRouteSingle({
      query: { view: newView },
    });
  }

  async function toggleMode() {
    const { rootFolderId } = route.params as RouteSingle['params'] | RouteDouble['params'];
    const { path } = route.query as RouteSingle['query'] | RouteDouble['query'];

    if (isSplittedMode.value) {
      return navigateToRouteSingle({
        params: { rootFolderId },
        query: { path },
      });
    }

    return navigateToRouteDouble({
      params: { rootFolderId, rootFolder2Id: rootFolderId },
      query: { path, path2: '', activeWindow: '1' },
    });
  }

  async function deleteSelectedEntities({
    fsId,
    entities = [],
    completely,
  }: {
    fsId: string;
    entities: ListingEntryExtended[];
    completely?: boolean;
  }) {
    try {
      setCommonLoading(true);
      if (!isEmpty(entities)) {
        await deleteEntities({ fsId, entities, completely });
        const { parentFolder } = getEntityNameAndParent(entities[0].fullPath);
        $emitter.emit('refresh:data', { path: parentFolder || '' });
      }
    } finally {
      setCommonLoading(false);
    }
  }

  async function onDragStart(window: 1 | '1' | 2 | '2') {
    await selectActiveWindow(window);
    isDragging.value = true;
  }

  async function onDragEnd({
    sourceFsId,
    data,
    targetFsId,
    target,
  }: {
    sourceFsId: Nullable<string>;
    data: Nullable<ListingEntryExtended[]>;
    targetFsId: Nullable<string>;
    target: Nullable<ListingEntryExtended>;
  }) {
    isDragging.value = false;

    if (!sourceFsId || isEmpty(data) || !targetFsId || !target) {
      return;
    }

    const moveMode = isMoveMode.value || isMoveModeQuick.value;

    try {
      setCommonLoading(true);
      console.log('⭐ IS MOVE MODE => ', moveMode);
      console.log('⭐ INFO [TARGET] => ', JSON.stringify(target));

      await copyMoveEntities({
        sourceFsId: sourceFsId!,
        entities: data!,
        targetFsId: targetFsId!,
        target: target!,
        moveMode: moveMode,
      });

      $emitter.emit('drag:end', void 0);
      $emitter.emit('refresh:data', { path: target.fullPath });

      console.log('⭐ INFO [DATA] => ', JSON.stringify(data));

      if (moveMode && !isEmpty(data)) {
        const { parentFolder: sourceFolder } = getEntityNameAndParent(data![0].fullPath);
        console.log(`⭐ I'm here ⭐`);
        $emitter.emit('refresh:data', { path: sourceFolder });
      }

      const successMessage = moveMode
        ? t('fs.entity.message.success.move', { count: size(data) })
        : t('fs.entity.message.success.copy', { count: size(data) });

      $createNotice({
        type: 'success',
        withIcon: true,
        content: successMessage,
      });
    } catch (e) {
      console.error(e);

      const errorMessage = moveMode
        ? t('fs.entity.message.error.move', { count: size(data) })
        : t('fs.entity.message.error.copy', { count: size(data) });

      $createNotice({
        type: 'error',
        withIcon: true,
        content: errorMessage,
      });
    } finally {
      toggleCopyMoveMode(false);
      setCommonLoading(false);
    }
  }

  return {
    isDragging,
    isMoveMode,
    isMoveModeQuick,
    isTileView,
    isSplittedMode,
    activeWindow,
    processedPath,
    currentRootFsFolder,
    currentFsId,
    parentSelectedFolder,
    isCurrentRootFsFolderTrash,
    isCurrentRootFsFolderSystem,
    toggleCopyMoveMode,
    toggleView,
    toggleMode,
    deleteSelectedEntities,
    onDragStart,
    onDragEnd,
  };
});
