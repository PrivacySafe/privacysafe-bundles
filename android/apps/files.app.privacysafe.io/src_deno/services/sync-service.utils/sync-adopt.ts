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
/// <reference path="../../../@types/platform-defs/injected-w3n.d.ts" />
import type { StorageEvent } from '../../../shared/types/index.ts';
import { executeFunc } from '../../../shared/utils/execute-function.ts';
import { formatPath } from '../../../shared/utils/various.ts';

export async function syncAdopt({
  fs,
  path,
  opts,
  emitEvent,
  stopErrorPropagate,
  actionIfSuccess,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  opts?: web3n.files.OptionsToAdopteRemote;
  emitEvent: (event: StorageEvent) => void;
  stopErrorPropagate?: boolean;
  actionIfSuccess?: () => void | Promise<void>;
}): Promise<void> {
  emitEvent({
    event: 'adoptRemote:start',
    payload: { path: path.replace('./', '') },
  });

  return executeFunc({
    fn: fs.v!.sync!.adoptRemote.bind(fs.v!.sync),
    fnArgs: [path, opts],
    defaultValue: undefined,
    doesErrorPropagateStop: stopErrorPropagate,
    timeoutValue: 0,
    actionIfError: err => {
      console.error(`🔥 ADOPT ERROR FOR '${path}' .`, err);
      emitEvent({
        event: 'sync:error',
        payload: {
          path: formatPath(path),
          message: (err as web3n.files.FSSyncException)?.message || JSON.stringify(err),
        },
      });
    },
    actionIfSuccess,
    actionInFinally: () => {
      emitEvent({
        event: 'adoptRemote:end',
        payload: { path: path.replace('./', ''), isNecessaryReread: true },
      });
    },
  });
}
