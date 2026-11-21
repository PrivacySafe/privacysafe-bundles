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
import { moveFsEntity } from './move-fs-entity.ts';
import { getParentFolderPathFromEntityFullPath } from '../../../shared/utils/various.ts';
import type { FsListItem, ListingEntryExtended } from '../../../shared/types/index.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';

const log = makeLogger('FsService');

export async function renameFsEntity({
  fsListItem,
  entity,
  targetFsListItem,
  newName,
}: {
  fsListItem: FsListItem;
  entity: ListingEntryExtended;
  targetFsListItem: FsListItem;
  newName: string;
}): Promise<string | undefined> {
  try {
    const targetFolder = getParentFolderPathFromEntityFullPath(entity.fullPath);
    const res = await moveFsEntity({ fsListItem, entity, targetFsListItem, targetFolder, targetEntityName: newName });
    return res === 'skipped-broken' ? undefined : res;
  } catch (e) {
    const errorMessage = `Error renaming the entity ${entity.fullPath}. `;
    log.error(errorMessage, e);
    return undefined;
  }
}
