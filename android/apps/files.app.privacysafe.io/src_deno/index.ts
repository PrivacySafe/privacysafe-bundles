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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupGlobalReportingOfUnhandledErrors } from '../shared/utils/error-handling.ts';
import { ObserversSet } from '../shared/utils/observer-utils.ts';
import type { ListingEntryExtended, StorageEvent } from '../shared/types/index.ts';
import { PICKER_SERVICE_METHODS, type PickerServiceMethod, type StorageAppDenoService } from './types.ts';
// @deno-types="../shared/utils/ipc/ipc-service.d.ts"
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
import {
  getEntityNameAndParent,
  isSafeRelativePath,
  isSameOrInside,
  isValidEntityName,
} from '../shared/utils/fs-utils/index.ts';
import { filterRpcWritableXAttrs } from './services/fs-service.utils/listing-xattrs.ts';
import { PartialDeleteError } from './services/fs-service.utils/delete-fs-entities.ts';

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

  const { getFsItem, getFsList, getFsRootFolderList, initializeFsItems } =
    await prepareFsListAndFsRootFolderList();

  const favoritesSrv = await favoritesService({ appSyncedFs, emitStorageEvent });

  const fsSyncSrv = await syncService({ appLocalFs, userSyncedFs, emitStorageEvent });

  const fsSrv = fsService({ getFsItem, favoritesSrv, trashFolderName, emitStorageEvent });

  /** Puts a changed entity of the user synced storage into the sync queue. */
  function enqueueForSync(path: string) {
    return fsSyncSrv.addSyncQueueItem({
      path: formatPath(path),
      status: 'pending',
      attempts: 0,
      lastError: '',
      lastChanged: Date.now(),
    });
  }

  async function setFolderAsFavorite({ fsId, fullPath }: { fsId: string; fullPath: string }) {
    const updatedFavorites = await fsSrv.setFolderAsFavorite({ fsId, fullPath });
    if (updatedFavorites && fsId === USER_FS) {
      await enqueueForSync(fullPath);
    }

    return updatedFavorites;
  }

  async function unsetFolderAsFavorite({ fsId, id, fullPath }: { fsId: string; id: string; fullPath: string }) {
    const updatedFavorites = await fsSrv.unsetFolderAsFavorite({ fsId, id, fullPath });
    if (updatedFavorites && fsId === USER_FS) {
      await enqueueForSync(fullPath);
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
    // attributes the GUI may set; the others (favorites, trash data) are set by the service itself
    const { allowed, rejected } = filterRpcWritableXAttrs(attrs);
    if (rejected.length > 0) {
      await w3n.log('error', `Refused to set the attributes (${rejected.join(', ')}): not allowed or invalid. `);
    }
    if (Object.keys(allowed).length === 0) {
      return;
    }

    await fsSrv.updateEntityXAttrs({ fsId, path, attrs: allowed });
    if (fsId === USER_FS) {
      await enqueueForSync(path);
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
      await enqueueForSync(path);
    }
  }

  /*
   Names and paths come from the GUI and the file pickers, so they are checked
   here: the FS utils below build paths by plain string joins.
  */
  function assertValidName(name: unknown): asserts name is string {
    if (!isValidEntityName(name)) {
      throw new Error(`Invalid name: it must not be empty, '.', '..' or contain '/' or '\\'.`);
    }
  }

  function assertSafePath(path: unknown): asserts path is string {
    if (typeof path !== 'string' || !isSafeRelativePath(formatPath(path))) {
      throw new Error(`Invalid path: it must not contain '.', '..' or empty segments.`);
    }
  }

  function assertTargetOutsideOfEntities({
    fsId,
    entities,
    targetFsId,
    targetFolder,
  }: {
    fsId: string;
    entities: Pick<ListingEntryExtended, 'fullPath' | 'type'>[];
    targetFsId: string;
    targetFolder: string;
  }) {
    assertSafePath(targetFolder);
    if (fsId !== targetFsId) {
      return;
    }
    const target = formatPath(targetFolder);
    for (const entity of entities) {
      if (entity.type === 'folder' && isSameOrInside(target, formatPath(entity.fullPath))) {
        throw new Error('A folder cannot be copied or moved into itself.');
      }
    }
  }

  async function makeFolder({ fsId, path }: { fsId: string; path: string }) {
    assertSafePath(path);
    const folderId = await fsSrv.makeFolder({ fsId, path });
    if (fsId === USER_FS) {
      await enqueueForSync(path);
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
    assertTargetOutsideOfEntities({ fsId, entities, targetFsId, targetFolder });
    const res = await fsSrv.copyEntities({ fsId, entities, targetFsId, targetFolder });
    if (targetFsId === USER_FS) {
      for (const item of res) {
        if (item.status === 'fulfilled' && item.value) {
          await enqueueForSync(item.value);
        }
      }

      await enqueueForSync(targetFolder);
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
      targetFsId === USER_FS ? await fsSrv.getSyncedStatus({ fsId: targetFsId, fullPath: newPath }) : undefined;

    if (newFsObjStatus && ['unsynced', 'behind'].includes(newFsObjStatus.state)) {
      await enqueueForSync(newPath);
    }

    const sourceParentFolderPath = formatPath(getParentFolderPathFromEntityFullPath(oldPath));
    if (fsId === USER_FS) {
      await enqueueForSync(sourceParentFolderPath);
    }

    // a move inside the synced FS does not change the moved object itself, only the entries
    // of the source and target folders, so the target folder is always queued
    const targetFolder = formatPath(getParentFolderPathFromEntityFullPath(newPath));
    if (targetFsId === USER_FS && !(fsId === USER_FS && targetFolder === sourceParentFolderPath)) {
      await enqueueForSync(targetFolder);
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
    assertSafePath(newPath);
    assertTargetOutsideOfEntities({
      fsId,
      entities: [entity],
      targetFsId,
      targetFolder: getParentFolderPathFromEntityFullPath(formatPath(newPath)),
    });
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
        await enqueueForSync(newPath);
      }
    }

    const sourceFolders = new Set(
      fsId === USER_FS
        ? entities.map(({ fullPath }) => formatPath(getParentFolderPathFromEntityFullPath(fullPath)))
        : [],
    );
    for (const sourceFolder of sourceFolders) {
      await enqueueForSync(sourceFolder);
    }

    // a move inside the synced FS does not change the moved objects themselves, only the entries
    // of the source and target folders, so the target folders are always queued
    if (targetFsId === USER_FS) {
      const targetFolders = new Set(
        newPaths.map(newPath => formatPath(getParentFolderPathFromEntityFullPath(newPath))),
      );
      for (const targetFolder of targetFolders) {
        if (!sourceFolders.has(targetFolder)) {
          await enqueueForSync(targetFolder);
        }
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
    assertTargetOutsideOfEntities({ fsId, entities, targetFsId, targetFolder });
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
      return;
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
    assertValidName(newName);
    await fsSrv.renameEntity({ fsId, entity, newName });
    const parentFolderPath = getParentFolderPathFromEntityFullPath(entity.fullPath);
    const newPath = formatPath(parentFolderPath ? `${parentFolderPath}/${newName}` : newName);
    await actionAfterMovingEntity({ fsId, oldPath: entity.fullPath, targetFsId: fsId, newPath });
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
    let mappingEntitiesPathsToNewPaths: Awaited<ReturnType<typeof fsSrv.deleteEntities>>;
    let partialFailure: PartialDeleteError | undefined;
    try {
      mappingEntitiesPathsToNewPaths = await fsSrv.deleteEntities({ fsId, entities, completely });
    } catch (err) {
      if (!(err instanceof PartialDeleteError)) {
        throw err;
      }
      // what was deleted still has to be synced; the failure is reported after that
      mappingEntitiesPathsToNewPaths = err.result;
      partialFailure = err;
    }

    if (fsId === USER_FS) {
      await enqueueDeletedEntities({
        fsId,
        entities,
        completely,
        result: mappingEntitiesPathsToNewPaths,
        failedPaths: partialFailure?.failedPaths ?? [],
        movedBackPaths: partialFailure?.movedBackPaths ?? [],
      });
    }

    if (partialFailure) {
      throw new Error(partialFailure.message);
    }
    return mappingEntitiesPathsToNewPaths;
  }

  async function enqueueDeletedEntities({
    fsId,
    entities,
    completely,
    result: mappingEntitiesPathsToNewPaths,
    failedPaths,
    movedBackPaths,
  }: {
    fsId: string;
    entities: Pick<ListingEntryExtended, 'fullPath' | 'type' | 'name'>[];
    completely?: boolean;
    result: Record<string, string> | true | undefined;
    failedPaths: string[];
    movedBackPaths: string[];
  }) {
    // Removal from the trash is complete even without the flag; the result tells what happened.
    const isRemovedCompletely = completely || mappingEntitiesPathsToNewPaths === true;
    const movedToTrash =
      mappingEntitiesPathsToNewPaths && typeof mappingEntitiesPathsToNewPaths === 'object'
        ? mappingEntitiesPathsToNewPaths
        : {};
    const processedEntities = entities.filter(e =>
      isRemovedCompletely ? !failedPaths.includes(e.fullPath) : movedToTrash[e.fullPath],
    );

    // The folders the entities were removed from have changed, and other devices must see it.
    // An entity moved to the trash and back has changed its folder and the trash as well.
    const touchedEntities = entities.filter(e => processedEntities.includes(e) || movedBackPaths.includes(e.fullPath));
    const sourceFolders = new Set(
      touchedEntities.map(e => formatPath(getParentFolderPathFromEntityFullPath(e.fullPath))),
    );
    for (const folder of sourceFolders) {
      await enqueueForSync(folder);
    }

    for (const entity of processedEntities) {
      if (entity.type === 'folder') {
        await fsSyncSrv.clearSubtreeFromQueue(formatPath(entity.fullPath));
      }
    }

    if (!isRemovedCompletely && touchedEntities.length > 0) {
      for (const entity of processedEntities) {
        const pathInTrash = movedToTrash[entity.fullPath];
        const newFsObjStatus = await fsSrv.getSyncedStatus({ fsId, fullPath: pathInTrash });
        if (newFsObjStatus && ['unsynced', 'behind'].includes(newFsObjStatus.state)) {
          await enqueueForSync(pathInTrash);
        }
      }

      await enqueueForSync(trashFolderName);
    }
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

    await enqueueForSync(trashFolderName);

    const restoredParentFolders = new Set<string>();
    for (const restoredPath of Object.values(mappingPathToRestorePath)) {
      const { parentFolder } = getEntityNameAndParent(restoredPath);
      if (!restoredParentFolders.has(parentFolder)) {
        await enqueueForSync(parentFolder);
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

    // The file pickers run as dialogs of other apps, so they get a separate
    // service with the read-only methods they need (see manifest.json).
    const srvWrapPicker = new MultiConnectionIPCWrap('AppStoragePicker');
    srvWrapPicker.exposeReqReplyMethods<Pick<StorageAppDenoService, PickerServiceMethod>>(srv, [
      ...PICKER_SERVICE_METHODS,
    ]);
    srvWrapPicker.startIPC();

    console.log('# DENO SERVICE FOR THE STORAGE APP HAS BEEN LAUNCHED #');
  })
  .catch(async err => {
    await w3n.log('error', 'Error in a startup of the storage service component. ', err);
    await sleep(10);
    w3n.closeSelf();
  });
