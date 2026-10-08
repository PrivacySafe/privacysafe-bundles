/*
 Copyright (C) 2026 3NSoft Inc.

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
/// <reference path="../@types/platform-defs/injected-w3n.d.ts" />
// @deno-types="../../shared-libs/ipc/ipc-service.d.ts"
/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupGlobalReportingOfUnhandledErrors } from '../shared/utils/error-handling.ts';
import { ObserversSet } from '../shared/utils/observer-utils.ts';
import type { ListingEntryExtended, StorageEvent } from '../shared/types/index.ts';
import type { StorageAppDenoService } from './types.ts';
import { MultiConnectionIPCWrap } from '../shared/utils/ipc/ipc-service.js';
import { sleep } from '../shared/utils/processes/sleep.ts';
import { preInitialCleanProcedure } from './utils/pre-initial-clean-procedure.ts';
import { prepareFsListAndFsRootFolderList } from './utils/fs-and-folders.ts';
import { formatPath, getParentFolderPathFromEntityFullPath } from '../shared/utils/various.ts';
import { appConfigService } from './services/app-config.service.ts';
import { favoritesService } from './services/favorites.service.ts';
import { fsService } from './services/fs.service.ts';
import { syncService } from './services/sync.service.ts';
import { USER_FS } from '../shared/constants/index.ts';
import { getEntityNameAndParent } from '../shared/utils/fs-utils/index.ts';

async function storageAppDenoService(): Promise<StorageAppDenoService> {
  setupGlobalReportingOfUnhandledErrors(true);

  const { appLocalFs, trashFolderName, getTrashFolderName, loadConfigFile, saveConfigFile } =
    await appConfigService();
  const { userSyncedFs, appSyncedFs } = await preInitialCleanProcedure(trashFolderName);

  const updateEventsObservers = new ObserversSet<StorageEvent>();

  function emitStorageEvent(event: StorageEvent) {
    updateEventsObservers.next(event);
  }

  function watchEvent(obs: web3n.Observer<StorageEvent>): () => void {
    updateEventsObservers.add(obs);
    return () => updateEventsObservers.delete(obs);
  }

  console.log('Inside storageAppDenoService p 1');

  const { getFsItem, getFsList, getFsRootFolderList, initializeFsItems } =
    await prepareFsListAndFsRootFolderList();

  console.log('Inside storageAppDenoService p 2');

  const favoritesSrv = await favoritesService({ appSyncedFs, emitStorageEvent });

  console.log('Inside storageAppDenoService p 3');

  const fsSyncSrv = await syncService({ appLocalFs, userSyncedFs, emitStorageEvent });

  console.log('Inside storageAppDenoService p 4');

  const fsSrv = fsService({ getFsItem, favoritesSrv, trashFolderName, emitStorageEvent });

  console.log('Inside storageAppDenoService p 5');

  async function setFolderAsFavorite({ fsId, fullPath }: { fsId: string; fullPath: string }) {
    const updatedFavorites = await fsSrv.setFolderAsFavorite({ fsId, fullPath });
    if (updatedFavorites && fsId === USER_FS) {
      await fsSyncSrv.addSyncQueueItem({
        path: fullPath,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }

    return updatedFavorites;
  }

  async function unsetFolderAsFavorite({ fsId, id, fullPath }: { fsId: string; id: string; fullPath: string }) {
    const updatedFavorites = await fsSrv.unsetFolderAsFavorite({ fsId, id, fullPath });
    if (updatedFavorites && fsId === USER_FS) {
      await fsSyncSrv.addSyncQueueItem({
        path: fullPath,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }

    return updatedFavorites;
  }

  async function updateEntityXAttrs({
    fsId,
    path,
    attrs,
  }: {
    fsId: string;
    path: string;
    attrs: Record<string, any | undefined>;
  }) {
    await fsSrv.updateEntityXAttrs({ fsId, path, attrs });
    if (fsId === USER_FS) {
      await fsSyncSrv.addSyncQueueItem({
        path,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }
  }

  async function deleteEntityXAttrs({
    fsId,
    path,
    attrNames,
  }: {
    fsId: string;
    path: string;
    attrNames: string[];
  }) {
    await fsSrv.deleteEntityXAttrs({ fsId, path, attrNames });
    if (fsId === USER_FS) {
      await fsSyncSrv.addSyncQueueItem({
        path,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }
  }

  async function makeFolder({ fsId, path }: { fsId: string; path: string }) {
    const folderId = await fsSrv.makeFolder({ fsId, path });
    if (fsId === USER_FS) {
      await fsSyncSrv.addSyncQueueItem({
        path: formatPath(path),
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }

    return folderId;
  }

  async function copyEntities({
    fsId,
    entities,
    targetFsId,
    targetFolder,
  }: {
    fsId: string;
    entities: ListingEntryExtended[];
    targetFsId: string;
    targetFolder: string;
  }) {
    const res = await fsSrv.copyEntities({ fsId, entities, targetFsId, targetFolder });
    if (targetFsId === USER_FS) {
      for (const item of res) {
        if (item.status === 'fulfilled' && item.value) {
          await fsSyncSrv.addSyncQueueItem({
            path: formatPath(item.value),
            status: 'pending',
            attempts: 0,
            lastError: '',
            lastChanged: Date.now(),
          });
        }
      }

      await fsSyncSrv.addSyncQueueItem({
        path: formatPath(targetFolder),
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }

    return res;
  }

  async function actionAfterMovingEntity({
    fsId,
    oldPath,
    targetFsId,
    newPath,
  }: {
    fsId: string;
    oldPath: string;
    targetFsId: string;
    newPath: string;
  }) {
    const newFsObjStatus =
      fsId === USER_FS ? await fsSrv.getSyncedStatus({ fsId: targetFsId, fullPath: newPath }) : undefined;

    if (newFsObjStatus && ['unsynced', 'behind'].includes(newFsObjStatus.state)) {
      await fsSyncSrv.addSyncQueueItem({
        path: newPath,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }

    if (fsId === USER_FS) {
      const sourceParentFolderPath = formatPath(getParentFolderPathFromEntityFullPath(oldPath));
      await fsSyncSrv.addSyncQueueItem({
        path: sourceParentFolderPath,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }

    if (targetFsId === USER_FS && fsId !== USER_FS) {
      const targetFolder = formatPath(getParentFolderPathFromEntityFullPath(newPath));
      await fsSyncSrv.addSyncQueueItem({
        path: targetFolder,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }
  }

  async function moveEntity({
    fsId,
    entity,
    targetFsId,
    newPath,
  }: {
    fsId: string;
    entity: ListingEntryExtended;
    targetFsId: string;
    newPath: string;
  }) {
    const dstFullPath = await fsSrv.moveEntity({ fsId, entity, targetFsId, newPath });
    await actionAfterMovingEntity({ fsId, oldPath: entity.fullPath, targetFsId, newPath: dstFullPath });
    return dstFullPath;
  }

  async function actionAfterMovingEntities({
    fsId,
    entities,
    targetFsId,
    newPaths,
  }: {
    fsId: string;
    entities: ListingEntryExtended[];
    targetFsId: string;
    newPaths: string[];
  }) {
    for (const newPath of newPaths) {
      const newFsObjStatus =
        targetFsId === USER_FS ? await fsSrv.getSyncedStatus({ fsId: targetFsId, fullPath: newPath }) : undefined;
      if (newFsObjStatus && ['unsynced', 'behind'].includes(newFsObjStatus.state)) {
        await fsSyncSrv.addSyncQueueItem({
          path: newPath,
          status: 'pending',
          attempts: 0,
          lastError: '',
          lastChanged: Date.now(),
        });
      }
    }

    if (fsId === USER_FS) {
      const { fullPath } = entities[0];
      const sourceParentFolderPath = formatPath(getParentFolderPathFromEntityFullPath(fullPath));
      await fsSyncSrv.addSyncQueueItem({
        path: sourceParentFolderPath,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }

    if (targetFsId === USER_FS && fsId !== USER_FS) {
      for (const newPath of newPaths) {
        const targetFolder = formatPath(getParentFolderPathFromEntityFullPath(newPath));
        await fsSyncSrv.addSyncQueueItem({
          path: targetFolder,
          status: 'pending',
          attempts: 0,
          lastError: '',
          lastChanged: Date.now(),
        });
      }
    }
  }

  async function moveEntities({
    fsId,
    entities,
    targetFsId,
    targetFolder,
  }: {
    fsId: string;
    entities: ListingEntryExtended[];
    targetFsId: string;
    targetFolder: string;
  }) {
    const pathsMap = await fsSrv.moveEntities({ fsId, entities, targetFsId, targetFolder });
    await actionAfterMovingEntities({ fsId, entities, targetFsId, newPaths: Object.values(pathsMap) });
    return pathsMap;
  }

  async function copyMoveEntities({
    sourceFsId,
    entities,
    targetFsId,
    target,
    moveMode,
  }: {
    sourceFsId: string;
    entities: ListingEntryExtended[];
    targetFsId: string;
    target: ListingEntryExtended;
    moveMode?: boolean;
  }) {
    const { fullPath: targetPath = '' } = target;

    if (moveMode) {
      await moveEntities({
        fsId: sourceFsId,
        entities,
        targetFsId,
        targetFolder: targetPath,
      });
    }

    await copyEntities({ fsId: sourceFsId, entities, targetFsId, targetFolder: targetPath });
  }

  async function renameEntity({
    fsId,
    entity,
    newName,
  }: {
    fsId: string;
    entity: ListingEntryExtended;
    newName: string;
  }) {
    await moveEntity({ fsId, entity, targetFsId: fsId, newPath: newName });
  }

  async function deleteEntities({
    fsId,
    entities,
    completely,
  }: {
    fsId: string;
    entities: Pick<ListingEntryExtended, 'fullPath' | 'type' | 'name'>[];
    completely?: boolean;
  }) {
    const mappingEntitiesPathsToNewPaths = await fsSrv.deleteEntities({ fsId, entities, completely });

    if (fsId !== USER_FS) {
      return;
    }

    if (completely) {
      const parentFolderPath = formatPath(getParentFolderPathFromEntityFullPath(entities[0].fullPath));
      await fsSyncSrv.addSyncQueueItem({
        path: parentFolderPath,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });

      for (const entity of entities) {
        if (entity.type === 'folder') {
          await fsSyncSrv.clearSubtreeFromQueue(formatPath(entity.fullPath));
        }
      }

      return;
    }

    if (mappingEntitiesPathsToNewPaths && typeof mappingEntitiesPathsToNewPaths !== 'boolean') {
      for (const entity of entities) {
        const pathInTrash = mappingEntitiesPathsToNewPaths[entity.fullPath];
        const newFsObjStatus = await fsSrv.getSyncedStatus({ fsId, fullPath: pathInTrash });
        if (newFsObjStatus && ['unsynced', 'behind'].includes(newFsObjStatus.state)) {
          await fsSyncSrv.addSyncQueueItem({
            path: pathInTrash,
            status: 'pending',
            attempts: 0,
            lastError: '',
            lastChanged: Date.now(),
          });
        }
      }

      await fsSyncSrv.addSyncQueueItem({
        path: trashFolderName,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });
    }

    return mappingEntitiesPathsToNewPaths;
  }

  async function restoreEntities({
    fsId,
    entities,
    mode = 'keep',
  }: {
    fsId: string;
    entities: ListingEntryExtended[];
    mode?: 'keep' | 'replace';
  }) {
    const mappingPathToRestorePath = await fsSrv.restoreEntities({ fsId, entities, mode });

    if (!mappingPathToRestorePath) {
      return undefined;
    }

    await fsSyncSrv.addSyncQueueItem({
      path: trashFolderName,
      status: 'pending',
      attempts: 0,
      lastError: '',
      lastChanged: Date.now(),
    });

    const restoredParentFolders = new Set<string>();
    for (const restoredPath of Object.values(mappingPathToRestorePath)) {
      const { parentFolder } = getEntityNameAndParent(restoredPath);
      if (!restoredParentFolders.has(parentFolder)) {
        await fsSyncSrv.addSyncQueueItem({
          path: parentFolder,
          status: 'pending',
          attempts: 0,
          lastError: '',
          lastChanged: Date.now(),
        });
        restoredParentFolders.add(parentFolder);
      }
    }

    return mappingPathToRestorePath;
  }

  favoritesSrv.getFavorites().then(favorites => {
    emitStorageEvent({
      event: 'favorites:update',
      payload: { favorites },
    });
  });
  console.log('Inside storageAppDenoService p end');
  return {
    getTrashFolderName,
    loadConfigFile,
    saveConfigFile,

    ...favoritesSrv,
    ...fsSyncSrv,

    setFolderAsFavorite,
    unsetFolderAsFavorite,
    removeFavoriteFolderFromList: fsSrv.removeFavoriteFolderFromList,
    isEntityPresent: fsSrv.isEntityPresent,
    getEntityXAttrs: fsSrv.getEntityXAttrs,
    updateEntityXAttrs,
    deleteEntityXAttrs,
    getEntityStats: fsSrv.getEntityStats,
    getSyncedStatus: fsSrv.getSyncedStatus,
    isRemoteVersionOnDisk: fsSrv.isRemoteVersionOnDisk,
    makeFolder,
    getFolderContentList: fsSrv.getFolderContentList,
    getFolderContentFilledList: fsSrv.getFolderContentFilledList,
    copyEntities,
    moveEntity,
    moveEntities,
    copyMoveEntities,
    renameEntity,
    deleteEntities,
    restoreEntities,

    watchEvent,

    getFsItem,
    getFsList,
    getFsRootFolderList,
    initializeFsItems,
  };
}

storageAppDenoService()
  .then(async srv => {
    console.log('[###] DENO SERVICE 00000 [###]');
    const srvWrapInternal = new MultiConnectionIPCWrap('AppStorageInternal');

    srvWrapInternal.exposeReqReplyMethods<Omit<StorageAppDenoService, 'watchEvent'>>(srv, [
      'getTrashFolderName',
      'loadConfigFile',
      'saveConfigFile',

      'getFavorites',
      'getFavorite',
      'addFavorite',
      'updateFavorite',
      'deleteFavorite',

      'getFsItem',
      'getFsList',
      'getFsRootFolderList',

      'getSyncQueue',
      'isSyncQueueItemPresence',
      'addSyncQueueItem',
      'updateSyncQueueItem',
      'deleteSyncQueueItem',
      'clearSubtreeFromQueue',
      'resetItemAttempts',
      'startSyncUpload',
      'startSyncDownload',
      'startSyncAdopt',

      'setFolderAsFavorite',
      'unsetFolderAsFavorite',
      'removeFavoriteFolderFromList',

      'isEntityPresent',
      'getEntityXAttrs',
      'updateEntityXAttrs',
      'deleteEntityXAttrs',
      'getEntityStats',
      'getSyncedStatus',
      'isRemoteVersionOnDisk',
      'makeFolder',
      'getFolderContentList',
      'getFolderContentFilledList',
      'copyEntities',
      'moveEntity',
      'moveEntities',
      'copyMoveEntities',
      'renameEntity',
      'deleteEntities',
      'restoreEntities',
    ]);
    srvWrapInternal.exposeObservableMethods<Pick<StorageAppDenoService, 'watchEvent'>>(srv, ['watchEvent']);
    srvWrapInternal.startIPC();

    console.log('# DENO SERVICE FOR THE STORAGE APP HAS BEEN LAUNCHED #');
  })
  .catch(async err => {
    await w3n.log('error', 'Error in a startup of the storage service component. ', err);
    await sleep(10);
    w3n.closeSelf();
  });
