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
import { getEntityStat } from './get-stats-safely.ts';

/**
 * Size of a folder's content, walked only as far as the given limit.
 *
 * The walk stops as soon as the running total passes `limit` and says so with
 * `exceeded`, leaving `size` meaningless in that case. This exists for deciding
 * whether a folder is small enough to be worth copying: a decision that needs
 * no more than "is it over the threshold", and must not cost a full walk of a
 * folder that turns out to hold gigabytes.
 */
export async function folderSizeUpTo(
  folder: web3n.files.ReadonlyFS,
  limit: number,
): Promise<{ size: number; exceeded: boolean }> {
  let size = 0;

  async function walk(fs: web3n.files.ReadonlyFS): Promise<boolean> {
    let entries: web3n.files.ListingEntry[];
    try {
      entries = await fs.listFolder('');
    } catch (exc) {
      // An unreadable folder is reported as exceeding the limit: its size is
      // unknown, and an unknown size must not end up in the copying branch.
      await w3n.log('error', `Fail to list folder ${fs.name} while sizing it up`, exc);
      return true;
    }

    for (const { name, isFile, isFolder } of entries) {
      if (isFile) {
        const { size: fileSize = 0 } = await getEntityStat(fs, name, true);
        size += fileSize;
        if (size > limit) {
          return true;
        }
      } else if (isFolder) {
        const subFolder = await fs.readonlySubRoot(name);
        if (await walk(subFolder)) {
          return true;
        }
      }
    }
    return false;
  }

  const exceeded = await walk(folder);
  return { size, exceeded };
}
