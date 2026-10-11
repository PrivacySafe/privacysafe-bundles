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
import type { StartupEvent } from '../types/inbox-srv.types.ts';
import { makeLogger } from '../../shared/utils/logger.ts';

type WritableFS = web3n.files.WritableFS;
type FileException = web3n.files.FileException;

const log = makeLogger('InboxMigration');

/** The whole SQLite database, as a single file in the fs root. */
const DB_FNAME = 'storage-db';
/** Root of the labelled file store, i.e. attachments and their xattrs. */
const FILES_FOLDER = 'mail-app-files';
/**
 * Written in the local fs once the synced one is known to be empty. Its point is
 * to keep the synced fs out of the start path entirely: getting its root alone
 * measured 170-250 ms, which is more than the two presence checks it enables.
 */
const MIGRATION_DONE_FNAME = 'migrated-to-local-fs';

export type ReportStartup = (event: StartupEvent) => void;

/**
 * Moves everything this app keeps into the local fs, leaving its synced fs
 * empty.
 *
 * Data used to live in the synced fs so that the user's devices would see the
 * same mailbox. That is being replaced by synchronization over messages, which
 * makes the synced fs both unnecessary and expensive: reading the database file
 * on start can block on pulling a version from the server, and attachments are
 * exactly the kind of content a versioned synced store handles worst.
 *
 * Runs before anything opens either of these, and is resumable: each item is
 * removed from the synced fs as soon as it is in the local one, so an
 * interrupted run leaves the rest to the next start.
 */
export async function migrateAppDataToLocalFS(report: ReportStartup): Promise<void> {
  const localFS = await w3n.storage!.getAppLocalFS();
  // Every start after the migration is through: the synced fs is not opened at
  // all, which is the point of moving off it.
  if (await localFS.checkFilePresence(MIGRATION_DONE_FNAME)) {
    return;
  }

  const syncedFS = await w3n.storage!.getAppSyncedFS();
  const complete = await migrateToLocalFS(syncedFS, localFS, report);
  if (complete) {
    await localFS.writeTxtFile(MIGRATION_DONE_FNAME, 'done');
  }
}

/**
 * @returns true if the synced fs is now empty of this app's data, i.e. there is
 * nothing left for a later start to move.
 */
export async function migrateToLocalFS(
  syncedFS: WritableFS,
  localFS: WritableFS,
  report: ReportStartup,
): Promise<boolean> {
  const [hasDb, hasFiles] = await Promise.all([
    syncedFS.checkFilePresence(DB_FNAME),
    syncedFS.checkFolderPresence(FILES_FOLDER),
  ]);
  if (!hasDb && !hasFiles) {
    return true;
  }

  log.info(`Moving app data to the local fs (db: ${hasDb}, files: ${hasFiles})`);

  if (hasDb) {
    report({ stage: 'migrating-db' });
    await migrateDbFile(syncedFS, localFS);
  }

  return hasFiles ? await migrateStoredFiles(syncedFS, localFS, report) : true;
}

async function migrateDbFile(syncedFS: WritableFS, localFS: WritableFS): Promise<void> {
  // A local file that already has content wins: this migration may have been
  // interrupted after it ran, and the app has been writing locally since.
  if (!(await hasContent(localFS, DB_FNAME))) {
    const bytes = await syncedFS.readBytes(DB_FNAME);
    if (bytes && bytes.length > 0) {
      await localFS.writeBytes(DB_FNAME, bytes);
    }
  }
  await syncedFS.deleteFile(DB_FNAME).catch(ignoreNotFound);
}

async function migrateStoredFiles(
  syncedFS: WritableFS,
  localFS: WritableFS,
  report: ReportStartup,
): Promise<boolean> {
  const paths = await listFilesUnder(syncedFS, FILES_FOLDER);
  const total = paths.length;
  report({ stage: 'migrating-files', done: 0, total });

  let done = 0;
  let failed = 0;
  for (const path of paths) {
    try {
      await migrateFile(syncedFS, localFS, path);
    } catch (err) {
      // One unreadable attachment must not keep the app from starting; it stays
      // in the synced fs, and the next start tries again.
      failed += 1;
      log.error(`Failed to move ${path} to the local fs`, err);
    }
    done += 1;
    report({ stage: 'migrating-files', done, total });
  }

  // Removing the folder takes its content with it, so it only happens once
  // every file is known to be in the local fs. Otherwise the leftovers keep the
  // folder, and with it the condition that starts this migration again.
  if (failed > 0) {
    log.info(`${failed} of ${total} files stayed in the synced fs; will try them again on next start`);
    return false;
  }
  try {
    await syncedFS.deleteFolder(FILES_FOLDER, true);
    return true;
  } catch (err) {
    log.info(`Synced fs folder ${FILES_FOLDER} is not removed yet`, err);
    return false;
  }
}

/**
 * `saveFolder()` cannot do this job: it copies bytes only, so the xattrs the
 * store keeps its item ids, file names and message reference counts in would be
 * lost. Hence a file at a time, xattrs read before and written after.
 *
 * The bytes themselves never cross the IPC boundary: `saveFile()` streams them
 * inside the platform, and creates the missing bucket folders on the way.
 */
async function migrateFile(syncedFS: WritableFS, localFS: WritableFS, path: string): Promise<void> {
  if (!(await localFS.checkFilePresence(path))) {
    const xattrs = await readXAttrs(syncedFS, path);
    const file = await syncedFS.readonlyFile(path);
    await localFS.saveFile(file, path);
    if (Object.keys(xattrs).length > 0) {
      await localFS.updateXAttrs(path, { set: xattrs });
    }
  }
  await syncedFS.deleteFile(path).catch(ignoreNotFound);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readXAttrs(fs: WritableFS, path: string): Promise<Record<string, any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xattrs: Record<string, any> = {};
  for (const name of await fs.listXAttrs(path)) {
    xattrs[name] = await fs.getXAttr(path, name);
  }
  return xattrs;
}

async function listFilesUnder(fs: WritableFS, root: string): Promise<string[]> {
  const found: string[] = [];
  const foldersToRead = [root];
  while (foldersToRead.length > 0) {
    const folder = foldersToRead.pop()!;
    const lst = await fs.listFolder(folder).catch((exc: FileException) => {
      if (exc.notFound) {
        return [];
      }
      throw exc;
    });
    for (const entry of lst) {
      const path = `${folder}/${entry.name}`;
      if (entry.isFolder) {
        foldersToRead.push(path);
      } else if (entry.isFile) {
        found.push(path);
      }
    }
  }
  return found;
}

async function hasContent(fs: WritableFS, path: string): Promise<boolean> {
  const stats = await fs.stat(path).catch((exc: FileException) => {
    if (exc.notFound) {
      return undefined;
    }
    throw exc;
  });
  return !!stats?.size;
}

function ignoreNotFound(exc: FileException): void {
  if (!exc.notFound) {
    throw exc;
  }
}
