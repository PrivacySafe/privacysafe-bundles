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
import type { ListingEntry, ListingEntryExtended } from '../../../shared/types/index.ts';

function whetherToProcessThisEntity(
  entity: ListingEntry,
  trashFolderName: string,
  os: 'macos' | 'linux' | 'windows',
): boolean {
  const { name, isFolder } = entity;

  const firstNameLetter = name.slice(0, 1);
  if (firstNameLetter === '.' || (isFolder && name === trashFolderName)) {
    return false;
  }

  if (os === 'windows' && isFolder && name.toLowerCase() === 'ntuser.dat') {
    return false;
  }

  return !(os === 'macos' && ['desktop', 'applications', 'library'].includes(name.toLowerCase()));
}

export async function loadFolderContentListPrepared({
  fs,
  path,
  basePath,
  trashFolderName,
  operatingSystem,
  version,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  basePath: string;
  trashFolderName: string;
  operatingSystem: 'macos' | 'linux' | 'windows';
  version?: number;
}): Promise<ListingEntryExtended[]> {
  try {
    const folderPath = formatPath(prepareFolderPath([basePath, path]));
    const list = await loadFolderContentList({ fs, path: folderPath, version });
    if (!list || (Array.isArray(list) && list.length === 0)) {
      return [];
    }

    const isThisFsDevice = fs.type === 'device';

    const preparedList: ListingEntryExtended[] = [];
    let brokeReason = '';

    const prepareErrorMsg = (errorTxt: string) => {
      brokeReason = brokeReason
        ? brokeReason.includes(errorTxt)
          ? brokeReason
          : `${brokeReason}. ${errorTxt}`
        : errorTxt;
    };

    for (const item of list) {
      if (whetherToProcessThisEntity(item, trashFolderName, operatingSystem)) {
        brokeReason = '';
        const compoundPath = formatPath(prepareFolderPath([folderPath, item.name]));
        const stats = await getFsStat({ fs, path: compoundPath, vAPI: !!fs.v }).catch(() =>
          prepareErrorMsg('Stat reading'),
        );

        const xAttrs = isThisFsDevice
          ? []
          : await listXAttrs({ fs, path: compoundPath, version }).catch(err => {
              prepareErrorMsg(err.message || `Reading xAttr list`);
              return [];
            });

        const someEntryListingFields: Pick<
          ListingEntryExtended,
          'id' | 'ext' | 'parentFolder' | 'originalName' | 'thumbnail' | 'favoriteId' | 'tags' | 'sync' | 'hidden'
        > = {
          id: isThisFsDevice
            ? prepareFsEntityId(fs, compoundPath)
            : (await getXAttrs<string>({
                fs,
                fullPath: compoundPath,
                attrName: 'id',
                propagationStop: true,
                version,
                actionIfError: () => {
                  prepareErrorMsg(`Reading 'id' attr`);
                  return prepareFsEntityId(fs, compoundPath);
                },
              })) || prepareFsEntityId(fs, compoundPath),
          ext: undefined,
          parentFolder: '',
          originalName: '',
          thumbnail: undefined,
          favoriteId: undefined,
          tags: [],
          sync: undefined,
          hidden: undefined,
        };

        const computedFileExt = getFileExtension(item.name);
        someEntryListingFields.ext = !item.isFile
          ? `@${item.isFolder ? 'folder' : 'link'}-${item.name}`
          : isThisFsDevice
            ? computedFileExt
            : (await getXAttrs<string>({
                fs,
                fullPath: compoundPath,
                attrName: 'ext',
                version,
                propagationStop: true,
                actionIfError: () => {
                  prepareErrorMsg(`Reading 'ext' attr`);
                  return computedFileExt;
                },
              })) || computedFileExt;

        if (!isThisFsDevice) {
          for (const xAttr of xAttrs) {
            if (xAttr === 'tags') {
              someEntryListingFields.tags = await getXAttrs<string[]>({
                fs,
                fullPath: compoundPath,
                attrName: 'tags',
                version,
                propagationStop: true,
                actionIfError: () => {
                  prepareErrorMsg(`Reading 'tags' attr`);
                  return [] as string[];
                },
              });
            } else if (!['id', 'ext'].includes(xAttr)) {
              // @ts-ignore
              someEntryListingFields[xAttr] = await getXAttrs<string>({
                fs,
                fullPath: compoundPath,
                attrName: xAttr,
                version,
                propagationStop: true,
                actionIfError: () => prepareErrorMsg(`Reading '${xAttr}' attr`),
              });
            }
          }
        }

        preparedList.push({
          name: item.name,
          fullPath: compoundPath,
          type: item.isFile ? 'file' : item.isFolder ? 'folder' : 'link',
          ...(!item.isFolder && stats?.size && { size: stats.size }),
          ...(stats?.mtime && { mtime: stats.mtime }),
          ...(stats?.ctime && { ctime: stats.ctime }),
          ...(stats?.version && { version: stats.version }),
          ...(stats?.bytesNeedDownload && { bytesNeedDownload: stats.bytesNeedDownload }),
          brokeReason,
          ...someEntryListingFields,
        });
      }
    }

    return preparedList;
  } catch (e) {
    await w3n.log!('error', `An error reading of ${path} folder. `, e);
    return [];
  }
}
