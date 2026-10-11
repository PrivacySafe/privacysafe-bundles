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
import { checkServerConnection } from '../check-server-connection.ts';
import { syncUpload } from '../sync-upload.ts';
import { syncDownload } from '../sync-download.ts';
import type { TreasureEvent } from '../../../shared/@types';

export async function handleImageConflictingStatus({
  fs,
  fileName,
  syncStatus,
  emitEvent,
}: {
  fs: web3n.files.WritableFS;
  fileName: string;
  syncStatus: web3n.files.SyncStatus;
  emitEvent: (event: TreasureEvent) => void;
}) {
  const isServerConnection = await checkServerConnection(fs);
  if (!isServerConnection) {
    return undefined;
  }

  const remoteFileStat = await fs.v?.stat(fileName);
  if (!remoteFileStat) {
    throw `The remote file ${fileName} is missing`;
  }
  const fileStat = await fs.stat(fileName);
  const remoteFileMtime = remoteFileStat.mtime ? new Date(remoteFileStat!.mtime).getTime() : Date.now();
  const fileMtime = fileStat?.mtime ? new Date(fileStat.mtime).getTime() : Date.now();

  if (fileMtime > remoteFileMtime) {
    await syncUpload({
      fs,
      path: fileName,
      emitEvent,
      opts: {
        uploadVersion: syncStatus.remote!.latest! + 1,
      },
    });
  } else {
    await fs.v?.sync?.adoptRemote(fileName, { remoteVersion: syncStatus.remote!.latest });
    await syncDownload({
      fs,
      path: fileName,
      version: syncStatus.remote!.latest!,
      emitEvent,
    });
  }
}
