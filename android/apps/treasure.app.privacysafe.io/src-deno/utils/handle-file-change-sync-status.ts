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
import type { TreasureFileSrv } from '../srv.types.ts';
import { GROUPS_FILE_NAME, IMAGES_FOLDER } from '../../shared/constants.ts';
import { handleFileSyncedStatus } from './handle-diff-sys-statuses/handle-file-synced-status.ts';
import { handleFileUnsyncedStatus } from './handle-diff-sys-statuses/handle-file-unsynced-status.ts';
import { handleFileBehindStatus } from './handle-diff-sys-statuses/handle-file-behind-status.ts';
import { handleRecordConflictingStatus } from './handle-diff-sys-statuses/handle-record-conflicting-status.ts';
import { handleGroupsConflictingStatus } from './handle-diff-sys-statuses/handle-groups-conflicting-status.ts';
import { handleImageConflictingStatus } from './handle-diff-sys-statuses/handle-image-conflicting-status.ts';

export async function handleFileChangeSyncStatus(
  currentFileName: string,
  fs: web3n.files.WritableFS,
  fileSrv: TreasureFileSrv,
  emitEvent: (event: TreasureEvent) => void,
) {
  try {
    const fileSyncStatus = await fs.v?.sync?.status(currentFileName);
    // console.log(
    //   '🔔 HANDLE_FILE_CHANGE_SYNC_STATUS => ',
    //   fileSyncStatus ? JSON.stringify(fileSyncStatus) : '👎',
    // );

    if (!fileSyncStatus) {
      return undefined;
    }

    switch (fileSyncStatus.state) {
      case 'synced': {
        return handleFileSyncedStatus({
          fs,
          path: currentFileName,
          syncStatus: fileSyncStatus,
          emitEvent,
        });
      }

      case 'unsynced': {
        return handleFileUnsyncedStatus({
          fs,
          path: currentFileName,
          emitEvent,
        });
      }

      case 'behind': {
        return handleFileBehindStatus({
          fs,
          path: currentFileName,
          syncStatus: fileSyncStatus,
          emitEvent,
        });
      }

      case 'conflicting': {
        if (currentFileName === GROUPS_FILE_NAME) {
          return handleGroupsConflictingStatus({
            fs,
            fileSrv,
            syncStatus: fileSyncStatus,
            emitEvent,
          });
        }

        if (currentFileName.includes(IMAGES_FOLDER)) {
          return handleImageConflictingStatus({
            fs,
            fileName: currentFileName,
            syncStatus: fileSyncStatus,
            emitEvent,
          });
        }

        return handleRecordConflictingStatus({
          fs,
          fileSrv,
          fileName: currentFileName,
          syncStatus: fileSyncStatus,
          emitEvent,
        });
      }

      // no default
    }
  } catch (err) {
    console.error(`🔥 Error handling ${currentFileName} file sync status. `, err);
    throw err;
  }
}
