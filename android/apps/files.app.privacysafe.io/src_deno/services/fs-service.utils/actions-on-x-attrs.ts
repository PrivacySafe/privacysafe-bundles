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
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WritableFS } from '../../../shared/types/index.ts';

export async function updateXAttrs({
  fs,
  path,
  attrs,
}: {
  fs: WritableFS;
  path: string;
  attrs: Record<string, any | undefined>;
}): Promise<void> {
  try {
    return fs.updateXAttrs(path, { set: attrs });
  } catch (err) {
    const attrNames = Object.keys(attrs).join(', ');
    const errorMessage = `🔥 [updateXAttrs] Error update xAttrs (${attrNames}) in the FS object ${path}. `;
    w3n.log!('error', errorMessage, err);
    throw err;
  }
}

export async function removeXAttrs({
  fs,
  path,
  attrs,
}: {
  fs: WritableFS;
  path: string;
  attrs: string[];
}): Promise<void> {
  try {
    return fs.updateXAttrs(path, { remove: attrs });
  } catch (err) {
    const errorMessage = `🔥 [removeXAttrs] Error delete xAttrs (${attrs.join(', ')}) in the FS object ${path}. `;
    w3n.log!('error', errorMessage, err);
    throw err;
  }
}

export async function getXAttrs<T>({
  fs,
  fullPath,
  attrName,
  version,
  propagationStop,
  actionIfError,
}: {
  fs: web3n.files.WritableFS;
  fullPath: string;
  attrName: string;
  version?: number;
  propagationStop?: boolean;
  actionIfError?: (err?: unknown) => void;
}): Promise<T | undefined> {
  type VersionedRes = Awaited<ReturnType<NonNullable<(typeof fs)['v']>['getXAttr']>>;
  type SimpleRes = Awaited<ReturnType<typeof fs.getXAttr>>;

  if (fs.type === 'device') {
    throw {
      name: 'ExecuteFunctionError',
      message: `Attempted to read xAttr from a file system that does not support them.`,
      cause: 'not-support',
    };
  }

  try {
    const isThisFsWithVersioned = !!version && !!fs.v;

    const res = isThisFsWithVersioned
      ? await fs.v!.getXAttr(fullPath, attrName, { remoteVersion: version })
      : await fs.getXAttr(fullPath, attrName);

    if (isThisFsWithVersioned && 'attr' in (res as VersionedRes)) {
      return (res as VersionedRes).attr as T;
    }

    return res as SimpleRes as T;
  } catch (err) {
    const errorMessage = `🔥 [getXAttrs] Error reading xAttr (${attrName}) in the FS object ${fullPath}. `;
    w3n.log!('error', errorMessage, err);

    actionIfError?.(err);

    if (!propagationStop) {
      throw err;
    }

    return undefined;
  }
}

export async function listXAttrs({
  fs,
  path,
  version,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  version?: number;
}): Promise<string[]> {
  if (fs.type === 'device') {
    throw {
      name: 'ExecuteFunctionError',
      message: 'Attempted to read list of xAttrs attributes from a file system that does not support them.',
      cause: 'not-support',
    };
  }

  try {
    const isThisFsWithVersioned = !!version && !!fs.v;

    const res = isThisFsWithVersioned
      ? await fs.v!.listXAttrs(path, { remoteVersion: version })
      : await fs.listXAttrs(path);

    if (isThisFsWithVersioned) {
      return (res as { lst: string[]; version: number }).lst;
    }

    return res as string[];
  } catch (err) {
    const errorMessage = `🔥 [listXAttrs] Error getting xAttrs list in the FS object ${path}. `;
    w3n.log!('error', errorMessage, err);
    throw err;
  }
}
