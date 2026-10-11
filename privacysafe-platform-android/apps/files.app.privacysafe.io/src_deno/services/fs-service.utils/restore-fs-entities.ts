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
/// <reference path="../../../@types/platform-defs/injected-w3n.d.ts" />
import type { FsListItem, ListingEntryExtended } from '../../../shared/types/index.ts';
import type { FavoritesService } from '../../types.ts';
import { moveFsEntity, prepareRestoredPath } from '../../../shared/utils/fs-utils/index.ts';
import { deleteFsEntities } from './delete-fs-entities.ts';
import { USER_FS, USER_LOCAL_FS } from '../../../shared/constants';
import { removeXAttrs } from './actions-on-x-attrs';

export async function restoreFsEntities({
  fsListItem,
  entities,
  trashFolderName,
  mode = 'keep',
  favoritesSrv,
}: {
  fsListItem: FsListItem;
  entities: ListingEntryExtended[];
  trashFolderName: string;
  mode: 'keep' | 'replace';
  favoritesSrv: FavoritesService;
}): Promise<Record<string, string> | undefined> {
  try {
    const { entity: fs, fsId } = fsListItem;

    const mappingPathToRestorePath = {} as Record<string, string>;
    const entitiesToPreDelete = [] as ListingEntryExtended[];

    for (const entity of entities) {
      const { restoredPath, toDelete } = await prepareRestoredPath({ fs, entity, mode });
      mappingPathToRestorePath[entity.fullPath] = restoredPath;
      if (toDelete) {
        entitiesToPreDelete.push(entity);
      }
    }

    if (mode === 'replace' && entitiesToPreDelete.length > 0) {
      await deleteFsEntities({
        fsListItem,
        entities: entitiesToPreDelete,
        trashFolderName,
        completely: true,
        favoritesSrv,
      });
    }

    for (const entity of entities) {
      await moveFsEntity({ fs, src: entity.fullPath, dst: mappingPathToRestorePath[entity.fullPath] });
      if ([USER_FS, USER_LOCAL_FS].includes(fsId)) {
        await removeXAttrs({
          fs,
          path: mappingPathToRestorePath[entity.fullPath],
          attrs: ['parentFolder', 'originalName'],
        });
      }
    }

    return mappingPathToRestorePath;
  } catch (err) {
    w3n.log(
      'error',
      `Error while restore entities ${entities.map(e => e.originalName || e.name).join(', ')}. `,
      err,
    );
  }
}
