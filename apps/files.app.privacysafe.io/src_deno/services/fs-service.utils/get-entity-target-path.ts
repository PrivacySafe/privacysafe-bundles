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
import { getFileExtension } from '../../../shared/utils/various.ts';
import { isThereEntityWithSameName } from './is-there-entity-with-same-name.ts';
import { formatPath } from '../../../shared/utils/various.ts';
import { readLink } from '../../../shared/utils/fs-utils/index.ts';
import type { ListingEntryExtended } from '../../../shared/types/index.ts';

export async function getEntityTargetPath({
  fs,
  entity,
  targetFolder,
  targetEntityName,
  namePostfix = 'copy',
}: {
  fs: web3n.files.WritableFS;
  entity: ListingEntryExtended;
  targetFolder: string;
  targetEntityName?: string;
  namePostfix?: string;
}): Promise<string> {
  const { type, name, fullPath } = entity;

  const possibleEntityNewPath = formatPath(`${targetFolder}/${targetEntityName || name}`);
  const isEntityPresentInTargetFolder = await isThereEntityWithSameName({
    fs,
    path: possibleEntityNewPath,
    type,
  });
  console.log(`🎈 IS '${fullPath}' ENTITY PRESENT IN TARGET FOLDER '${targetFolder}' => ${isEntityPresentInTargetFolder}`);

  if (type === 'folder') {
    return isEntityPresentInTargetFolder ? `${possibleEntityNewPath}_${namePostfix}` : possibleEntityNewPath;
  }

  if (type === 'link') {
    const link = await readLink({ fs, path: fullPath });
    if (link?.isFolder) {
      return isEntityPresentInTargetFolder ? `${possibleEntityNewPath}_${namePostfix}` : possibleEntityNewPath;
    }
  }

  const fileExt = getFileExtension(name);
  const fileName = (targetEntityName || name).replace(`.${fileExt}`, '');
  return isEntityPresentInTargetFolder
    ? formatPath(`${targetFolder}/${fileName}_${namePostfix}.${fileExt}`)
    : possibleEntityNewPath;
}
