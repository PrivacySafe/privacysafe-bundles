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

export async function syncUpload({
  fs,
  path,
  opts,
  emitEvent,
  immediately,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  opts?: web3n.files.OptionsToUploadLocal;
  emitEvent: (event: TreasureEvent) => void;
  immediately?: boolean;
}) {
  try {
    if (immediately) {
      emitEvent({
        event: 'sync:start',
        payload: { path: path || 'root', type: 'upload' },
      });
      const res = await fs.v?.sync?.upload(path, opts);
      emitEvent({
        event: 'sync:end',
        payload: { path: path || 'root', type: 'upload' },
      });
      return res;
    }

    return fs.v?.sync?.startUpload(path, opts);
  } catch (err) {
    if ((err as web3n.ConnectException).type === 'connect') {
      return undefined;
    }

    if (
      (err as web3n.files.FSSyncException).type === 'fs-sync' &&
      (err as web3n.files.FSSyncException).childNeverUploaded
    ) {
      setTimeout(() => {
        syncUpload({ fs, path, opts, emitEvent, immediately });
      }, 10000);
      return undefined;
    }

    emitEvent({
      event: 'sync:end',
      payload: {
        path: path || 'root',
        type: 'upload',
        ...(!!err && { error: (err as web3n.files.FSSyncException).message || JSON.stringify(err) }),
      },
    });

    throw err;
  }
}
