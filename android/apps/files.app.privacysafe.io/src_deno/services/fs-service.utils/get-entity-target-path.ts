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
import {
  getFolderEntityNames,
  joinEntityPath,
  pickFreeEntityName,
  readLink,
} from '../../../shared/utils/fs-utils/index.ts';
import type { ListingEntryExtended } from '../../../shared/types/index.ts';

/**
 * Returns the path for the entity in the target folder. When the name is taken
 * there, a free one is picked: `name_copy.ext`, `name_copy_2.ext`, ...
 */
export async function getEntityTargetPath({
  fs,
  srcFs = fs,
  entity,
  targetFolder,
  targetEntityName,
  namePostfix = 'copy',
}: {
  fs: web3n.files.WritableFS;
  srcFs?: web3n.files.WritableFS;
  entity: ListingEntryExtended;
  targetFolder: string;
  targetEntityName?: string;
  namePostfix?: string;
}): Promise<string> {
  const { type, name, fullPath } = entity;

  const isFolder =
    type === 'folder' ||
    (type === 'link' && !!(await readLink({ fs: srcFs, path: fullPath, stopErrorPropagate: true }))?.isFolder);

  const takenNames = await getFolderEntityNames(fs, targetFolder);
  const freeName = await pickFreeEntityName({
    name: targetEntityName || name,
    isFolder,
    postfix: namePostfix,
    isTaken: candidate => takenNames.has(candidate),
  });

  return joinEntityPath(targetFolder, freeName);
}
