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
// Where the automatic backups live: one folder of the app's synced storage,
// one file per device in it (see doc/08-backup-and-restore.md §11.2).
//
// Everything the platform's synchronization asks of the app is in this file
// and nowhere else - adopting remote versions, uploading, resolving a
// conflicting folder - so that the service above it reads as "list, read,
// write, remove", and the specs can put an in-memory folder in its place.
//
// Rules the platform imposes (platform-issues-2026-11-09.md):
//  - П14: a failed upload emits no event, so every upload is AWAITED and its
//    rejection is the failure;
//  - П19: two operations on one object at once end in EEXIST, so the caller
//    runs everything here one at a time (see the SingleProc in auto-backup.ts);
//  - N5/N6: remote-change events may come late or not at all, so nothing here
//    waits for one - the state is always asked for with status().
import { AUTO_BACKUP_FILE_SUFFIX, AUTO_BACKUP_FOLDER } from '../../../shared-libs/constants/auto-backup.ts';

export interface AutoBackupStorage {
  /** Names of the files in the folder, after bringing it up to the server's version. */
  list(): Promise<string[]>;
  /** Bytes of a file, after bringing it up to the server's version. */
  read(name: string): Promise<Uint8Array | undefined>;
  /** Writes this device's file and uploads it, with the folder when that is new. */
  write(name: string, bytes: Uint8Array): Promise<void>;
  /** Removes a file of a dead device and uploads the folder. */
  remove(name: string): Promise<void>;
}

export function fileNameOfDevice(deviceId: string): string {
  return `${deviceId}${AUTO_BACKUP_FILE_SUFFIX}`;
}

export function deviceIdOfFileName(name: string): string | undefined {
  return name.endsWith(AUTO_BACKUP_FILE_SUFFIX) && (name.length > AUTO_BACKUP_FILE_SUFFIX.length)
    ? name.slice(0, -AUTO_BACKUP_FILE_SUFFIX.length)
    : undefined;
}

type SyncAPI = web3n.files.WritableFSSyncAPI;

function isNotFound(err: unknown): boolean {
  return !!(err as web3n.files.FileException)?.notFound;
}

/**
 * The folder in the app's synced storage.
 *
 * `getFS` is called once, lazily: the app's synced FS is opened by the
 * dataset already, and this must not add a step to the start.
 */
export function syncedAutoBackupStorage(
  getFS: () => Promise<web3n.files.WritableFS> = () => w3n.storage!.getAppSyncedFS(),
): AutoBackupStorage {
  let fsPromise: Promise<{ fs: web3n.files.WritableFS; sync: SyncAPI }> | undefined;

  function open(): Promise<{ fs: web3n.files.WritableFS; sync: SyncAPI }> {
    fsPromise ??= getFS().then(fs => {
      const sync = fs.v?.sync;
      if (!sync) {
        throw new Error(`The app's synced storage has no sync API`);
      }
      return { fs, sync };
    });
    fsPromise.catch(() => {
      fsPromise = undefined;
    });
    return fsPromise;
  }

  /**
   * Brings a folder up to the server: takes the remote version when this one
   * is only behind, and when both sides changed takes in what the other side
   * added and uploads the result above the remote version.
   *
   * Taking in the remote changes wholesale is right for this folder: every
   * device writes only its own file, so the two sides of a conflict differ
   * in which files they list, never in what one file is - and a file removed
   * on both sides is a harmless conflict.
   */
  async function pullFolder(sync: SyncAPI, path: string): Promise<void> {
    const status = await sync.status(path);
    if (status.state === 'behind') {
      await sync.adoptRemote(path);
    } else if (status.state === 'conflicting') {
      await resolveFolderConflict(sync, path, status);
    }
  }

  async function resolveFolderConflict(sync: SyncAPI, path: string, status: web3n.files.SyncStatus): Promise<void> {
    const remoteVersion = status.remote?.latest;
    // A name on both sides with different objects under it: two devices made
    // the folder at the same time. Absorbing throws on that, so the remote one
    // is taken - what this device wrote into its own copy is written again by
    // write() below, which checks that its file survived.
    const diff = await sync.diffCurrentAndRemoteFolderVersions(path, remoteVersion);
    for (const name of diff?.nameOverlaps ?? []) {
      await sync.adoptRemoteFolderItem(path, name, {
        ...(remoteVersion !== undefined && { remoteVersion }),
        replaceLocalItem: true,
      });
    }
    await sync.absorbRemoteFolderChanges(path, remoteVersion !== undefined ? { remoteVersion } : undefined);
    if (remoteVersion !== undefined) {
      await sync.upload(path, { uploadVersion: remoteVersion + 1 });
    } else {
      await sync.upload(path);
    }
  }

  /**
   * Uploads a folder that has local changes. Conflicting means another device
   * changed it meanwhile; resolved the same way pullFolder resolves it.
   */
  async function pushFolder(sync: SyncAPI, path: string): Promise<void> {
    const status = await sync.status(path);
    if (status.state === 'unsynced') {
      await sync.upload(path);
    } else if (status.state === 'conflicting') {
      await resolveFolderConflict(sync, path, status);
    }
  }

  async function pullAll(): Promise<{ fs: web3n.files.WritableFS; sync: SyncAPI; folderExists: boolean }> {
    const { fs, sync } = await open();
    await pullFolder(sync, '');
    const folderExists = await fs.checkFolderPresence(AUTO_BACKUP_FOLDER);
    if (folderExists) {
      await pullFolder(sync, AUTO_BACKUP_FOLDER);
    }
    return { fs, sync, folderExists };
  }

  async function list(): Promise<string[]> {
    const { fs, folderExists } = await pullAll();
    if (!folderExists) {
      return [];
    }
    const entries = await fs.listFolder(AUTO_BACKUP_FOLDER);
    return entries.filter(entry => entry.isFile).map(entry => entry.name);
  }

  async function read(name: string): Promise<Uint8Array | undefined> {
    const { fs, sync } = await open();
    const path = `${AUTO_BACKUP_FOLDER}/${name}`;
    try {
      const status = await sync.status(path);
      if ((status.state === 'behind') || (status.state === 'conflicting')) {
        // Another device's file: only that device writes it, so its remote
        // version is the one to read.
        const remoteVersion = status.remote?.latest;
        await sync.adoptRemote(path, remoteVersion !== undefined ? { remoteVersion } : undefined);
      }
      return await fs.readBytes(path);
    } catch (err) {
      if (isNotFound(err)) {
        return undefined;
      }
      throw err;
    }
  }

  async function write(name: string, bytes: Uint8Array): Promise<void> {
    const path = `${AUTO_BACKUP_FOLDER}/${name}`;
    // Twice at most: a conflict over the folder itself (two devices made it at
    // once) is resolved by taking the other device's folder, without our file.
    for (let attempt = 1; ; attempt += 1) {
      const { fs } = await writeOnce(path, bytes);
      if (await fs.checkFilePresence(path)) {
        return;
      }
      if (attempt >= 2) {
        throw new Error(`${path} is gone after its upload; the folder was replaced by another device's`);
      }
    }
  }

  async function writeOnce(path: string, bytes: Uint8Array): Promise<{ fs: web3n.files.WritableFS }> {
    const { fs, sync } = await pullAll();
    await fs.makeFolder(AUTO_BACKUP_FOLDER);
    await fs.writeBytes(path, bytes);

    // The file first, then the folder that lists it, then the root that lists
    // the folder: a parent may name only a child the server already has.
    const fileStatus = await sync.status(path);
    if (fileStatus.state === 'conflicting') {
      // Only this device writes this file; a conflict means a previous
      // installation with the same id - which cannot happen - or a server
      // that applied an upload and answered with an error (П15). Ours wins.
      const remoteVersion = fileStatus.remote?.latest ?? 0;
      await sync.upload(path, { uploadVersion: remoteVersion + 1 });
    } else if (fileStatus.state !== 'synced') {
      await sync.upload(path);
    }
    await pushFolder(sync, AUTO_BACKUP_FOLDER);
    await pushFolder(sync, '');
    return { fs };
  }

  async function remove(name: string): Promise<void> {
    const { fs, sync, folderExists } = await pullAll();
    if (!folderExists) {
      return;
    }
    const path = `${AUTO_BACKUP_FOLDER}/${name}`;
    try {
      await fs.deleteFile(path);
    } catch (err) {
      if (isNotFound(err)) {
        // Removed by another device in the meantime.
        return;
      }
      throw err;
    }
    await pushFolder(sync, AUTO_BACKUP_FOLDER);
  }

  return { list, read, write, remove };
}
