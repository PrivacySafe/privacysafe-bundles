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

/** A removal waiting for upload is reported with localVersion -1; only a new version is an upload. */
export function isUploadingNewVersion(status: web3n.files.SyncStatus | undefined): boolean {
  return !!status?.uploading && status.uploading.localVersion >= 0;
}

/**
 * Starts the upload. The platform refuses a second start with `alreadyUploading`,
 * which is not a failure when the status confirms the running upload: its task is
 * returned then. Without such an upload the refusal comes from a stale task of a
 * failed upload, and it stays an error.
 */
async function startUploadOrJoin(
  fs: web3n.files.WritableFS,
  path: string,
  opts?: web3n.files.OptionsToUploadLocal,
): Promise<{ uploadVersion: number; uploadTaskId: number } | undefined> {
  const sync = fs.v!.sync!;
  try {
    return await sync.startUpload(path, opts);
  } catch (err) {
    const syncErr = err as web3n.files.FSSyncException;
    if (syncErr.alreadyUploading && syncErr.uploadTaskId !== undefined) {
      const status = await sync.status(path).catch(() => undefined);
      if (isUploadingNewVersion(status)) {
        return { uploadTaskId: syncErr.uploadTaskId, uploadVersion: status!.uploading!.remoteVersion };
      }
    }
    throw err;
  }
}

export async function syncUpload({
  fs,
  path,
  opts,
  emitEvent,
  stopErrorPropagate,
}: {
  fs: web3n.files.WritableFS;
  path: string;
  opts?: web3n.files.OptionsToUploadLocal;
  emitEvent: (event: StorageEvent) => void;
  stopErrorPropagate?: boolean;
}): Promise<{ uploadVersion: number; uploadTaskId: number } | undefined> {
  return executeFunc({
    fn: startUploadOrJoin,
    fnArgs: [fs, path, opts],
    // the call only schedules an upload, so a slow server must not make it fail by a timeout
    timeoutValue: 0,
    retryCount: 2,
    defaultValue: undefined,
    doesErrorPropagateStop: stopErrorPropagate,
    actionIfError: err => {
      console.error(`🔥 UPLOAD PROCESSING ERROR FOR '${path}'. `, err);

      emitEvent({
        event: 'upload:end',
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
