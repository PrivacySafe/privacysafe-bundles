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
import { syncAdopt } from '../sync-adopt.ts';
import type { TreasureEvent } from '../../../shared/@types';

export async function handleFolderBehindStatus({
  path,
  fs,
  syncStatus,
  emitEvent,
}: {
  path: string;
  fs: web3n.files.WritableFS;
  syncStatus: web3n.files.SyncStatus;
  emitEvent: (event: TreasureEvent) => void;
}): Promise<void> {
  const isServerConnection = await checkServerConnection(fs);
  if (!isServerConnection) {
    return;
  }

  return syncAdopt({
    fs,
    path,
    opts: { remoteVersion: syncStatus.remote!.latest! },
    emitEvent,
  });
}
