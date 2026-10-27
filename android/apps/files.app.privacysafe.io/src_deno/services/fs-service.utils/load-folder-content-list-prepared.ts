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
  getFileExtension,
  formatPath,
  prepareFolderPath,
  prepareFsEntityId,
} from '../../../shared/utils/various.ts';
import { getFsStat } from '../../../shared/utils/fs-utils/index.ts';
import { getXAttrs, listXAttrs } from './actions-on-x-attrs.ts';
import { loadFolderContentList } from './load-folder-content-list.ts';
import { mapWithConcurrency } from '../../../shared/utils/processes/map-with-concurrency.ts';
import { isListingXAttr, isValidListingXAttrValue } from './listing-xattrs.ts';
import type { ListingEntry, ListingEntryExtended } from '../../../shared/types/index.ts';

// entities prepared in parallel: each one takes several calls to the platform
const LISTING_CONCURRENCY = 8;

// OS folders in the user's home on the device, which the app does not show
const MACOS_HIDDEN_HOME_FOLDERS = ['desktop', 'applications', 'library'];
// the Windows registry hive files in the user's profile folder
const WINDOWS_HIDDEN_HOME_FILE = /^ntuser\.(dat|ini|pol)/i;

function whetherToProcessThisEntity(
  entity: ListingEntry,
  trashFolderName: string,
  os: 'macos' | 'linux' | 'windows',
  isDeviceHome: boolean,
): boolean {
  const { name, isFolder } = entity;

  const firstNameLetter = name.slice(0, 1);
  if (firstNameLetter === '.' || (isFolder && name === trashFolderName)) {
    return false;
  }

  // OS-specific entries exist only at the top of the user's home on the device;
  // folders with these names in 3N storages are the user's own and are shown
  if (!isDeviceHome) {
    return true;
  }

  if (os === 'windows' && !isFolder && WINDOWS_HIDDEN_HOME_FILE.test(name)) {
    return false;
  }

  return !(os === 'macos' && isFolder && MACOS_HIDDEN_HOME_FOLDERS.includes(name.toLowerCase()));
}

export async function loadFolderContentListPrepared({
  fs,
  path,
  basePath,
  trashFolderName,
  operatingSystem,
  version,
  withXAttrs = true,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  basePath: string;
  trashFolderName: string;
  operatingSystem: 'macos' | 'linux' | 'windows';
  version?: number;
  /** false skips the extended attributes (ids, thumbnails, favorites): much fewer calls */
  withXAttrs?: boolean;
}): Promise<ListingEntryExtended[]> {
  try {
    const folderPath = formatPath(prepareFolderPath([basePath, path]));
    const list = await loadFolderContentList({ fs, path: folderPath, version });
    if (!list || (Array.isArray(list) && list.length === 0)) {
      return [];
    }

    const isThisFsDevice = fs.type === 'device';

    async function prepareEntry(item: ListingEntry): Promise<ListingEntryExtended> {
      let brokeReason = '';
      const prepareErrorMsg = (errorTxt: string) => {
        brokeReason = brokeReason
          ? brokeReason.includes(errorTxt)
            ? brokeReason
            : `${brokeReason}. ${errorTxt}`
          : errorTxt;
      };

      const compoundPath = formatPath(prepareFolderPath([folderPath, item.name]));
      const [stats, xAttrs] = await Promise.all([
        getFsStat({
          fs,
          path: compoundPath,
          vAPI: !!fs.v,
          ...(version && { flags: { remoteVersion: version } }),
        }).catch(() => {
          prepareErrorMsg('Stat reading');
          return undefined;
        }),
        isThisFsDevice || !withXAttrs
          ? ([] as string[])
          : listXAttrs({ fs, path: compoundPath, version }).catch(err => {
              prepareErrorMsg(err.message || `Reading xAttr list`);
              return [] as string[];
            }),
      ]);

      const readAttr = <T>(attrName: string) =>
        getXAttrs<T>({
          fs,
          fullPath: compoundPath,
          attrName,
          version,
          propagationStop: true,
          actionIfError: () => prepareErrorMsg(`Reading '${attrName}' attr`),
        });

      const fields: Pick<
        ListingEntryExtended,
        'id' | 'ext' | 'parentFolder' | 'originalName' | 'thumbnail' | 'favoriteId' | 'tags' | 'sync' | 'hidden'
      > = {
        id: prepareFsEntityId(fs, compoundPath),
        ext: item.isFile ? getFileExtension(item.name) : `@${item.isFolder ? 'folder' : 'link'}-${item.name}`,
        parentFolder: '',
        originalName: '',
        thumbnail: undefined,
        favoriteId: undefined,
        tags: [],
        sync: undefined,
        hidden: undefined,
      };

      // only the attributes the entity has are read, and all of them at once
      await Promise.all(
        xAttrs.map(async xAttr => {
          if (xAttr === 'id') {
            const value = await readAttr<unknown>('id');
            if (typeof value === 'string' && value) {
              fields.id = value;
            }
          } else if (xAttr === 'ext') {
            const value = await readAttr<unknown>('ext');
            if (item.isFile && typeof value === 'string' && value) {
              fields.ext = value;
            }
          } else if (xAttr === 'tags') {
            const value = await readAttr<unknown>('tags');
            if (Array.isArray(value) && value.every(tag => typeof tag === 'string')) {
              fields.tags = value;
            }
          } else if (isListingXAttr(xAttr)) {
            const value = await readAttr<unknown>(xAttr);
            if (value !== undefined && isValidListingXAttrValue(xAttr, value)) {
              (fields as Record<string, unknown>)[xAttr] = value;
            }
          }
        }),
      );

      // fields from the FS itself go last: nothing read from xattrs may replace them
      return {
        ...fields,
        name: item.name,
        fullPath: compoundPath,
        type: item.isFile ? 'file' : item.isFolder ? 'folder' : 'link',
        ...(!item.isFolder && stats?.size && { size: stats.size }),
        ...(stats?.mtime && { mtime: stats.mtime }),
        ...(stats?.ctime && { ctime: stats.ctime }),
        ...(stats?.version && { version: stats.version }),
        ...(stats?.bytesNeedDownload && { bytesNeedDownload: stats.bytesNeedDownload }),
        brokeReason,
      };
    }

    const isDeviceHome = isThisFsDevice && folderPath === '';
    const entriesToShow = list.filter(item =>
      whetherToProcessThisEntity(item, trashFolderName, operatingSystem, isDeviceHome),
    );
    return await mapWithConcurrency(entriesToShow, LISTING_CONCURRENCY, prepareEntry);
  } catch (e) {
    await w3n.log!('error', `An error reading of ${path} folder. `, e);
    if (version) {
      // a remote version that cannot be listed is shown as empty in the conflicts dialog
      return [];
    }
    throw e;
  }
}
