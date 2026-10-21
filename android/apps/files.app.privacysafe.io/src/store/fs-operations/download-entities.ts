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
import { getReadonlyFile, getReadonlySubRoot, readLink, saveFile, saveFolder } from '@shared/utils/fs-utils';
import type { ListingEntryExtended } from '@shared/types';

export async function downloadEntities({
  fs,
  entities,
}: {
  fs: web3n.files.WritableFS;
  entities: ListingEntryExtended[];
}): Promise<void> {
  try {
    // @ts-ignore
    const targetFs = await w3n?.shell?.fileDialogs?.saveFolderDialog('Select a folder for downloading', 'Ok');

    if (!targetFs) {
      return;
    }

    for (const entity of entities) {
      const { name, type, fullPath } = entity;
      switch (type) {
        case 'folder': {
          const folder = await getReadonlySubRoot({ fs, folder: fullPath, stopErrorPropagate: true });
          folder && (await targetFs.saveFolder(folder, name));
          break;
        }
        case 'file': {
          const file = await getReadonlyFile({ fs, path: fullPath, stopErrorPropagate: true });
          file && (await saveFile({ fs: targetFs, file, dst: name }));
          break;
        }
        case 'link': {
          const link = await readLink({ fs, path: fullPath, stopErrorPropagate: true });
          if (!link) {
            throw new Error(`Error while link reading ${fullPath}`);
          }

          const data = await link.target();

          if (link.isFolder) {
            await saveFolder({ fs: targetFs, folder: data as web3n.files.ReadonlyFS, dst: name });
            return;
          }

          if (link.isFile) {
            await saveFile({ fs: targetFs, file: data as web3n.files.ReadonlyFile, dst: name });
          }
        }
      }
    }
  } catch (e) {
    w3n.log('error', `Error while downloading ${entities.map(entity => entity.name).join(', ')}. `, e);
    throw e;
  }
}
