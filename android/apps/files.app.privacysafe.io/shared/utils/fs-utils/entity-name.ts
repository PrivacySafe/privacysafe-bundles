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
import { formatPath } from '../various.ts';
import { getListFolder } from './get-list-folder.ts';

/**
 * Splits an entity name into a base and an extension. Folders have no
 * extension. A leading dot ('.env') is part of the base, not an extension.
 * The extension keeps its original case.
 */
export function splitEntityName(name: string, isFolder = false): { base: string; ext: string } {
  const dotIndex = name.lastIndexOf('.');
  if (isFolder || dotIndex <= 0 || dotIndex === name.length - 1) {
    return { base: name, ext: '' };
  }

  return { base: name.slice(0, dotIndex), ext: name.slice(dotIndex + 1) };
}

export function joinEntityName(base: string, ext: string): string {
  return ext ? `${base}.${ext}` : base;
}

/**
 * Returns `name` when it is free, otherwise the first free name of the form
 * `base_postfix.ext`, `base_postfix_2.ext`, `base_postfix_3.ext`, ...
 */
export async function pickFreeEntityName({
  name,
  isFolder = false,
  postfix = 'copy',
  isTaken,
}: {
  name: string;
  isFolder?: boolean;
  postfix?: string;
  isTaken: (candidate: string) => boolean | Promise<boolean>;
}): Promise<string> {
  if (!(await isTaken(name))) {
    return name;
  }

  const { base, ext } = splitEntityName(name, isFolder);
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? `_${postfix}` : `_${postfix}_${attempt}`;
    const candidate = joinEntityName(`${base}${suffix}`, ext);
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }
}

export function joinEntityPath(folder: string, name: string): string {
  return formatPath(folder ? `${folder}/${name}` : name);
}

/** Names of all entities in a folder; empty when the folder does not exist yet. */
export async function getFolderEntityNames(fs: web3n.files.FS, folder: string): Promise<Set<string>> {
  const list = await getListFolder({ fs, folderName: folder, vAPI: false, stopErrorPropagate: true });
  return new Set((list || []).map(item => item.name));
}

/**
 * A name of a single entity: not empty, no path separators, not '.' or '..'.
 */
export function isValidEntityName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim().length > 0 &&
    !/[/\\]/.test(name) &&
    name !== '.' &&
    name !== '..' &&
    // control characters (incl. NUL) are not allowed in names
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f]/.test(name)
  );
}

/**
 * A relative path inside an FS: '' for the root, otherwise valid names joined
 * with '/'. Paths with '.', '..' or empty segments are rejected.
 */
export function isSafeRelativePath(path: unknown): path is string {
  if (path === '') {
    return true;
  }
  return typeof path === 'string' && path.split('/').every(segment => isValidEntityName(segment));
}

/** True when `path` is `folder` itself or lies inside it. */
export function isSameOrInside(path: string, folder: string): boolean {
  return folder === '' || path === folder || path.startsWith(`${folder}/`);
}
