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
import { shallowRef, ref, defineAsyncComponent, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { defineStore } from 'pinia';
import isEmpty from 'lodash/isEmpty';
import { appStorageSrv } from '@/services/services-provider';
import { createFileBaseOnOsFileSystemFile as _createFileBaseOnOsFileSystemFile } from './fs-operations/create-file-based-on-os-file-system-file';
import { downloadEntities as _downloadEntities } from './fs-operations/download-entities';
import { useAppStore } from '@/store/app.store';
import type { FileW, FsListItem, ListingEntryExtended, RootFsFolderView } from '@shared/types';
import { START_OF_SYSTEM_FS_ID, USER_DEVICE_FS, USER_FS, USER_LOCAL_FS } from '@shared/constants';
import { getListFolder } from '@shared/utils/fs-utils';

// Relative to the mount area provided by the platform, not an OS path.
const HOME_MOUNT_PATH = ['Home'];

const FILE_OPEN_REPEAT_DELAY_MS = 1000;
const FILE_OPEN_PENDING_LOG_DELAY_MS = 5000;

interface MountedFileOpenRequest {
  id: number;
  startedAt: number;
  mountRevision: number;
}

function isMountException(err: unknown): err is web3n.shell.mounts.MountException {
  return typeof err === 'object' && err !== null && 'type' in err && err.type === 'mount';
}

function isUnmountCleanupError(err: unknown): boolean {
  if (typeof err === 'string') {
    return err.includes('node.removeChildren is not a function');
  }

  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string' &&
    err.message.includes('node.removeChildren is not a function')
  );
}

export const useFsStore = defineStore('fs', () => {
  const { t } = useI18n();
  const appStore = useAppStore();
  const { $dialogs, $createNotice } = appStore;

  const {
    getFsList,
    getFsRootFolderList,
    initializeFsItems: _initializeFsItems,
    getTrashFolderName,
    isEntityPresent,
    getEntityStats,
    getSyncedStatus,
    makeFolder,
    moveEntity,
    moveEntities,
    copyEntities,
    copyMoveEntities,
    getFolderContentList,
    getFolderContentFilledList: _getFolderContentFilledList,
    renameEntity,
    deleteEntities,
    restoreEntities: _restoreEntities,
    setFolderAsFavorite,
    unsetFolderAsFavorite,
    removeFavoriteFolderFromList,
  } = appStorageSrv;

  const fsList = shallowRef<Record<string, FsListItem>>({});
  const fsFolderList = ref<RootFsFolderView[]>([]);

  const trashFolderName = ref<string | null>(null);
  const isMountAvailable = !!w3n.shell?.mounts;

  // Missing entries display as unmounted until an operation confirms the state.
  // This is a UI default: the platform provides no mount-status query.
  const fsMountStatus = ref<Partial<Record<string, 'mounted' | 'unmounted'>>>({});
  const fsMountBusy = ref<Record<string, boolean>>({});
  const fsMountOperations = new Map<string, Promise<void>>();
  const fsMountRequests = new Map<string, Promise<void>>();

  // Explicit controls invalidate pending opens; automatic mounting does not.
  const fsMountRevisions = new Map<string, number>();

  // Successful mounts allow delayed notMounted replies to reuse the new mount.
  const fsMountedRevisions = new Map<string, number>();

  const openingFiles = new Map<string, Map<string, MountedFileOpenRequest>>();
  let fileOpenRequestId = 0;

  function canMountFs(fsId: string): boolean {
    return isMountAvailable && (fsId === USER_FS || fsId.startsWith(START_OF_SYSTEM_FS_ID));
  }

  function getFsMountPath(fsId: string): string[] {
    if (fsId === USER_FS) {
      return [...HOME_MOUNT_PATH];
    }

    // Stable untranslated identifiers avoid collisions between system roots.
    return ['System', fsId];
  }

  async function runFsMountOperation(fsId: string, action: () => Promise<void>): Promise<void> {
    fsMountBusy.value[fsId] = true;
    const previous = fsMountOperations.get(fsId) || Promise.resolve();
    const operation = previous.then(action);
    const settledOperation = operation.then(
      () => undefined,
      () => undefined,
    );
    fsMountOperations.set(fsId, settledOperation);

    try {
      await operation;
    } finally {
      if (fsMountOperations.get(fsId) === settledOperation) {
        fsMountOperations.delete(fsId);
        fsMountBusy.value[fsId] = false;
      }
    }
  }

  async function mountFs(fsId: string): Promise<void> {
    const mounts = w3n.shell?.mounts;
    if (!mounts || !canMountFs(fsId)) {
      throw new Error('Filesystem mounting is unavailable');
    }

    const pendingMount = fsMountRequests.get(fsId);
    if (pendingMount) {
      await pendingMount;
      return;
    }

    const mounting = runFsMountOperation(fsId, async () => {
      try {
        await mounts.mountFolder(getFsMountPath(fsId), getFs(fsId));
      } catch (err) {
        if (!isMountException(err) || !err.alreadyMounted) {
          throw err;
        }
      }
      fsMountStatus.value[fsId] = 'mounted';
      fsMountedRevisions.set(fsId, (fsMountedRevisions.get(fsId) || 0) + 1);
    });
    fsMountRequests.set(fsId, mounting);

    try {
      await mounting;
    } finally {
      if (fsMountRequests.get(fsId) === mounting) {
        fsMountRequests.delete(fsId);
      }
    }
  }

  async function setFsMounted(fsId: string, mounted: boolean): Promise<void> {
    const mounts = w3n.shell?.mounts;
    if (!mounts || !canMountFs(fsId) || fsMountBusy.value[fsId]) {
      return;
    }

    console.debug('[Mount FS] mount change requested', { fsId, mounted });
    fsMountRevisions.set(fsId, (fsMountRevisions.get(fsId) || 0) + 1);

    try {
      if (mounted) {
        await mountFs(fsId);
      } else {
        await runFsMountOperation(fsId, async () => {
          try {
            await mounts.unmountFolder(getFs(fsId));
          } catch (err) {
            if (!isMountException(err) || !err.notMounted) {
              throw err;
            }
            console.debug('[Mount FS] platform reports already unmounted', { fsId });
          }
          fsMountStatus.value[fsId] = 'unmounted';
        });
      }
      console.debug('[Mount FS] mount change completed', { fsId, mounted });
      $createNotice({
        type: 'success',
        withIcon: true,
        content: t(mounted ? 'fs.mount.message.success.mount' : 'fs.mount.message.success.unmount'),
      });
    } catch (err) {
      console.error('Unable to change filesystem mount', fsId, err);
      if (!mounted && isUnmountCleanupError(err)) {
        // Keep the last confirmed state: this error does not prove an OS unmount.
        $createNotice({
          type: 'error',
          withIcon: true,
          content: t('fs.mount.message.error.unmount_unconfirmed'),
        });
        return;
      }
      $createNotice({
        type: 'error',
        withIcon: true,
        content: t(mounted ? 'fs.mount.message.error.mount' : 'fs.mount.message.error.unmount'),
      });
    }
  }

  const fsAvailableFolderList = computed(() =>
    fsFolderList.value.filter(f => {
      const { localFoldersDisplaying, systemFoldersDisplaying, deviceFoldersDisplaying } =
        appStore.appStorageSettings;
      return (
        f.fsId === USER_FS ||
        (localFoldersDisplaying && f.fsId === USER_LOCAL_FS) ||
        (deviceFoldersDisplaying && f.fsId === USER_DEVICE_FS) ||
        (systemFoldersDisplaying && f.id.includes(START_OF_SYSTEM_FS_ID))
      );
    }),
  );

  function getFs(fsId: string): web3n.files.WritableFS {
    const fs = fsList.value[fsId];
    if (!fs) {
      throw new Error(`No FS found for id ${fsId}`);
    }

    return fs.entity;
  }

  async function getFolderContentFilledList({
    fsId,
    rootFolderId,
    path,
    basePath,
    operatingSystem,
  }: {
    fsId: string;
    rootFolderId: string;
    path: string;
    basePath?: string;
    operatingSystem: 'macos' | 'linux' | 'windows';
  }): Promise<{ rootFolderId: string; path: string; data: ListingEntryExtended[] }> {
    return {
      rootFolderId,
      path,
      data: await _getFolderContentFilledList({ fsId, path, basePath, operatingSystem }),
    };
  }

  async function saveFileBaseOnOsFileSystemFile({
    fsId,
    uploadedFile,
    folderPath,
    withThumbnail,
  }: {
    fsId: string;
    uploadedFile: File;
    folderPath: string;
    withThumbnail?: boolean;
  }): Promise<void> {
    const fs = getFs(fsId);
    await _createFileBaseOnOsFileSystemFile({
      fsId,
      fs,
      uploadedFile,
      folderPath,
      withThumbnail,
    });
  }

  async function restoreEntities({ fsId, entities }: { fsId: string; entities: ListingEntryExtended[] }) {
    if (![USER_FS, USER_LOCAL_FS].includes(fsId)) {
      return;
    }

    const fs = getFs(fsId);
    const restoredParentFoldersLists = new Map<string, Set<string>>();

    const entitiesForRestore: { simple: ListingEntryExtended[]; extra: ListingEntryExtended[] } = {
      simple: [],
      extra: [],
    };

    const uniqueParentFolders = new Set<string>();
    for (const entity of entities) {
      if (typeof entity.parentFolder === 'string') {
        uniqueParentFolders.add(entity.parentFolder);
      }
    }

    await Promise.all(
      Array.from(uniqueParentFolders).map(async parentFolder => {
        const folderList =
          (await getListFolder({ fs, folderName: parentFolder, vAPI: false, stopErrorPropagate: true })) || [];

        const folderEntitiesNames = new Set(folderList.map(item => item.name));
        restoredParentFoldersLists.set(parentFolder, folderEntitiesNames);
      }),
    );

    for (const entity of entities) {
      const { originalName, parentFolder } = entity;

      if (typeof parentFolder === 'string') {
        const parentFolderEntitiesNames = restoredParentFoldersLists.get(parentFolder);
        const isEntityWithSameName = parentFolderEntitiesNames?.has(originalName!) ?? false;

        if (isEntityWithSameName) {
          entitiesForRestore.extra.push(entity);
        } else {
          entitiesForRestore.simple.push(entity);
        }
      }
    }

    if (!isEmpty(entitiesForRestore.simple)) {
      await _restoreEntities({ fsId, entities: entitiesForRestore.simple });
    }

    if (!isEmpty(entitiesForRestore.extra)) {
      const component = defineAsyncComponent(() => import('@/components/dialogs/restore-fs-entities-dialog.vue'));

      const res = await $dialogs.open<'keep' | 'replace'>(component, {
        entityNames: entitiesForRestore.extra.map(e => e.name),
        dialogProps: {
          title: t('dialog.warning.title'),
          confirmButton: false,
          cancelButton: false,
          closeOnClickOverlay: false,
        },
      });

      const { event, data } = res;
      if (event === 'confirm') {
        await _restoreEntities({ fsId, entities: entitiesForRestore.extra, mode: data });
      }
    }

    return Array.from(restoredParentFoldersLists.keys());
  }

  async function downloadEntities({
    fsId,
    entities = [],
  }: {
    fsId: string;
    entities: ListingEntryExtended[];
  }): Promise<void> {
    if (isEmpty(entities)) {
      return;
    }

    try {
      const fs = getFs(fsId);
      await _downloadEntities({ fs, entities });
      $createNotice({
        type: 'success',
        withIcon: true,
        content: t('fs.entity.message.success.download', { count: entities.length }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      $createNotice({
        type: 'error',
        withIcon: true,
        content: t('fs.entity.message.error.download', { count: entities.length }),
      });
    }
  }

  async function openFile(fsId: string, fullPath: string, isLinkPath = false) {
    const shell = w3n.shell;
    const openInMounted = shell?.openInMounted;
    const useMountedFs = !isLinkPath && !!openInMounted && canMountFs(fsId);
    let openingFsFiles = openingFiles.get(fsId);
    let openingRequest: MountedFileOpenRequest | undefined;

    if (useMountedFs) {
      if (!openingFsFiles) {
        openingFsFiles = new Map<string, MountedFileOpenRequest>();
        openingFiles.set(fsId, openingFsFiles);
      }
      const previousRequest = openingFsFiles.get(fullPath);
      const startedAt = Date.now();
      const mountRevision = fsMountRevisions.get(fsId) || 0;
      if (
        previousRequest &&
        previousRequest.mountRevision === mountRevision &&
        startedAt - previousRequest.startedAt < FILE_OPEN_REPEAT_DELAY_MS
      ) {
        console.debug('[Mount FS] duplicate open skipped', { fsId, fullPath, requestId: previousRequest.id });
        return;
      }
      openingRequest = { id: ++fileOpenRequestId, startedAt, mountRevision };
      openingFsFiles.set(fullPath, openingRequest);
      console.debug('[Mount FS] open requested', { fsId, fullPath, requestId: openingRequest.id });
    }

    // A pending platform response must not block later user attempts. Only the
    // latest request in the same mount revision may update state or retry mounting.
    function isCurrentOpeningRequest(): boolean {
      return (
        !!openingRequest &&
        openingFsFiles?.get(fullPath) === openingRequest &&
        (fsMountRevisions.get(fsId) || 0) === openingRequest.mountRevision
      );
    }

    try {
      const fs = getFs(fsId);

      if (useMountedFs && openInMounted && openingRequest) {
        const pathInFS = fullPath.split('/').filter(part => part.length > 0);
        const requestId = openingRequest.id;
        const requestMountedFileOpen = async (attempt: number): Promise<void> => {
          const details = { fsId, fullPath, requestId, attempt };
          console.debug('[Mount FS] platform open started', details);
          const pendingLogTimer = setTimeout(() => {
            console.warn('[Mount FS] platform open still pending after 5 seconds', details);
          }, FILE_OPEN_PENDING_LOG_DELAY_MS);

          try {
            await openInMounted(fs, pathInFS);
            console.debug('[Mount FS] platform open completed', details);
          } catch (err) {
            console.debug('[Mount FS] platform open failed', details, err);
            throw err;
          } finally {
            clearTimeout(pendingLogTimer);
          }
        };

        // Wait for an existing mount mutation, but never queue the OS opener.
        await fsMountOperations.get(fsId);

        if (!isCurrentOpeningRequest()) {
          console.debug('[Mount FS] superseded open skipped', { fsId, fullPath, requestId });
          return;
        }
        const mountedRevision = fsMountedRevisions.get(fsId) || 0;
        try {
          await requestMountedFileOpen(1);

          if (isCurrentOpeningRequest()) {
            fsMountStatus.value[fsId] = 'mounted';
          }

          return;
        } catch (err) {
          if (!isCurrentOpeningRequest()) {
            console.debug('[Mount FS] stale open failure ignored', { fsId, fullPath, requestId });
            return;
          }
          if (!isMountException(err) || !err.notMounted) {
            throw err;
          }
        }

        // Another open may have mounted this FS while our first response was
        // pending. Otherwise, join or start the shared mount request.
        if ((fsMountedRevisions.get(fsId) || 0) === mountedRevision) {
          fsMountStatus.value[fsId] = 'unmounted';
          await mountFs(fsId);
        }

        if (!isCurrentOpeningRequest()) {
          console.debug('[Mount FS] superseded open retry skipped', { fsId, fullPath, requestId });
          return;
        }

        // Retry once. A pending opener does not keep mount controls busy.
        try {
          await requestMountedFileOpen(2);

          if (isCurrentOpeningRequest()) {
            fsMountStatus.value[fsId] = 'mounted';
          }
        } catch (err) {
          if (!isCurrentOpeningRequest()) {
            console.debug('[Mount FS] stale open failure ignored', { fsId, fullPath, requestId });
            return;
          }
          if (isMountException(err) && err.notMounted) {
            fsMountStatus.value[fsId] = 'unmounted';
          }
          throw err;
        }
        return;
      }

      // Preserve direct opening for devices, other filesystems and resolved links.
      if (!shell?.openFile) {
        throw new Error('External file opening is unavailable');
      }

      const file = isLinkPath
        ? ((await (await fs.readLink(fullPath)).target()) as FileW)
        : await (fs.writable ? fs.writableFile(fullPath) : fs.readonlyFile(fullPath));

      await shell.openFile(file);
    } catch (err) {
      console.error('Unable to open file', err);
      $createNotice({
        type: 'error',
        withIcon: true,
        content: t('fs.entity.message.error.open', { name: fullPath.split('/').pop() || fullPath }),
      });
    } finally {
      if (openingRequest && openingFsFiles?.get(fullPath) === openingRequest) {
        openingFsFiles?.delete(fullPath);
        if (openingFsFiles?.size === 0 && openingFiles.get(fsId) === openingFsFiles) {
          openingFiles.delete(fsId);
        }
      }
    }
  }

  async function initializeFsItems(): Promise<void> {
    trashFolderName.value = await getTrashFolderName();
    if (!getFsList) {
      await _initializeFsItems();
    }

    fsList.value = await getFsList();
    fsFolderList.value = await getFsRootFolderList();
  }

  return {
    fsList,
    fsFolderList,
    fsAvailableFolderList,
    trashFolderName,
    initializeFsItems,
    getFs,
    isEntityPresent,
    getEntityStats,
    getSyncedStatus,
    makeFolder,
    moveEntity,
    moveEntities,
    copyEntities,
    copyMoveEntities,
    getFolderContentList,
    getFolderContentFilledList,
    saveFileBaseOnOsFileSystemFile,
    renameEntity,
    deleteEntities,
    restoreEntities,
    downloadEntities,
    openFile,
    setFolderAsFavorite,
    unsetFolderAsFavorite,
    removeFavoriteFolderFromList,
    isMountAvailable,
    fsMountStatus,
    fsMountBusy,
    canMountFs,
    setFsMounted,
  };
});
