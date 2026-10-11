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
import {
  computed,
  type ComputedRef,
  defineAsyncComponent,
  inject,
  onBeforeMount,
  onBeforeUnmount,
  ref,
} from 'vue';
import { useI18n } from 'vue-i18n';
import isEmpty from 'lodash/isEmpty';
import size from 'lodash/size';
import {
  DIALOGS_KEY,
  DialogsPlugin,
  NOTIFICATIONS_KEY,
  NotificationsPlugin,
  VUEBUS_KEY,
  VueBusPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { useNavigation } from '@/composables/useNavigation';
import { useFsWindowState } from '@/composables/useFsWindowState';
import { useSort } from '@/composables/useSort';
import { useAppStore, useFsStore, useRunModeInfoStore } from '@/store';
import { type AppGlobalEvents, FsFolderEntityEvent, ListingEntryExtended } from '@shared/types';
import type { FsTableBulkActionName } from '@/components/common/fs-table-bulk-actions/types';

export function useFsFolder(fsFolderWindow: ComputedRef<'1' | '2'>) {
  const { t } = useI18n();
  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const appStore = useAppStore();
  const { setCommonLoading } = appStore;

  const runModeInfoStore = useRunModeInfoStore();
  const { deleteSelectedEntities } = runModeInfoStore;

  const {
    getFolderContentFilledList,
    downloadEntities,
    renameEntity,
    restoreEntities,
    setFolderAsFavorite,
    unsetFolderAsFavorite,
  } = useFsStore();

  const {
    isSplittedMode,
    window1FsId,
    window1FolderPath,
    window2FsId,
    window2FolderPath,
    navigateToRouteSingle,
    navigateToRouteDouble,
  } = useNavigation();

  const {
    currentWindowFsId,
    currentWindowRootFolderId,
    currentWindowFolderPath,
    currentWindowRootFolderBasePath,
    isTrashFolderInCurrentWindow,
    isSystemFolderInCurrentWindow,
  } = useFsWindowState(fsFolderWindow);

  const { changeSort, sortFolderData } = useSort(fsFolderWindow);

  const fsFolderData = ref<ListingEntryExtended[]>([]);
  const selectedEntities = ref<ListingEntryExtended[]>([]);
  const showToolbar = ref(false);

  const isNoDataInFolder = computed(() => isEmpty(selectedEntities.value));

  async function getFsFolderData(
    window: '1' | '2',
    basePath = '',
  ): Promise<{ rootFolderId: string; path: string; data: ListingEntryExtended[] }> {
    const fsId = (window === '1' ? window1FsId.value! : window2FsId.value!) as string;
    const path = window === '1' ? window1FolderPath.value : window2FolderPath.value!;
    return getFolderContentFilledList({
      fsId,
      rootFolderId: currentWindowRootFolderId.value,
      path,
      basePath,
      operatingSystem: appStore.operatingSystem,
    });
  }

  async function refreshData({ path, withoutVerify }: { path: string; withoutVerify?: boolean }): Promise<void> {
    if (path === currentWindowFolderPath.value || withoutVerify) {
      await loadFolderData();
    }
  }

  async function loadFolderData() {
    try {
      setCommonLoading(true);

      const { rootFolderId, path, data } = await getFsFolderData(
        fsFolderWindow.value,
        currentWindowRootFolderBasePath.value,
      );
      const currentPath = fsFolderWindow.value === '1' ? window1FolderPath.value : window2FolderPath.value!;

      if (rootFolderId === currentWindowRootFolderId.value && path === currentPath) {
        fsFolderData.value = data;
      }
    } finally {
      setCommonLoading(false);
    }
  }

  function isEntitySelected(entity: ListingEntryExtended): boolean {
    return !!selectedEntities.value.find(e => e.id === entity.id!);
  }

  function selectEntity(entity: ListingEntryExtended) {
    const currentEntitySelectedIndex = selectedEntities.value.findIndex(e => e.id === entity.id!);
    if (currentEntitySelectedIndex === -1) {
      selectedEntities.value.push(entity);
    } else {
      selectedEntities.value.splice(currentEntitySelectedIndex, 1);
    }
  }

  function clearSelection() {
    selectedEntities.value = [];
    showToolbar.value = false;
  }

  async function handleActions(action: { event: FsFolderEntityEvent; payload?: unknown }) {
    const { event, payload } = action;
    switch (event) {
      case 'go': {
        const path = currentWindowRootFolderBasePath.value
          ? (payload as string).replace(`${currentWindowRootFolderBasePath.value}/`, '')
          : (payload as string);

        if (isSplittedMode.value) {
          return navigateToRouteDouble({
            query: {
              ...(fsFolderWindow.value === '1' && { path }),
              ...(fsFolderWindow.value === '2' && { path2: path }),
            },
          });
        }

        return navigateToRouteSingle({
          params: { rootFolderId: currentWindowRootFolderId.value },
          query: { path },
        });
      }

      case 'rename': {
        if (isTrashFolderInCurrentWindow.value || isSystemFolderInCurrentWindow.value) return;

        const { entity, newName } = payload as { entity: ListingEntryExtended; newName: string };
        await renameEntity({ fsId: currentWindowFsId.value as string, entity, newName });
        await loadFolderData();
        return;
      }

      case 'update:favorite': {
        if (isTrashFolderInCurrentWindow.value || isSystemFolderInCurrentWindow.value) return;

        const { favoriteId, fullPath } = (payload as { entity: ListingEntryExtended }).entity;
        if (favoriteId) {
          await unsetFolderAsFavorite({ fsId: currentWindowFsId.value as string, id: favoriteId, fullPath });
        } else {
          await setFolderAsFavorite({ fsId: currentWindowFsId.value as string, fullPath });
        }
        await loadFolderData();
        return;
      }
    }
  }

  async function handleBulkActions(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    { action, payload }: { action: FsTableBulkActionName; payload?: unknown },
    entities: ListingEntryExtended[],
  ) {
    switch (action) {
      case 'delete':
        await deleteSelectedEntities({ fsId: currentWindowFsId.value as string, entities, completely: false });
        break;

      case 'delete:completely': {
        const component = defineAsyncComponent(() => import('@/components/dialogs/confirmation-dialog.vue'));

        const dialogRes = await dialogs.$openDialog(component, {
          dialogText: t('fs.permanently_delete.warning1'),
          additionalDialogText: t('fs.permanently_delete.warning2'),
          dialogProps: {
            title: t('fs.permanently_delete.title'),
            confirmButtonText: t('fs.permanently_delete.button.confirm'),
            confirmButtonBackground: 'var(--error-content-default)',
            confirmButtonColor: 'var(--error-fill-default)',
          },
        });
        if (dialogRes.event === 'confirm') {
          try {
            await deleteSelectedEntities({ fsId: currentWindowFsId.value as string, entities, completely: true });

            notifications.$createNotice({
              type: 'info',
              withIcon: true,
              content: t('fs.entity.message.success.delete', { count: entities.length }),
            });
          } catch (err) {
            w3n.log('error', err as string);

            notifications.$createNotice({
              type: 'error',
              withIcon: true,
              content: t('fs.entity.message.error.delete', { count: `${entities.length}` }),
            });
          }
        }

        break;
      }

      case 'restore': {
        let res;
        try {
          res = await restoreEntities({ fsId: currentWindowFsId.value as string, entities });
          if (size(res) > 0) {
            const entitiesParentFolders = entities.map(e => e.parentFolder);
            const isCurrentProcessedPathParent = entitiesParentFolders.find(
              p => p === currentWindowFolderPath.value,
            );
            if (isCurrentProcessedPathParent) {
              bus.$emitter.emit('refresh:data', { path: currentWindowFolderPath.value });
            }
            bus.$emitter.emit('refresh:data', { path: appStore.trashFolderName });

            notifications.$createNotice({
              type: 'success',
              withIcon: true,
              content: t('fs.entity.message.success.restore', { count: size(res) }),
            });
          }
        } catch (err) {
          w3n.log('error', err as string);
          notifications.$createNotice({
            type: 'error',
            withIcon: true,
            content: t('fs.entity.message.error.restore', { count: size(res) }),
          });
        }
        break;
      }

      case 'download':
        await downloadEntities({ fsId: currentWindowFsId.value as string, entities });
        break;

      case 'resolve':
        break;
    }
  }

  onBeforeMount(() => {
    bus.$emitter.on('create:folder', loadFolderData);
    bus.$emitter.on('upload:file', loadFolderData);
    bus.$emitter.on('refresh:data', refreshData);
    bus.$emitter.on('drag:end', clearSelection);
  });

  onBeforeUnmount(() => {
    bus.$emitter.off('create:folder', loadFolderData);
    bus.$emitter.off('upload:file', loadFolderData);
    bus.$emitter.off('refresh:data', refreshData);
    bus.$emitter.off('drag:end', clearSelection);
  });

  return {
    t,
    fsFolderData,
    selectedEntities,
    showToolbar,
    isNoDataInFolder,

    loadFolderData,
    changeSort,
    sortFolderData,
    isEntitySelected,
    selectEntity,
    clearSelection,
    handleActions,
    handleBulkActions,
  };
}
