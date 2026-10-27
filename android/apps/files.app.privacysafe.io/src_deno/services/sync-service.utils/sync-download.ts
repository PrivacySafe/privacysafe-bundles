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
  return executeFunc({
    fn: fs.v!.sync!.startDownload.bind(fs.v!.sync),
    fnArgs: [path, version],
    // the call only schedules a download, and a repeated call returns the same task,
    // so a slow server must not make it fail by a timeout
    timeoutValue: 0,
    retryCount: 2,
    defaultValue: undefined,
    doesErrorPropagateStop: stopErrorPropagate,
    actionIfError: err => {
      console.error(`🔥 DOWNLOAD PROCESSING ERROR FOR '${path}'. `, err);

      emitEvent({
        event: 'download:end',
        payload: { path: formatPath(path) },
      });
      emitEvent({
        event: 'sync:error',
        payload: {
          path: formatPath(path),
          message: (err as web3n.files.FSSyncException)?.message || JSON.stringify(err),
        },
      });
    },
  });
}
