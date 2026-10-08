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
import type { FileWithId } from '../types/index.ts';

export async function getFileStat(entity: FileWithId): Promise<web3n.files.Stats> {
  return entity.stat().catch(() => {
    return {
      isFile: true,
      size: 0,
      writable: false,
    };
  });
}

export async function getEntityStat(fs: web3n.files.FS, path: string, isFile?: boolean): Promise<web3n.files.Stats> {
  return fs.stat(path).catch(() => {
    return {
      isFile: !!isFile,
      isFolder: !!isFile,
      size: 0,
      writable: false,
    };
  });
}
