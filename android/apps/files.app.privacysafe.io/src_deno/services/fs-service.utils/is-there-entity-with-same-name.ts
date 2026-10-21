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
import type { WritableFS } from '../../../shared/types/index.ts';
import { getFsStat } from '../../../shared/utils/fs-utils/get-fs-stat.ts';

export async function isThereEntityWithSameName({
  fs,
  path,
  type,
}: {
  fs: WritableFS;
  path: string;
  type?: 'folder' | 'file' | 'link';
}) {
  try {
    let entityType = type;
    if (!entityType) {
      const entityStat = await getFsStat({ fs, path, vAPI: false });
      entityType = entityStat ? (entityStat.isFolder ? 'folder' : entityStat.isFile ? 'file' : 'link') : undefined;
    }

    if (!entityType) {
      return false;
    }

    switch (entityType) {
      case 'folder':
        return fs.checkFolderPresence(path);
      case 'file':
        return fs.checkFilePresence(path);
      case 'link':
        return fs.checkLinkPresence(path);
    }
  } catch (e) {
    w3n.log('error', `ERROR WHILE CHECKING THE ${type} "${path}" PRESENCE. `, e);
    return false;
  }
}
