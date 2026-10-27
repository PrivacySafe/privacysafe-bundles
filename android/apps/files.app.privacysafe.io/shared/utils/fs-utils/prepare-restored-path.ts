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
import { isSafeRelativePath, isValidEntityName, joinEntityPath, pickFreeEntityName } from './entity-name.ts';

export type RestoreConflict = Pick<ListingEntryExtended, 'fullPath' | 'name' | 'type'>;

/**
 * Computes where a trashed entity goes back to.
 * - 'keep': a free name next to the existing entities (`name_copy.ext`, ...);
 * - 'replace': the original name; `conflict` is the existing entity that has
 *   to be removed before the restored one can take its place.
 */
export async function prepareRestoredPath({
  fs,
  entity,
  mode,
}: {
  fs: web3n.files.WritableFS;
  entity: ListingEntryExtended;
  mode: 'keep' | 'replace';
}): Promise<{ restoredPath: string; conflict?: RestoreConflict }> {
  // the original location comes from xattrs and is untrusted: an invalid one restores into the root
  const parentFolder = isSafeRelativePath(formatPath(entity.parentFolder ?? ''))
    ? formatPath(entity.parentFolder ?? '')
    : '';
  const originalName = isValidEntityName(entity.originalName) ? entity.originalName : entity.name;

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

  return {
    restoredPath,
    conflict: {
      fullPath: restoredPath,
      name: originalName,
      type: existing.isFolder ? 'folder' : existing.isLink ? 'link' : 'file',
    },
  };
}
