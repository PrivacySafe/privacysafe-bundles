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
export function getCompoundFsId(fs: web3n.files.WritableFS): string {
  const processedFsName = fs.name
    .replaceAll(' ', '_')
    .replace(/[.*+?^$&{}()|[\]\\]/g, '')
    .toLowerCase();

  return `${fs.type}-${processedFsName}`;
}

export function prepareFsEntityId(fs: web3n.files.WritableFS, entityPath: string): string {
  const compoundFsId = getCompoundFsId(fs);
  return `${compoundFsId}-${entityPath.replace(/[.*+?^$&{}()|/[\]\\]/g, '_')}`;
}

export function getFileExtension(fullName = ''): string {
  const dotCharIndex = fullName.split('').findLastIndex((c: string) => c === '.');
  return dotCharIndex > -1 ? fullName.slice(dotCharIndex + 1).toLowerCase() : '';
}

export function prepareFolderPath(paths: Array<string | undefined> = []): string {
  return paths.reduce((res: string, item) => {
    if (item) {
      res = res ? `${res}/${item}` : item;
    }

    return res;
  }, '');
}

export function getParentFolderPathFromEntityFullPath(fullPath: string): string {
  const lastSlashIndex = fullPath.lastIndexOf('/');
  return lastSlashIndex > 0 ? fullPath.slice(0, lastSlashIndex) : '';
}

export function formatPath(path: string): string {
  if (path === '.' || path === './' || path === '/') {
    return '';
  }

  if (path.startsWith('./')) {
    return path.replace('./', '');
  }

  if (path.startsWith('/')) {
    return path.slice(1);
  }

  return path;
}
