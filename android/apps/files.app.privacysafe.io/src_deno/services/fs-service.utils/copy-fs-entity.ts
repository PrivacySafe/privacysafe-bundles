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
import { makeLogger } from '../../../shared/utils/logger.ts';

const log = makeLogger('FsService');

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

  if (type === 'link-broken') {
    return undefined;
  }

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

      case 'link-folder':
      case 'link-file': {
        const link = await readLink({ fs: srcFs, path: fullPath, stopErrorPropagate: true });

        if (!link) {
          return undefined;
        }

        const target = await link.target().catch(() => undefined);

        if (!target) {
          return undefined;
        }

        await targetFs.link(entityNewPath, target);
        break;
      }
    }

    return entityNewPath;
  } catch (err) {
    const errorMessage = `Error while copying the ${entity.fullPath}`;
    log.error(errorMessage, err);
    throw err;
  }
}
