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
import type { TreasureEvent } from '../../shared/@types';
import type { TreasureFileSrv } from '../srv.types.ts';
import { GROUPS_FILE_NAME, IMAGES_FOLDER } from '../../shared/constants.ts';
import { handleFileSyncedStatus } from './handle-diff-sys-statuses/handle-file-synced-status.ts';
import { handleFileBehindStatus } from './handle-diff-sys-statuses/handle-file-behind-status.ts';
import { handleFileUnsyncedStatus } from './handle-diff-sys-statuses/handle-file-unsynced-status.ts';
import { handleRecordConflictingStatus } from './handle-diff-sys-statuses/handle-record-conflicting-status.ts';
import { handleGroupsConflictingStatus } from './handle-diff-sys-statuses/handle-groups-conflicting-status.ts';
import { handleFolderUnsyncedStatus } from './handle-diff-sys-statuses/handle-folder-unsynced-status.ts';
import { handleFolderBehindStatus } from './handle-diff-sys-statuses/handle-folder-behind-status.ts';
import { handleFolderConflictingStatus } from './handle-diff-sys-statuses/handle-folder-conflicting-status.ts';

export async function checkItemSyncState({
  path,
  fs,
  fileSrv,
  emitEvent,
}: {
  path: string;
  fs: web3n.files.WritableFS;
  fileSrv: TreasureFileSrv;
  emitEvent: (event: TreasureEvent) => void;
}) {
  const syncStatus = await fs.v?.sync?.status(path);
  // console.log(`🔔 CHECK SYNC [${path}] => ${syncStatus ? JSON.stringify(syncStatus) : '👎'}`);

  if (syncStatus) {
    switch (syncStatus.state) {
      case 'synced': {
        return handleFileSyncedStatus({ fs, path, syncStatus, emitEvent });
      }

      case 'unsynced': {
        return handleFileUnsyncedStatus({ fs, path, emitEvent });
      }

      case 'behind': {
        return handleFileBehindStatus({ fs, path, syncStatus, emitEvent });
      }

      case 'conflicting': {
        if (path === GROUPS_FILE_NAME) {
          return handleGroupsConflictingStatus({ fs, fileSrv, syncStatus, emitEvent });
        }

        return handleRecordConflictingStatus({ fs, fileSrv, fileName: path, syncStatus, emitEvent });
      }

      // no default
    }
  }
}

export async function checkFolderSyncState({
  path,
  fs,
  emitEvent,
}: {
  path: string;
  fs: web3n.files.WritableFS;
  emitEvent: (event: TreasureEvent) => void;
}) {
  try {
    const folderSyncStatus = await fs.v?.sync?.status(path);
    // console.log(`🔔 CHECK SYNC [${path || 'ROOT'}] => ${folderSyncStatus ? JSON.stringify(folderSyncStatus) : '👎'}`);
    if (folderSyncStatus) {
      switch (folderSyncStatus.state) {
        case 'unsynced': {
          return handleFolderUnsyncedStatus({ path, fs, emitEvent });
        }

        case 'behind': {
          return handleFolderBehindStatus({ path, fs, syncStatus: folderSyncStatus, emitEvent });
        }

        case 'conflicting': {
          return handleFolderConflictingStatus({ path, fs, emitEvent });
        }

        // no default
      }
    }
  } catch (err) {
    if (
      (err as web3n.files.FSSyncException).type === 'fs-sync' &&
      (err as web3n.files.FSSyncException).childNeverUploaded
    ) {
      setTimeout(async () => {
        await checkFolderSyncState({ path, fs, emitEvent });
      }, 10000);
      return;
    }

    throw err;
  }
}

export async function checkSyncFsState({
  fs,
  fileSrv,
  emitEvent,
  onProgress,
}: {
  fs: web3n.files.WritableFS;
  fileSrv: TreasureFileSrv;
  emitEvent: (event: TreasureEvent) => void;
  onProgress?: (processed: number, total: number, itemPath: string) => void;
}) {
  try {
    const rootFolderList = await fs.listFolder('');
    let imagesFolderList: web3n.files.ListingEntry[] = [];
    if (await fs.checkFolderPresence(IMAGES_FOLDER)) {
      imagesFolderList = await fs.listFolder(IMAGES_FOLDER);
    }

    const rootFiles = rootFolderList.filter(e => e.isFile);
    const imageFiles = imagesFolderList.filter(e => e.isFile);
    const totalItems = rootFiles.length + imageFiles.length + 2;
    let processed = 0;

    for (const entity of rootFiles) {
      const { name } = entity;
      await checkItemSyncState({
        path: name,
        fs,
        fileSrv,
        emitEvent,
      });
      processed++;
      onProgress?.(processed, totalItems, name);
    }

    for (const entity of imageFiles) {
      const { name } = entity;
      const itemPath = `${IMAGES_FOLDER}/${name}`;
      await checkItemSyncState({
        path: itemPath,
        fs,
        fileSrv,
        emitEvent,
      });
      processed++;
      onProgress?.(processed, totalItems, itemPath);
    }

    await checkFolderSyncState({ path: IMAGES_FOLDER, fs, emitEvent });
    processed++;
    onProgress?.(processed, totalItems, IMAGES_FOLDER);

    await checkFolderSyncState({ path: '', fs, emitEvent });
    processed++;
    onProgress?.(processed, totalItems, 'root');

    emitEvent({ event: 'update:records' });
  } catch (err) {
    w3n.log('error', '🔥 Error while initial checking sync state. ', err);
  }
}
