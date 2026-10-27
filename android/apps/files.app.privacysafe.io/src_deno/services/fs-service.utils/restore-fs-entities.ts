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
import { USER_FS, USER_LOCAL_FS } from '../../../shared/constants/index.ts';
import { removeXAttrs } from './actions-on-x-attrs.ts';

/**
 * Restores trashed entities one by one. Each entity is resolved against the
 * current state of its original folder, so entities restored earlier in the
 * same batch are taken into account. A failure of one entity is logged and
 * does not stop the others; the result contains only restored entities.
 */
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
}): Promise<Record<string, string>> {
  const { entity: fs, fsId } = fsListItem;
  const mappingPathToRestorePath = {} as Record<string, string>;

  for (const entity of entities) {
    try {
      const { restoredPath, conflict } = await prepareRestoredPath({ fs, entity, mode });

      if (mode === 'replace' && conflict) {
        await deleteFsEntities({
          fsListItem,
          entities: [conflict as ListingEntryExtended],
          trashFolderName,
          completely: true,
          favoritesSrv,
        });
      }

      await moveFsEntity({ fs, src: entity.fullPath, dst: restoredPath });
      // the entity is back in place and has to be synced, whatever happens to its xattrs
      mappingPathToRestorePath[entity.fullPath] = restoredPath;

      if ([USER_FS, USER_LOCAL_FS].includes(fsId)) {
        // stale trash marks outside of the trash are ignored, so a failure here is only logged
        await removeXAttrs({ fs, path: restoredPath, attrs: ['parentFolder', 'originalName'] }).catch(err =>
          w3n.log('error', `Error removing the trash marks of the restored '${restoredPath}'. `, err),
        );
      }
    } catch (err) {
      await w3n.log('error', `Error while restoring ${entity.originalName || entity.name}. `, err);
    }
  }

  return mappingPathToRestorePath;
}
