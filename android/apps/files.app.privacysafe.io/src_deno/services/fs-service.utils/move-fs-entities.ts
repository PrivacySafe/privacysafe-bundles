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
import { relocateFavorites } from './relocate-favorites.ts';
import { getEntityNameAndParent } from '../../../shared/utils/fs-utils/index.ts';
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
    for (const entity of entities) {
      const entityTargetPath = await getEntityTargetPath({
        fs: targetFsListItem.entity,
        srcFs: fsListItem.entity,
        entity,
        targetFolder,
      });
      const { entityName: targetEntityName } = getEntityNameAndParent(entityTargetPath);

      await moveFsEntity({
        fsListItem,
        entity,
        targetFsListItem,
        targetFolder,
        targetEntityName,
      });
      pathsMap[entity.fullPath] = entityTargetPath;

      if (entity.type === 'folder') {
        await relocateFavorites({
          favoritesSrv,
          fsId: fsListItem.fsId,
          oldPath: entity.fullPath,
          newFsId: targetFsId,
          newPath: entityTargetPath,
        });
      }
    }

    return pathsMap;
  } catch (err) {
    const errorMessage = `Error while moving the ${entities}`;
    await w3n.log!('error', errorMessage, err);
    throw err;
  }
}
