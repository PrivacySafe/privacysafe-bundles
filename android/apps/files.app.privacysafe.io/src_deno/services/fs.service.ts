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
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FavoriteFolder, FsListItem, ListingEntryExtended, StorageEvent } from '../../shared/types/index.ts';
import { FavoritesService, FsService, EntitySyncStatus } from '../types.ts';
import { USER_FS, USER_LOCAL_FS } from '../../shared/constants/index.ts';
import { executeFunc } from '../../shared/utils/execute-function.ts';
import { isThereEntityWithSameName } from './fs-service.utils/is-there-entity-with-same-name.ts';
import { updateXAttrs, removeXAttrs, getXAttrs } from './fs-service.utils/actions-on-x-attrs.ts';
import { loadFsEntityStats } from './fs-service.utils/load-fs-entity-stats.ts';
import { createFolderInFS } from './fs-service.utils/make-folder.ts';
import { loadFolderContentList } from './fs-service.utils/load-folder-content-list.ts';
import { loadFolderContentListPrepared } from './fs-service.utils/load-folder-content-list-prepared.ts';
import { copyFsEntities } from './fs-service.utils/copy-fs-entities.ts';
import { moveFsEntity } from './fs-service.utils/move-fs-entity.ts';
import { moveFsEntities } from './fs-service.utils/move-fs-entities.ts';
import { renameFsEntity } from './fs-service.utils/rename-fs-entity.ts';
import { deleteFsEntities } from './fs-service.utils/delete-fs-entities.ts';
import { restoreFsEntities as _restoreFsEntities } from './fs-service.utils/restore-fs-entities.ts';

export function fsService({
  getFsItem,
  favoritesSrv,
  emitStorageEvent,
  trashFolderName,
}: {
  getFsItem: (fsId: string) => Promise<FsListItem>;
  favoritesSrv: FavoritesService;
  emitStorageEvent: (event: StorageEvent) => void;
  trashFolderName: string;
}): FsService {
  /* beginning of the block of methods for FAVORITES  */
  async function setFolderAsFavorite({
    fsId,
    fullPath,
  }: {
    fsId: string;
    fullPath: string;
  }): Promise<FavoriteFolder[] | undefined> {
    try {
      if (!fsId.includes('-device')) {
        const { favId } = await favoritesSrv.addFavorite(fullPath, fsId);
        await updateEntityXAttrs({ fsId, path: fullPath, attrs: { favoriteId: favId } });
        return favoritesSrv.getFavorites();
      }

      return undefined;
    } catch (err) {
      w3n.log('error', `Failed to set the ${fullPath} folder as favorite. `, err);
    }
  }

  async function unsetFolderAsFavorite({
    fsId,
    id,
    fullPath,
  }: {
    fsId: string;
    id: string;
    fullPath: string;
  }): Promise<FavoriteFolder[] | undefined> {
    try {
      if (!fsId.includes('-device')) {
        const updatedFolderList = await favoritesSrv.deleteFavorite(id);
        await deleteEntityXAttrs({ fsId, path: fullPath, attrNames: ['favoriteId'] });
        return updatedFolderList;
      }

      return undefined;
    } catch (err) {
      w3n.log('error', `Failed to unset the ${fullPath} folder as favorite. `, err);
    }
  }

  async function removeFavoriteFolderFromList(id: string): Promise<FavoriteFolder[] | undefined> {
    try {
      return favoritesSrv.deleteFavorite(id);
    } catch (err) {
      w3n.log('error', `Failed while removing the favorite folder with ID ${id} from the list. `, err);
    }
  }
  /* end of block of methods for FAVORITES */

  async function isEntityPresent({
    fsId,
    path,
    type = 'folder',
  }: {
    fsId: string;
    path: string;
    type?: 'folder' | 'file' | 'link';
  }): Promise<boolean> {
    const fsItem = await getFsItem(fsId);
    return isThereEntityWithSameName({ fs: fsItem.entity, path, type });
  }

  async function getEntityXAttrs<T>({
    fsId,
    fullPath,
    attrName,
    version,
  }: {
    fsId: string;
    fullPath: string;
    attrName: string;
    version?: number;
  }): Promise<T | undefined> {
    const fsItem = await getFsItem(fsId);
    return getXAttrs<T>({ fs: fsItem.entity, fullPath, attrName, version });
  }

  async function updateEntityXAttrs({
    fsId,
    path,
    attrs,
  }: {
    fsId: string;
    path: string;
    attrs: Record<string, any | undefined>;
  }): Promise<void> {
    if (fsId.includes('-device')) {
      return;
    }

    const fsItem = await getFsItem(fsId);
    await updateXAttrs({ fs: fsItem.entity, path, attrs });

    if (fsId === USER_FS) {
      const nodeId = (await fsItem.entity.getXAttr(path, 'id')) as string | undefined;

      emitStorageEvent({
        event: 'entity:update',
        payload: { fsId, path, nodeId, changedValues: ['xAttrs'] },
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
  }): Promise<void> {
    if (fsId.includes('-device')) {
      return;
    }

    const fsItem = await getFsItem(fsId);
    await removeXAttrs({ fs: fsItem.entity, path, attrs: attrNames });

    if (fsId === USER_FS) {
      const nodeId = (await fsItem.entity.getXAttr(path, 'id')) as string | undefined;

      emitStorageEvent({
        event: 'entity:update',
        payload: { fsId, path, nodeId, changedValues: ['xAttrs'] },
      });
    }
  }

  async function getEntityStats({
    fsId,
    fullPath,
    version,
  }: {
    fsId: string;
    fullPath: string;
    version?: number;
  }): Promise<(ListingEntryExtended & { thumbnail?: string }) | undefined> {
    const fsItem = await getFsItem(fsId);
    return loadFsEntityStats({ fs: fsItem.entity, fullPath, version });
  }

  async function getSyncedStatus({
    fsId,
    fullPath,
    stopErrorPropagate,
  }: {
    fsId: string;
    fullPath: string;
    stopErrorPropagate?: boolean;
  }): Promise<EntitySyncStatus | undefined> {
    try {
      const fsListItem = await getFsItem(fsId);
      const entitySyncStatus = await executeFunc({
        fn: fsListItem.entity.v!.sync!.status.bind(fsListItem.entity.v!.sync),
        fnArgs: [fullPath],
      });

      if (entitySyncStatus.state !== 'synced') {
        return entitySyncStatus;
      }

      const entityStats = await executeFunc({
        fn: fsListItem.entity.v!.stat.bind(fsListItem.entity.v!),
        fnArgs: [fullPath],
        doesErrorPropagateStop: true,
        defaultValue: undefined as web3n.files.Stats | undefined,
      });

      if (!entityStats || (entityStats && !entityStats.isFile)) {
        return entitySyncStatus;
      }

      const isRemoteEntityOnDisk = await fsListItem.entity.v?.sync?.isRemoteVersionOnDisk(
        fullPath,
        entitySyncStatus.synced!.latest!,
      );

      return isRemoteEntityOnDisk !== 'complete'
        ? {
            ...entitySyncStatus,
            state: 'remote',
          }
        : entitySyncStatus;
    } catch (err) {
      const errorMessage = `🔥 [getSyncedStatus] Error reading the sync status for the FS object ${fullPath}. `;
      w3n.log!('error', errorMessage, err);

      if (!stopErrorPropagate) {
        throw err;
      }

      return undefined;
    }
  }

  async function isRemoteVersionOnDisk({
    fsId,
    fullPath,
    version,
    stopErrorPropagate,
  }: {
    fsId: string;
    fullPath: string;
    version: number;
    stopErrorPropagate?: boolean;
  }): Promise<'partial' | 'complete' | 'none' | undefined> {
    try {
      const fsListItem = await getFsItem(fsId);
      return fsListItem.entity.v?.sync?.isRemoteVersionOnDisk(fullPath, version);
    } catch (err) {
      const errorMessage = `🔥 [isRemoteVersionOnDisk] Error executing function on the FS object ${fullPath}. `;
      w3n.log!('error', errorMessage, err);

      if (!stopErrorPropagate) {
        throw err;
      }

      return undefined;
    }
  }

  async function makeFolder({ fsId, path }: { fsId: string; path: string }): Promise<string | undefined> {
    const fsListItem = await getFsItem(fsId);
    return createFolderInFS({ fsListItem, path });
  }

  async function getFolderContentList({
    fsId,
    path,
    version,
  }: {
    fsId: string;
    path: string;
    version?: number;
  }): Promise<web3n.files.ListingEntry[]> {
    const fsListItem = await getFsItem(fsId);
    return loadFolderContentList({ fs: fsListItem.entity, path, version });
  }

  async function getFolderContentFilledList({
    fsId,
    path,
    basePath = '',
    operatingSystem,
    version,
  }: {
    fsId: string;
    path: string;
    basePath?: string;
    operatingSystem: 'macos' | 'linux' | 'windows';
    version?: number;
  }): Promise<ListingEntryExtended[]> {
    const fsListItem = await getFsItem(fsId);
    return loadFolderContentListPrepared({
      fs: fsListItem.entity,
      path,
      basePath,
      trashFolderName,
      operatingSystem,
      version,
    });
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
  }): Promise<PromiseSettledResult<string | undefined>[]> {
    const fsListItem = await getFsItem(fsId);
    const targetFsListItem = await getFsItem(targetFsId);
    return copyFsEntities({ srcFs: fsListItem.entity, entities, targetFs: targetFsListItem.entity, targetFolder });
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
  }): Promise<string> {
    const fsListItem = await getFsItem(fsId);
    const targetFsListItem = await getFsItem(targetFsId);

    const parsedNewPath = newPath.split('/');
    const targetFolder = parsedNewPath.slice(0, -1).join('/');

    return moveFsEntity({ fsListItem, entity, targetFsListItem, targetFolder });
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
  }): Promise<Record<string, string>> {
    const fsListItem = await getFsItem(fsId);
    const targetFsListItem = await getFsItem(targetFsId);

    return moveFsEntities({ fsListItem, entities, targetFsListItem, targetFolder, favoritesSrv });
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
  }): Promise<void> {
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
  }): Promise<void> {
    const fsListItem = await getFsItem(fsId);
    await renameFsEntity({ fsListItem, entity, targetFsListItem: fsListItem, newName });
  }

  async function deleteEntities({
    fsId,
    entities,
    completely,
  }: {
    fsId: string;
    entities: Pick<ListingEntryExtended, 'fullPath' | 'type' | 'name'>[];
    completely?: boolean;
  }): Promise<Record<string, string> | boolean | undefined> {
    if (!entities || !Array.isArray(entities) || entities.length === 0) {
      throw new Error('There are no FS objects to delete.');
    }

    const fsListItem = await getFsItem(fsId);
    return deleteFsEntities({
      fsListItem,
      entities: entities as ListingEntryExtended[],
      trashFolderName,
      completely,
      favoritesSrv,
    });
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
    if (![USER_FS, USER_LOCAL_FS].includes(fsId)) {
      return;
    }

    const fsListItem = await getFsItem(fsId);
    return _restoreFsEntities({
      fsListItem,
      entities,
      trashFolderName,
      mode,
      favoritesSrv,
    });
  }

  return {
    setFolderAsFavorite,
    unsetFolderAsFavorite,
    removeFavoriteFolderFromList,

    isEntityPresent,
    getEntityXAttrs,
    updateEntityXAttrs,
    deleteEntityXAttrs,
    getEntityStats,
    getSyncedStatus,
    isRemoteVersionOnDisk,
    makeFolder,
    getFolderContentList,
    getFolderContentFilledList,
    copyEntities,
    moveEntity,
    moveEntities,
    copyMoveEntities,
    renameEntity,
    deleteEntities,
    restoreEntities,
  };
}
