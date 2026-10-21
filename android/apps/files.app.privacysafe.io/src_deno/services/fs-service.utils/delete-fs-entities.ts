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
import type { FsListItem, ListingEntryExtended } from '../../../shared/types';
import type { FavoritesService } from '../../types';
import { USER_FS, USER_LOCAL_FS } from '../../../shared/constants';
import {
  deleteFile,
  deleteFolder,
  deleteLink,
  getEntityNameAndParent,
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

  console.log('💥 MOVE TO TRASH => ', trashFolderName, ' | ', parentFolder, ' | ', entityName);

  const pathInTrash = await getEntityTargetPath({
    fs,
    entity,
    targetFolder: trashFolderName,
    namePostfix: `${Date.now()}`,
  });

  const { entityName: entityNameInTrash } = getEntityNameAndParent(pathInTrash);
  console.log('💥 PATHS IN DATA => ', pathInTrash, ' | ', entityNameInTrash);

  await moveFsEntity({
    fsListItem,
    entity,
    targetFsListItem: fsListItem,
    targetFolder: trashFolderName,
    targetEntityName: entityNameInTrash,
  });

  if ([USER_FS, USER_LOCAL_FS].includes(fsId)) {
    await updateXAttrs({
      fs,
      path: pathInTrash,
      attrs: { parentFolder: formatPath(parentFolder), originalName: entityName },
    });

    const isEntityInFavorite =
      entity.type === 'folder'
        ? ((await listXAttrs({ fs, path: pathInTrash })) || []).includes('favoriteId')
        : false;

    if (isEntityInFavorite) {
      await removeXAttrs({ fs, path: pathInTrash, attrs: ['favoriteId'] });
    }
  }

  return pathInTrash;
}

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
}): Promise<Record<string, string> | boolean | undefined> {
  const { entity: fs } = fsListItem;
  const removeCompletely = completely || (!!trashFolderName && entities[0].fullPath.startsWith(trashFolderName));
  console.log('💥 DELETE FS ENTITIES => ', removeCompletely, entities.map(e => e.fullPath).join(' | '));

  try {
    if (removeCompletely) {
      for (const entity of entities) {
        await completeRemoval({ fs, path: entity.fullPath, type: entity.type });
      }
      return true;
    }

    const deletingResult = {} as Record<string, string>;

    const favoriteFolders = await favoritesSrv.getFavorites();
    for (const entity of entities) {
      const entityNewPath = await moveToTrash({ fsListItem, entity, trashFolderName });
      if (typeof entityNewPath === 'string') {
        deletingResult[entity.fullPath] = entityNewPath;
      }

      if (entityNewPath && entity.type === 'folder') {
        const favoriteFoldersFiltered = (favoriteFolders || []).filter(f =>
          f.fullPath.startsWith(entity.fullPath),
        );
        if (favoriteFoldersFiltered.length === 0) {
          continue;
        }

        for (const fav of favoriteFoldersFiltered) {
          await favoritesSrv.deleteFavorite(fav.favId);
        }
      }

      return deletingResult;
    }
  } catch (e) {
    const errorMessage = `Error delete FS objects: ${entities.map(e => e.fullPath).join(' | ')} . `;
    await w3n.log!('error', errorMessage, e);
  }
}
