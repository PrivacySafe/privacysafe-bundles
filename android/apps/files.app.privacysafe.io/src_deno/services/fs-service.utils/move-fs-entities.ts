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
import { makeLogger } from '../../../shared/utils/logger.ts';

const log = makeLogger('FsService');

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
}): Promise<{
  moved: Record<string, string>;
  skippedBroken: string[];
}> {
  const { fsId: targetFsId } = targetFsListItem;

  const moved = {} as Record<string, string>;
  const skippedBroken: string[] = [];

  try {
    for (const entity of entities) {
      if (entity.type === 'link-broken') {
        skippedBroken.push(entity.name);
        continue;
      }

      const entityTargetPath = await getEntityTargetPath({
        fs: targetFsListItem.entity,
        entity,
        targetFolder,
      });
      const { entityName: targetEntityName } = getEntityNameAndParent(entityTargetPath);

      const res = await moveFsEntity({
        fsListItem,
        entity,
        targetFsListItem,
        targetFolder,
        targetEntityName,
      });
      if (res === 'skipped-broken') {
        skippedBroken.push(entity.name);
        continue;
      }

      moved[entity.fullPath] = entityTargetPath;

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

    return { moved, skippedBroken };
  } catch (err) {
    const errorMessage = `Error while moving the ${entities}`;
    log.error(errorMessage, err);
    throw err;
  }
}
