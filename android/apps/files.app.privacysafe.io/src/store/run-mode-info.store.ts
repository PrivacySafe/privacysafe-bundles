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
import { computed, type ComputedRef, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { defineStore, storeToRefs } from 'pinia';
import isEmpty from 'lodash/isEmpty';
import size from 'lodash/size';
import { useNavigation } from '@/composables/useNavigation';
import { useAppStore, useFsStore } from '@/store';
import { getEntityNameAndParent } from '@shared/utils/fs-utils';
import { formatPath } from '@shared/utils/various';
import type { ListingEntryExtended, RouteDouble, RouteSingle } from '@shared/types';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import {
  type DragKind,
  type DragSource,
  getEffectiveMoveMode,
  isDropIntoItself,
  shouldResetMoveMode,
} from '@/utils/drag-and-drop';

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
  /*
   COPY/MOVE has two sources. `isMoveMode` is the toggle in the toolbar of a window
   (`moveModeWindow`): it applies to dragging the selection and stays on until that
   window shows another folder or the other window becomes active. `isMoveModeQuick`
   is the hot key held while dragging (Alt on macOS, Ctrl otherwise): the only source
   for a quick drag of an entity that is not selected.
  */
  const isMoveMode = ref(false);
  const moveModeWindow = ref<'1' | '2'>('1');
  const isMoveModeQuick = ref(false);
  const dragKind = ref<Nullable<DragKind>>(null);
  // the folders being dragged: they can be dropped neither into themselves nor into their subfolders
  const dragSource = ref<Nullable<DragSource>>(null);

  const effectiveMoveMode = computed(() =>
    getEffectiveMoveMode({
      dragKind: dragKind.value,
      isMoveMode: isMoveMode.value,
      isMoveModeQuick: isMoveModeQuick.value,
    }),
  );
  // the toggle shows only what the user chose for the selection
  const isMoveModeQuickForSelection = computed(() => dragKind.value === 'selection' && isMoveModeQuick.value);

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

  function toggleCopyMoveMode(val: boolean, window: 1 | '1' | 2 | '2' = activeWindow.value || '1') {
    isMoveMode.value = val;
    moveModeWindow.value = `${window}` as '1' | '2';
  }

  watch(
    () => ({
      folderId: route.params.rootFolderId as string | undefined,
      path: route.query.path as string | undefined,
      folder2Id: route.params.rootFolder2Id as string | undefined,
      path2: route.query.path2 as string | undefined,
      activeWindow: activeWindow.value,
    }),
    (now, before) => {
      if (
        isMoveMode.value &&
        shouldResetMoveMode({ moveModeWindow: moveModeWindow.value, isSplittedMode: isSplittedMode.value, now, before })
      ) {
        isMoveMode.value = false;
      }
    },
  );

  /** True when the target is one of the dragged folders or lies inside one of them. */
  function isDropTargetInsideDragged(targetFsId: Nullable<string>, targetPath: string): boolean {
    if (!dragSource.value || !targetFsId) {
      return false;
    }
    return isDropIntoItself({
      targetFsId,
      targetPath,
      sourceFsId: dragSource.value.fsId,
      folderPaths: dragSource.value.folderPaths,
    });
  }

  function resetDragState() {
    isDragging.value = false;
    isMoveModeQuick.value = false;
    dragKind.value = null;
    dragSource.value = null;
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
    if (isEmpty(entities)) {
      return;
    }

    try {
      setCommonLoading(true);
      await deleteEntities({ fsId, entities, completely });
    } finally {
      // refreshed after a partial failure too: some of the entities may have been deleted
      const { parentFolder } = getEntityNameAndParent(entities[0].fullPath);
      $emitter.emit('refresh:data', { path: parentFolder || '' });
      // the trash may be open in the other window
      const trashFolderName = fsStore.trashFolderName;
      if (!completely && trashFolderName && parentFolder !== trashFolderName) {
        $emitter.emit('refresh:data', { path: trashFolderName });
      }
      setCommonLoading(false);
    }
  }

  async function onDragStart(
    window: 1 | '1' | 2 | '2',
    kind: DragKind = 'selection',
    source: Nullable<DragSource> = null,
  ) {
    dragKind.value = kind;
    dragSource.value = source;
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

    const moveMode = effectiveMoveMode.value;

    // an expected case, not a failure: the Deno service would refuse it anyway
    const draggedFolders = data!.filter(e => e.type === 'folder').map(e => e.fullPath);
    if (isDropIntoItself({ targetFsId, targetPath: target.fullPath, sourceFsId, folderPaths: draggedFolders })) {
      $createNotice({
        type: 'error',
        withIcon: true,
        content: t('fs.entity.message.error.into_itself'),
      });
      return;
    }

    try {
      setCommonLoading(true);

      await copyMoveEntities({
        sourceFsId: sourceFsId!,
        entities: data!,
        targetFsId: targetFsId!,
        target: target!,
        moveMode: moveMode,
      });

      $emitter.emit('drag:end', void 0);
      // a drop onto the window area of the root comes with '/', the windows keep the root as ''
      $emitter.emit('refresh:data', { path: formatPath(target.fullPath) });

      if (moveMode && !isEmpty(data)) {
        const { parentFolder: sourceFolder } = getEntityNameAndParent(data![0].fullPath);
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
      w3n.log('error', `Error ${moveMode ? 'moving' : 'copying'} the dragged objects. `, e);

      const errorMessage = moveMode
        ? t('fs.entity.message.error.move', { count: size(data) })
        : t('fs.entity.message.error.copy', { count: size(data) });

      $createNotice({
        type: 'error',
        withIcon: true,
        content: errorMessage,
      });
    } finally {
      // the toggle stays as the user set it (see isMoveMode)
      setCommonLoading(false);
    }
  }

  return {
    isDragging,
    isMoveMode,
    isMoveModeQuick,
    isMoveModeQuickForSelection,
    moveModeWindow,
    dragKind,
    dragSource,
    effectiveMoveMode,
    isDropTargetInsideDragged,
    resetDragState,
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
