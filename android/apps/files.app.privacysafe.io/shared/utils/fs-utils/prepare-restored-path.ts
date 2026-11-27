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
import type { ListingEntryExtended } from '../../../shared/types/index.ts';
import { formatPath } from '../../../shared/utils/various.ts';
import { getListFolder } from './get-list-folder.ts';
import { readLink } from './read-link.ts';
import {
  isSafeRelativePath,
  isSameOrInside,
  isValidEntityName,
  joinEntityPath,
  pickFreeEntityName,
} from './entity-name.ts';

export type RestoreConflict = Pick<ListingEntryExtended, 'fullPath' | 'name' | 'type'>;

/**
 * Computes where a trashed entity goes back to.
 * - 'keep': a free name next to the existing entities (`name_copy.ext`, ...);
 * - 'replace': the original name; `conflict` is the existing entity that has
 *   to be removed before the restored one can take its place.
 *
 * The original location comes from xattrs, which other devices and apps can
 * write. An invalid location, or one in the trash, restores into the root; a
 * location that is the trash itself is refused, since in 'replace' mode the
 * trash would be the conflict to remove.
 */
export async function prepareRestoredPath({
  fs,
  entity,
  mode,
  trashFolderName = '',
}: {
  fs: web3n.files.WritableFS;
  entity: ListingEntryExtended;
  mode: 'keep' | 'replace';
  trashFolderName?: string;
}): Promise<{ restoredPath: string; conflict?: RestoreConflict }> {
  const isInTrash = (path: string) => !!trashFolderName && isSameOrInside(path, trashFolderName);

  const storedParent = formatPath(entity.parentFolder ?? '');
  const parentFolder = isSafeRelativePath(storedParent) && !isInTrash(storedParent) ? storedParent : '';
  const originalName = isValidEntityName(entity.originalName) ? entity.originalName : entity.name;
  if (isInTrash(joinEntityPath(parentFolder, originalName))) {
    throw new Error(`'${entity.fullPath}' cannot be restored to the trash folder.`);
  }

  const parentFolderList =
    (await getListFolder({ fs, folderName: parentFolder, vAPI: false, stopErrorPropagate: true })) || [];

  if (mode === 'keep') {
    const takenNames = new Set(parentFolderList.map(item => item.name));
    const freeName = await pickFreeEntityName({
      name: originalName,
      isFolder: entity.type === 'folder',
      isTaken: candidate => takenNames.has(candidate),
    });
    return { restoredPath: joinEntityPath(parentFolder, freeName) };
  }

  const restoredPath = joinEntityPath(parentFolder, originalName);
  const existing = parentFolderList.find(item => item.name === originalName);
  if (!existing) {
    return { restoredPath };
  }

  let conflictType: ListingEntryExtended['type'];
  if (existing.isFolder) {
    conflictType = 'folder';
  } else if (!existing.isLink) {
    conflictType = 'file';
  } else {
    const link = await readLink({ fs, path: restoredPath, stopErrorPropagate: true });
    conflictType = !link ? 'link-broken' : link.isFolder ? 'link-folder' : 'link-file';
  }

  return {
    restoredPath,
    conflict: {
      fullPath: restoredPath,
      name: originalName,
      type: conflictType,
    },
  };
}
