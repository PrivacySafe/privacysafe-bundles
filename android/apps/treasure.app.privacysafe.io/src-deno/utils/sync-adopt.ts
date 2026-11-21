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

export async function syncAdopt({
  fs,
  path,
  opts,
  emitEvent,
  actionIfSuccess,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  opts?: web3n.files.OptionsToAdopteRemote;
  emitEvent: (event: TreasureEvent) => void;
  actionIfSuccess?: () => void | Promise<void>;
}): Promise<void> {
  if (actionIfSuccess && typeof actionIfSuccess !== 'function') {
    throw new Error(`[syncAdopt] The argument 'actionIfSuccess' is not a function`);
  }

  let error;
  try {
    emitEvent({
      event: 'sync:start',
      payload: { path: path || 'root', type: 'adopt' },
    });
    await fs.v?.sync?.adoptRemote(path, opts);

    if (actionIfSuccess) {
      await actionIfSuccess();
    }
  } catch (err) {
    error = err;
    if ((err as web3n.ConnectException).type === 'connect') {
      return undefined;
    }

    throw err;
  } finally {
    emitEvent({
      event: 'sync:end',
      payload: {
        path: path || 'root',
        type: 'adopt',
        ...(!!error && { error: (error as web3n.files.FSSyncException).message || JSON.stringify(error) }),
      },
    });
  }
}
