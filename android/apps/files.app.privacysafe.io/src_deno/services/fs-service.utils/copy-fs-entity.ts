/*
 Copyright (C) 2025 3NSoft Inc.

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
import { getEntityTargetPath } from './get-entity-target-path.ts';
import {
  getReadonlySubRoot,
  getReadonlyFile,
  readLink,
  saveFile,
  saveFolder,
} from '../../../shared/utils/fs-utils/index.ts';
import type { ListingEntryExtended } from '../../../shared/types/index.ts';

export async function copyFsEntity({
  srcFs,
  entity,
  targetFs,
  targetFolder,
  targetEntityName,
}: {
  srcFs: web3n.files.WritableFS;
  entity: ListingEntryExtended;
  targetFs: web3n.files.WritableFS;
  targetFolder: string;
  targetEntityName?: string;
}): Promise<string | undefined> {
  const { type, fullPath } = entity;

  try {
    const entityNewPath = await getEntityTargetPath({
      fs: targetFs,
      entity,
      targetFolder,
      targetEntityName,
    });

    switch (type) {
      case 'folder': {
        const folder = await getReadonlySubRoot({ fs: srcFs, folder: fullPath });
        folder && (await saveFolder({ fs: targetFs, folder, dst: entityNewPath }));
        break;
      }

      case 'file': {
        const file = await getReadonlyFile({ fs: srcFs, path: fullPath });
        file && (await saveFile({ fs: targetFs, file, dst: entityNewPath }));
        break;
      }

      case 'link': {
        const link = await readLink({ fs: srcFs, path: fullPath });

        if (!link) {
          return;
        }

        const data = await link.target();

        if (link.isFolder) {
          await saveFolder({ fs: targetFs, folder: data as web3n.files.FS, dst: entityNewPath });
        } else if (link.isFile) {
          await saveFile({ fs: targetFs, file: data as web3n.files.File, dst: entityNewPath });
        }

        break;
      }
    }

    return entityNewPath;
  } catch (err) {
    const errorMessage = `Error while copying the ${entity.fullPath}`;
    await w3n.log!('error', errorMessage, err);
    throw err;
  }
}
