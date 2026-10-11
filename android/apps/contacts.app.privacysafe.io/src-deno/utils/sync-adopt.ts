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
import type { ContactEvent } from '../../src/types/index.ts';

export async function syncAdopt({ fs, path, opts, emitStorageEvent, actionIfSuccess }: {
  fs: web3n.files.WritableFS;
  path: string;
  opts?: web3n.files.OptionsToAdopteRemote;
  emitStorageEvent: (event: ContactEvent) => void;
  actionIfSuccess?: () => void | Promise<void>;
}): Promise<void> {
  if (actionIfSuccess && typeof actionIfSuccess !== 'function') {
    throw new Error(`[syncAdopt] The argument 'actionIfSuccess' is not a function`);
  }

  let error;
  try {
    emitStorageEvent({
      event: 'sync:start',
      payload: { path: path || 'root' },
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
    emitStorageEvent({
      event: 'sync:end',
      payload: {
        path: path || 'root',
        ...(!!error && { error: (error as web3n.files.FSSyncException).message || JSON.stringify(error) }),
      },
    });
  }
}
