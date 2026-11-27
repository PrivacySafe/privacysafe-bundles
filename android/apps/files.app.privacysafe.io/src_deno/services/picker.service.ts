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
import type { FsListItem, RootFsFolderView } from '../../shared/types/index.ts';
import { APP_SETTINGS_DEFAULT } from '../../shared/constants/index.ts';
import { isFsRootVisible } from '../../shared/utils/fs-grouping.ts';
import { isSafeRelativePath, isSameOrInside } from '../../shared/utils/fs-utils/entity-name.ts';
import { formatPath } from '../../shared/utils/various.ts';
import type { PickerServiceMethod, StorageAppDenoService } from '../types.ts';

export type PickerService = Pick<StorageAppDenoService, PickerServiceMethod>;

/**
 * The service of the file pickers. A picker runs as a dialog of another app
 * and parses that app's arguments, so it gets only what it shows: the storages
 * of the visible roots, and listings of their folders outside of the trash.
 */
export function makePickerService({
  getFsList,
  getFsRootFolderList,
  getFolderContentFilledList,
  loadConfigFile,
  trashFolderName,
}: Pick<StorageAppDenoService, PickerServiceMethod | 'loadConfigFile'> & {
  trashFolderName: string;
}): PickerService {
  async function visibleRoots(): Promise<RootFsFolderView[]> {
    const [roots, config] = await Promise.all([getFsRootFolderList(), loadConfigFile()]);
    const settings = { ...APP_SETTINGS_DEFAULT, ...config };
    return roots.filter(root => isFsRootVisible(root, settings));
  }

  async function visibleFsIds(): Promise<Set<string>> {
    return new Set((await visibleRoots()).map(root => root.fsId));
  }

  return {
    getFsRootFolderList: visibleRoots,

    async getFsList() {
      const [all, ids] = await Promise.all([getFsList(), visibleFsIds()]);
      return Object.fromEntries(Object.entries(all).filter(([fsId]) => ids.has(fsId))) as Record<
        string,
        FsListItem
      >;
    },

    async getFolderContentFilledList({ fsId, path, operatingSystem, version }) {
      if (!(await visibleFsIds()).has(fsId)) {
        throw new Error(`The storage '${fsId}' is not available in the file picker.`);
      }
      const folder = typeof path === 'string' ? formatPath(path) : path;
      if (!isSafeRelativePath(folder)) {
        throw new Error(`Invalid path: it must not contain '.', '..' or empty segments.`);
      }
      if (trashFolderName && folder !== '' && isSameOrInside(folder, trashFolderName)) {
        throw new Error('The trash folder is not available in the file picker.');
      }
      return getFolderContentFilledList({ fsId, path: folder, operatingSystem, version, withXAttrs: false });
    },
  };
}
