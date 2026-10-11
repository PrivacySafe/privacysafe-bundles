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
import { prepareFsEntityId, getFileExtension } from '../../../shared/utils/various.ts';
import { getFsStat } from '../../../shared/utils/fs-utils/get-fs-stat.ts';
import { getXAttrs, listXAttrs } from './actions-on-x-attrs.ts';
import type { ListingEntryExtended } from '../../../shared/types/index.ts';

export async function loadFsEntityStats({
  fs,
  fullPath,
  version,
  actionIfError,
}: {
  fs: web3n.files.WritableFS;
  fullPath: string;
  version?: number;
  actionIfError?: (err: unknown) => void;
}): Promise<(ListingEntryExtended & { thumbnail?: string }) | undefined> {
  try {
    if (typeof fullPath !== 'string') {
      return undefined;
    }

    const isThisFsDevice = fs.type === 'device';
    const isThisFsWithVersioned = !!version && !!fs.v;

    const name = fullPath.split('/').pop() || '';
    const stats = await getFsStat({
      fs,
      path: fullPath,
      vAPI: isThisFsWithVersioned,
      ...(version && { flags: { remoteVersion: version } }),
    });

    const id = isThisFsDevice
      ? prepareFsEntityId(fs, fullPath)
      : (await getXAttrs<string>({ fs, fullPath, attrName: 'id', version })) || prepareFsEntityId(fs, fullPath);

    const attrs = isThisFsWithVersioned
      ? await listXAttrs({ fs, path: fullPath, version }).catch(() => [])
      : await listXAttrs({ fs, path: fullPath }).catch(() => []);

    const value: {
      tags: string[] | undefined;
      favoriteId: string | undefined;
      thumbnail: string | undefined;
    } = {
      tags: undefined,
      favoriteId: undefined,
      thumbnail: undefined,
    };

    if (!isThisFsDevice) {
      const targetAttrs = ['tags', 'favoriteId', 'thumbnail'] as const;
      for (const attr of targetAttrs) {
        const isAttrPresent = attrs.includes(attr);
        if (isAttrPresent) {
          value[attr] = await getXAttrs({
            fs,
            fullPath,
            attrName: attr,
            propagationStop: true,
            version,
            actionIfError: () => undefined,
          });
        }
      }
    }

    return {
      id,
      name,
      fullPath,
      tags: value.tags || [],
      type: stats?.isFile ? 'file' : stats?.isFolder ? 'folder' : 'link',
      ...(value.favoriteId && { favoriteId: value.favoriteId }),
      ...(stats?.isFile && { ext: getFileExtension(name) }),
      ...(value.thumbnail && { thumbnail: value.thumbnail }),
      ...(stats && { ...stats }),
    };
  } catch (err) {
    if (actionIfError) {
      actionIfError(err);
    }
  }
}
