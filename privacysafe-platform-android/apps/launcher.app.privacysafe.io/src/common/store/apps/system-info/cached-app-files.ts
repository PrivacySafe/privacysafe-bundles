/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { WeakCache } from '@/common/lib-common/weak-cache';
import { NamedProcs } from '@v1nt1248/3nclient-lib/utils';

export function makeCachedAppFiles() {

  const cache = new WeakCache<string, Uint8Array>();
  const procs = new NamedProcs();

  async function getFileBytes(appId: string, version: string, path: string): Promise<Uint8Array | undefined> {
    const key = keyFor(appId, version, path);
    const fileBytes = cache.get(key);
    if (fileBytes) {
      return fileBytes;
    }
    const proc = procs.getP<Uint8Array | undefined>(key);
    if (proc) {
      // ToDo promise from NamedProcs should've been returning promise,
      //      but, now it returns undefined, and we work around 
      await proc;
      return cache.get(key);
    }
    return procs.start(key, async () => {
      const fileBytes = await w3n.system!.apps!.installer!.getAppFileBytes(appId, path, version);
      if (fileBytes) {
        cache.set(key, fileBytes);
      }
      return fileBytes;
    });
  }

  function keyFor(appId: string, version: string, path: string): string {
    return `${appId}-${version}-${path}`;
  }

  return getFileBytes;
}
