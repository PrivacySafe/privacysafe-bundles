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
import type { TreasureEvent } from '../../shared/@types/common.types.ts';

export async function syncDownload({
  fs,
  path,
  version,
  emitEvent,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  version: number;
  emitEvent: (event: TreasureEvent) => void;
}): Promise<{ downloadTaskId: number } | undefined> {
  try {
    return fs.v?.sync?.startDownload(path, version);
  } catch (err) {
    if ((err as web3n.ConnectException).type === 'connect') {
      return undefined;
    }

    emitEvent({
      event: 'sync:end',
      payload: {
        path: path || 'root',
        type: 'download',
        ...(!!err && { error: (err as web3n.files.FSSyncException).message || JSON.stringify(err) }),
      },
    });

    throw err;
  }
}
