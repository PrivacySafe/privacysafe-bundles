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
import { USER_FS, USER_LOCAL_FS } from '../../../shared/constants/index.ts';
import {
  deleteFile,
  deleteFolder,
  deleteLink,
  getEntityNameAndParent,
  moveFsEntity as moveWithinFs,
} from '../../../shared/utils/fs-utils/index.ts';
import { formatPath } from '../../../shared/utils/various.ts';
import { getEntityTargetPath } from './get-entity-target-path.ts';
import { moveFsEntity } from './move-fs-entity.ts';
import { listXAttrs, removeXAttrs, updateXAttrs } from './actions-on-x-attrs.ts';

async function completeRemoval({
  fs,
  path,
  type,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  type: 'folder' | 'file' | 'link';
}): Promise<void> {
  switch (type) {
    case 'folder': {
      return deleteFolder({ fs, path, removeContent: true });
    }

    case 'file': {
      return deleteFile({ fs, path });
    }

    case 'link': {
      return deleteLink({ fs, path });
    }

    default: {
      return;
    }
  }
}

/**
 * The entity is in the trash, but its original location could not be stored
 * there, and it could not be moved back either.
 */
class TrashedWithoutOriginError extends Error {
  constructor(
    readonly pathInTrash: string,
    override readonly cause: unknown,
  ) {
    super(`The entity has been moved to '${pathInTrash}' without its original location.`);
    this.name = 'TrashedWithoutOriginError';
  }
}

/**
 * The entity has been moved to the trash and back, since its original location
 * could not be stored: it is in place, but its folder and the trash have changed.
 */
class TrashMoveRolledBackError extends Error {
  constructor(override readonly cause: unknown) {
    super(`The original location could not be stored, so the entity has been moved back.`);
    this.name = 'TrashMoveRolledBackError';
  }
}

/**
 * Moves the entity to the trash and stores its original location in xattrs.
 * Without the location the entity cannot be restored, so when it is not
 * stored the move is rolled back and the error is thrown. When the rollback
 * fails too, TrashedWithoutOriginError tells where the entity is.
 */
async function moveToTrash({
  fsListItem,
  entity,
  trashFolderName,
}: {
  fsListItem: FsListItem;
  entity: ListingEntryExtended;
  trashFolderName: string;
}): Promise<string | undefined> {
  const { entity: fs, fsId } = fsListItem;
  const { parentFolder, entityName } = getEntityNameAndParent(entity.fullPath);
  if (!entityName) {
    return undefined;
  }

  const pathInTrash = await getEntityTargetPath({
    fs,
    entity,
    targetFolder: trashFolderName,
    namePostfix: `${Date.now()}`,
  });

  const { entityName: entityNameInTrash } = getEntityNameAndParent(pathInTrash);

  await moveFsEntity({
    fsListItem,
    entity,
    targetFsListItem: fsListItem,
    targetFolder: trashFolderName,
    targetEntityName: entityNameInTrash,
  });

  if ([USER_FS, USER_LOCAL_FS].includes(fsId)) {
    try {
      await updateXAttrs({
        fs,
        path: pathInTrash,
        attrs: { parentFolder: formatPath(parentFolder), originalName: entityName },
      });
    } catch (err) {
      try {
        await moveWithinFs({ fs, src: pathInTrash, dst: entity.fullPath });
      } catch (rollbackErr) {
        await w3n.log!('error', `Error moving '${pathInTrash}' back to '${entity.fullPath}'. `, rollbackErr);
        throw new TrashedWithoutOriginError(pathInTrash, err);
      }
      throw new TrashMoveRolledBackError(err);
    }

    // a stale favorite mark is harmless, so a failure here does not undo the removal
    try {
      const isEntityInFavorite =
        entity.type === 'folder'
          ? ((await listXAttrs({ fs, path: pathInTrash })) || []).includes('favoriteId')
          : false;

      if (isEntityInFavorite) {
        await removeXAttrs({ fs, path: pathInTrash, attrs: ['favoriteId'] });
      }
    } catch (err) {
      await w3n.log!('error', `Error removing the favorite mark of '${pathInTrash}'. `, err);
    }
  }

  return pathInTrash;
}

/**
 * Thrown when some of the entities could not be deleted. `result` describes the
 * entities that were processed, so that the caller can still sync them.
 * `movedBackPaths` are the failed entities that were moved to the trash and
 * back: they are in place, but their folders and the trash have to be synced.
 */
export class PartialDeleteError extends Error {
  constructor(
    readonly result: Record<string, string> | true,
    readonly failedPaths: string[],
    readonly movedBackPaths: string[] = [],
  ) {
    super(`${failedPaths.length} of the selected objects could not be deleted.`);
    this.name = 'PartialDeleteError';
  }
}

/**
 * Deletes entities one by one: a failure of one entity does not stop the others.
 * Returns `true` for a complete removal, or the map of original paths to paths
 * in the trash. Throws PartialDeleteError when some entities failed.
 */
export async function deleteFsEntities({
  fsListItem,
  entities,
  trashFolderName,
  completely,
  favoritesSrv,
}: {
  fsListItem: FsListItem;
  entities: ListingEntryExtended[];
  trashFolderName: string;
  completely?: boolean;
  favoritesSrv: FavoritesService;
}): Promise<Record<string, string> | true> {
  const { entity: fs, fsId } = fsListItem;
  const removeCompletely = completely || (!!trashFolderName && entities[0].fullPath.startsWith(trashFolderName));
  const failedPaths: string[] = [];

  const logFailure = async (entity: ListingEntryExtended, err: unknown) => {
    failedPaths.push(entity.fullPath);
    await w3n.log!('error', `Error deleting '${entity.fullPath}'. `, err);
  };

  if (removeCompletely) {
    for (const entity of entities) {
      try {
        await completeRemoval({ fs, path: entity.fullPath, type: entity.type });
      } catch (err) {
        await logFailure(entity, err);
      }
    }

    if (failedPaths.length > 0) {
      throw new PartialDeleteError(true, failedPaths);
    }
    return true;
  }

  const deletingResult = {} as Record<string, string>;
  const movedBackPaths: string[] = [];
  const favoriteFolders = await favoritesSrv.getFavorites().catch(() => []);

  const removeFavoritesInside = async (entity: ListingEntryExtended) => {
    if (entity.type !== 'folder') {
      return;
    }

    const favoriteFoldersFiltered = favoriteFolders.filter(
      f => f.fsId === fsId && (f.fullPath === entity.fullPath || f.fullPath.startsWith(`${entity.fullPath}/`)),
    );
    for (const fav of favoriteFoldersFiltered) {
      await favoritesSrv.deleteFavorite(fav.favId);
    }
  };

  for (const entity of entities) {
    try {
      const entityNewPath = await moveToTrash({ fsListItem, entity, trashFolderName });
      if (typeof entityNewPath !== 'string') {
        continue;
      }
      deletingResult[entity.fullPath] = entityNewPath;
      await removeFavoritesInside(entity);
    } catch (err) {
      if (err instanceof TrashedWithoutOriginError) {
        // it is in the trash anyway: other devices must see it, and its favorites are gone
        deletingResult[entity.fullPath] = err.pathInTrash;
        await removeFavoritesInside(entity).catch(() => {});
      } else if (err instanceof TrashMoveRolledBackError) {
        movedBackPaths.push(entity.fullPath);
      }
      await logFailure(entity, err);
    }
  }

  if (failedPaths.length > 0) {
    throw new PartialDeleteError(deletingResult, failedPaths, movedBackPaths);
  }
  return deletingResult;
}
