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
import { randomStr } from '../../../shared/utils/random-str.ts';
import { syncUpload } from '../sync-upload.ts';
import type { TreasureFileSrv } from '../../srv.types.ts';
import type { TreasureEvent, TreasureRecord } from '../../../shared/@types';

export async function handleRecordConflictingStatus({
  fs,
  fileSrv,
  fileName,
  syncStatus,
  emitEvent,
}: {
  fs: web3n.files.WritableFS;
  fileSrv: TreasureFileSrv;
  fileName: string;
  syncStatus: web3n.files.SyncStatus;
  emitEvent: (event: TreasureEvent) => void;
}) {
  const isServerConnection = await checkServerConnection(fs);
  if (!isServerConnection) {
    return undefined;
  }

  const remoteFileData = await fs.v?.readJSONFile<TreasureRecord>(fileName, {
    remoteVersion: syncStatus.remote!.latest!,
  });
  if (!remoteFileData) {
    throw `The remote file ${fileName} is missing`;
  }

  const localFileData = await fs.readJSONFile<TreasureRecord>(fileName);

  const newFileId = randomStr(20);
  await fileSrv.saveFile({
    ...remoteFileData.json,
    id: newFileId,
    source: fileName,
  });

  if (localFileData) {
    await fileSrv.saveFile({
      ...localFileData,
      reference: newFileId,
    });
    await syncUpload({
      fs,
      path: fileName,
      emitEvent,
    });
  }

  return syncUpload({
    fs,
    path: newFileId,
    emitEvent,
  });
}
