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
import { formatPath, getFileExtension } from '../../../shared/utils/various.ts';
import { getListFolder } from './get-list-folder.ts';

export async function prepareRestoredPath({
  fs,
  entity,
  mode,
}: {
  fs: web3n.files.WritableFS;
  entity: ListingEntryExtended;
  mode: 'keep' | 'replace';
}): Promise<{ restoredPath: string; toDelete: boolean }> {
  const { parentFolder, originalName } = entity;

  const parentFolderList =
    (await getListFolder({ fs, folderName: parentFolder!, vAPI: false, stopErrorPropagate: true })) || [];
  const parentFolderEntitiesNames = parentFolderList.map(item => item.name);

  if (mode === 'keep') {
    const result: { restoredPath: string; toDelete: boolean } = {
      restoredPath: '',
      toDelete: false,
    };

    const fileExt = getFileExtension(originalName);
    let fileName = originalName!.replace(`.${fileExt}`, '');
    let tmpFullName = `${fileName}.${fileExt}`;

    while (result.restoredPath === '') {
      const isEntityWithSameName = parentFolderEntitiesNames.includes(tmpFullName);
      if (isEntityWithSameName) {
        fileName = `${fileName}_copy`;
        tmpFullName = `${fileName}.${fileExt}`;
      } else {
        result.restoredPath = formatPath(`${parentFolder}/${tmpFullName}`);
      }
    }

    return result;
  }

  return {
    restoredPath: formatPath(`${parentFolder!}/${originalName!}`),
    toDelete: parentFolderEntitiesNames.includes(originalName!),
  };
}
