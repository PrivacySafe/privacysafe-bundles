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

export async function syncDownload({
  fs,
  path,
  version,
  emitEvent,
  stopErrorPropagate,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  version: number;
  emitEvent: (event: StorageEvent) => void;
  stopErrorPropagate?: boolean;
}): Promise<{ downloadTaskId: number } | undefined> {
  console.log(`[###] DOWNLOAD PROCESSING START FOR '${path}' [###]`);
  return executeFunc({
    fn: fs.v!.sync!.startDownload.bind(fs.v!.sync),
    fnArgs: [path, version],
    retryCount: 2,
    defaultValue: undefined,
    doesErrorPropagateStop: stopErrorPropagate,
    actionIfError: err => {
      console.error(`🔥 DOWNLOAD PROCESSING ERROR FOR '${path}'. `, err);

      const { path: errPath } = err as web3n.files.FSSyncException;
      emitEvent({
        event: 'download:end',
        payload: { path: errPath ? errPath.replace('./', '') : 'root' },
      });
      emitEvent({
        event: 'sync:error',
        payload: {
          path: errPath.replace('./', ''),
          message: (err as web3n.files.FSSyncException).message || JSON.stringify(err),
        },
      });
    },
  });
}
