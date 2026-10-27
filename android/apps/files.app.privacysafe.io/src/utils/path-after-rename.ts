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

function trimSlashes(path: string): string {
  return path
    .split('/')
    .filter(part => part.length > 0 && part !== '.')
    .join('/');
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/**
 * Gives the path a window shows after the entry `oldName` of the folder `parentPath` is
 * renamed to `newName`, or null when the window shows something else.
 * `windowPath` is the path in the window (the route query), relative to `basePath`
 * (the trash folder for the trash, '' for Home); `parentPath` is from the FS root.
 * The result is relative to `basePath` again.
 */
export function getWindowPathAfterRename({
  windowPath,
  basePath = '',
  parentPath,
  oldName,
  newName,
}: {
  windowPath: string;
  basePath?: string;
  parentPath: string;
  oldName: string;
  newName: string;
}): string | null {
  const base = trimSlashes(basePath);
  const fullPath = joinPath(base, trimSlashes(windowPath));
  const oldFullPath = joinPath(trimSlashes(parentPath), oldName);
  if (fullPath !== oldFullPath && !fullPath.startsWith(`${oldFullPath}/`)) {
    return null;
  }

  const newFullPath = joinPath(trimSlashes(parentPath), newName) + fullPath.slice(oldFullPath.length);
  if (!base) {
    return newFullPath;
  }
  if (newFullPath === base) {
    return '';
  }
  return newFullPath.startsWith(`${base}/`) ? newFullPath.slice(base.length + 1) : null;
}
