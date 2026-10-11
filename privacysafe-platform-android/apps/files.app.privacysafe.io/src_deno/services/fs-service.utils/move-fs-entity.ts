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
  deleteFolder,
  deleteFile,
  deleteLink,
  moveFsEntity as _moveFsEntity,
} from '../../../shared/utils/fs-utils/index.ts';
import { copyFsEntity } from './copy-fs-entity.ts';
import type { FsListItem, ListingEntryExtended } from '../../../shared/types/index.ts';

export async function moveFsEntity({
  fsListItem,
  entity,
  targetFsListItem,
  targetFolder,
  targetEntityName,
}: {
  fsListItem: FsListItem;
  entity: ListingEntryExtended;
  targetFsListItem: FsListItem;
  targetFolder: string;
  targetEntityName?: string;
}): Promise<string> {
  const { name, type, fullPath } = entity;
  try {
    const { entity: fs, fsId } = fsListItem;
    const { entity: targetFs, fsId: targetFolderId } = targetFsListItem;

    const dstPath = `${targetFolder}/${targetEntityName || name}`;

    if (fsId === targetFolderId) {
      await _moveFsEntity({ fs, src: fullPath, dst: dstPath });
      return dstPath;
    }

    await copyFsEntity({
      srcFs: fs,
      entity,
      targetFs,
      targetFolder,
      targetEntityName: targetEntityName || name,
    });

    switch (type) {
      case 'folder': {
        await deleteFolder({ fs, path: fullPath, removeContent: true });
        break;
      }

      case 'file': {
        await deleteFile({ fs, path: fullPath });
        break;
      }

      case 'link': {
        await deleteLink({ fs, path: fullPath });
        break;
      }
    }

    return dstPath;
  } catch (e) {
    await w3n.log!('error', `Error move entity ${entity.fullPath}. `, e);
    throw e;
  }
}
