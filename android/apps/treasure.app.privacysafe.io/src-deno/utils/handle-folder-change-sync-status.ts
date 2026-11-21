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

export async function handleFolderChangeSyncStatus({
  path,
  fs,
  emitTreasureEvent,
}: {
  path: string;
  fs: web3n.files.WritableFS;
  emitTreasureEvent: (event: TreasureEvent) => void;
}) {
  try {
    const folderSyncStatus = await fs.v?.sync?.status(path);
    // console.log(
    //   '📥 HANDLE_FOLDER_CHANGE_SYNC_STATUS => ',
    //   folderSyncStatus ? JSON.stringify(folderSyncStatus) : '👎',
    // );

    if (folderSyncStatus) {
      switch (folderSyncStatus.state) {
        case 'behind': {
          emitTreasureEvent({
            event: 'sync:start',
            payload: { path: 'root', type: 'download' },
          });
          const diff = await fs.v?.sync?.diffCurrentAndRemoteFolderVersions(path);
          const newFiles: string[] =
            diff &&
            diff.added &&
            diff.added.inRemote &&
            Array.isArray(diff.added.inRemote) &&
            diff.added.inRemote.length > 0
              ? [...diff.added.inRemote]
              : [];
          const deletedFiles: string[] =
            diff &&
            diff.removed &&
            diff.removed.inRemote &&
            Array.isArray(diff.removed.inRemote) &&
            diff.removed.inRemote.length > 0
              ? [...diff.removed.inRemote]
              : [];

          await fs.v?.sync?.adoptRemote(path, { remoteVersion: folderSyncStatus.remote!.latest });

          if (!path && newFiles.length > 0) {
            emitTreasureEvent({
              event: 'add:record',
              payload: {
                data: newFiles,
              },
            });
          }

          if (!path && deletedFiles.length > 0) {
            emitTreasureEvent({
              event: 'remove:record',
              payload: {
                data: deletedFiles,
              },
            });
          }

          emitTreasureEvent({
            event: 'sync:end',
            payload: { path: path || 'root', type: 'download' },
          });
          break;
        }

        // no default
      }
    }
  } catch (err) {
    if (
      (err as web3n.files.FSSyncException).type === 'fs-sync' &&
      (err as web3n.files.FSSyncException).childNeverUploaded
    ) {
      // TODO
      // console.log('🧿 TA-DAM => ', err);
      return;
    }

    throw err;
  }
}
