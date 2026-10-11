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
import type { TreasureEvent, TreasureGroup } from '../../../shared/@types';
import { GROUPS_FILE_NAME } from '../../../shared/constants.ts';
import type { TreasureFileSrv } from '../../srv.types.ts';

export async function handleGroupsConflictingStatus({
  fs,
  fileSrv,
  syncStatus,
  emitEvent,
}: {
  fs: web3n.files.WritableFS;
  fileSrv: TreasureFileSrv;
  syncStatus: web3n.files.SyncStatus;
  emitEvent: (event: TreasureEvent) => void;
}) {
  const isServerConnection = await checkServerConnection(fs);
  if (!isServerConnection) {
    return undefined;
  }

  const remoteFileData = await fs.v?.readJSONFile<TreasureGroup[]>(GROUPS_FILE_NAME, {
    remoteVersion: syncStatus.remote!.latest,
  });
  if (!remoteFileData) {
    throw `The remote file ${GROUPS_FILE_NAME} is missing`;
  }

  const currentFileData = await fs.readJSONFile<TreasureGroup[]>(GROUPS_FILE_NAME);
  const currentFileDataIds = new Set((currentFileData || []).map(item => item.id));
  const updatedData = [
    ...currentFileData,
    ...(remoteFileData?.json || []).filter(item => !currentFileDataIds.has(item.id)),
  ];

  await fileSrv.updateFile(updatedData, GROUPS_FILE_NAME);
  return syncUpload({
    fs,
    path: GROUPS_FILE_NAME,
    opts: { uploadVersion: syncStatus.remote!.latest! + 1 },
    emitEvent,
  });
}
