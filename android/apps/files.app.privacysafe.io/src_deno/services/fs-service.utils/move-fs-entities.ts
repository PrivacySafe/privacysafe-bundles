/*
 Copyright (C) 2024-2025 3NSoft Inc.

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
/// <reference path="../../../@types/platform-defs/injected-w3n.d.ts" />
import { moveFsEntity } from './move-fs-entity.ts';
import { getEntityTargetPath } from './get-entity-target-path.ts';
import type { FsListItem, ListingEntryExtended } from '../../../shared/types/index.ts';
import type { FavoritesService } from '../../types.ts';

export async function moveFsEntities({
  fsListItem,
  entities,
  targetFsListItem,
  targetFolder,
  favoritesSrv,
}: {
  fsListItem: FsListItem;
  entities: ListingEntryExtended[];
  targetFsListItem: FsListItem;
  targetFolder: string;
  favoritesSrv: FavoritesService;
}): Promise<Record<string, string>> {
  const { fsId: targetFsId } = targetFsListItem;

  const pathsMap: Record<string, string> = {};

  try {
    const favoriteFoldersForProcessing: Array<ListingEntryExtended & { newFullPath: string }> = [];

    for (const entity of entities) {
      const { type, favoriteId } = entity;
      console.log('$$$$$ MOVE-FS-ENTITES, getEntityTargetPath');
      const entityTargetPath = await getEntityTargetPath({
        fs: targetFsListItem.entity,
        entity: entity,
        targetFolder,
      });
      pathsMap[entity.fullPath] = entityTargetPath;

      await moveFsEntity({
        fsListItem,
        entity: entity,
        targetFsListItem,
        targetFolder,
      });

      const favoriteFolders = await favoritesSrv.getFavorites();
      if (type === 'folder' && favoriteId) {
        const isFavoriteFolderInList = !!favoriteFolders.find(fav => fav.favId === favoriteId);
        isFavoriteFolderInList &&
          favoriteFoldersForProcessing.push({
            ...entity,
            newFullPath: entityTargetPath,
          });
      }
    }

    if (favoriteFoldersForProcessing.length) {
      const processes: Promise<void>[] = [];
      for (const folder of favoriteFoldersForProcessing) {
        const { favoriteId, newFullPath } = folder;
        processes.push(
          favoritesSrv.updateFavorite({
            fsId: targetFsId,
            favId: favoriteId!,
            fullPath: newFullPath,
          }),
        );
      }

      await Promise.allSettled(processes);
    }

    return pathsMap;
  } catch (err) {
    const errorMessage = `Error while moving the ${entities}`;
    await w3n.log!('error', errorMessage, err);
    throw err;
  }
}
