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
// @deno-types="../../shared-libs/sqlite-on-3nstorage/index.d.ts"
import { SQLiteOn3NStorage } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import { ContactDB, objectFromQueryExecResult } from '../dataset/contacts-db.ts';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from '../constants.ts';
import { syncUpload } from './sync-upload.ts';
import {
  ensureUniqueContactIds, normalizeContactRow, resolveDbFileConflict,
} from './db-file-conflict.ts';
import type { ContactEvent, RawPerson } from '../../src/types/index.ts';

// Re-exported for existing importers; the implementation moved to the pure
// db-file-conflict module, so that the backup service can reach it without
// pulling in the sqlite runtime this file imports.
export { ensureUniqueContactIds };

/** Children this app puts into its root folder. Anything else is unexpected. */
const knownRootChildren = [CONTACTS_DB_FILE, IMAGES_FOLDER];

/**
 * True when the remote branch of the root brought its own object under this
 * name: either both branches have a child so named but backed by different
 * objects (nameOverlaps), or only the remote branch has it at all.
 */
function isInRemoteBranch(diff: web3n.files.FolderDiff, name: string): boolean {
  return !!diff.nameOverlaps?.includes(name)
  || !!diff.added?.inRemote?.includes(name);
}

/**
 * Merges the remote contacts db into the local one, in place: the local sqlite
 * handle stays the same object, so the service's open file handle keeps working.
 */
async function absorbRemoteDbFile(
  fs: web3n.files.WritableFS,
  sqlite: SQLiteOn3NStorage,
  contactDbSrv: ContactDB,
  remoteVersion: number,
): Promise<void> {
  const remoteDbFile = await fs.v!.sync!.getRemoteFileItem('', CONTACTS_DB_FILE, remoteVersion);
  const bytes = await remoteDbFile.readBytes();
  if (!bytes) {
    await w3n.log('warning', `Remote ${CONTACTS_DB_FILE} of the root's remote version is empty`);
    return;
  }

  const sqliteRemote = await SQLiteOn3NStorage.makeReadonly(bytes);
  const [sqlValueRemote] = sqliteRemote.db.exec('SELECT * FROM contacts');
  const [sqlValue] = sqlite.db.exec('SELECT * FROM contacts');
  const contactListRemote = objectFromQueryExecResult<RawPerson>(sqlValueRemote)
    .map(normalizeContactRow);
  const contactList = objectFromQueryExecResult<RawPerson>(sqlValue)
    .map(normalizeContactRow);

  const { resolvedContactList } = resolveDbFileConflict(contactListRemote, contactList);
  // Rewritten unconditionally, unlike in handleDbFileSyncStatus: there the
  // alternative to a merge is adopting the remote file, which here would mean
  // dropping the local object the root conflict is about.
  await contactDbSrv.updateContactsTable(ensureUniqueContactIds(resolvedContactList), true);
  if (resolvedContactList.length === 0) {
    // updateContactsTable saves the file from its LAST insert, so an empty list
    // would leave the dropped table unsaved - and reloadDb would then bring the
    // pre-merge content back.
    await sqlite.saveToFile({ skipUpload: true });
  }

  // Re-read the file, so that the in-memory db and the file on disk cannot
  // disagree - the same closing step handleDbFileSyncStatus takes.
  await sqlite.reloadDb();
}

/**
 * Copies over the avatars that only the remote branch's `images` folder has.
 * Avatar names are randomStr(20) and `${id}-mini`, so a name present on both
 * sides is the same file; the local copy is kept.
 */
async function absorbRemoteImages(
  fs: web3n.files.WritableFS,
  remoteVersion: number,
): Promise<void> {
  const remoteImages = await fs.v!.sync!.getRemoteFolderItem('', IMAGES_FOLDER, remoteVersion);
  const remoteList = await remoteImages.listFolder('');
  const localList = await fs.listFolder(IMAGES_FOLDER);
  const localNames = localList.filter(entry => entry.isFile).map(entry => entry.name);

  for (const entry of remoteList) {
    if (!entry.isFile || localNames.includes(entry.name)) {
      continue;
    }

    try {
      const txt = await remoteImages.readTxtFile(entry.name);
      await fs.writeTxtFile(`${IMAGES_FOLDER}/${entry.name}`, txt);
    } catch (err) {
      // One unreadable avatar must not abandon the merge: the contact rows are
      // what matters, and a missing image file is handled by getImage.
      await w3n.log('warning', `Could not copy the remote avatar file ${entry.name}`, err);
    }
  }
}

/**
 * Resolves a `conflicting` state of the app's ROOT folder, keeping the locally
 * created objects.
 *
 * The conflict this handles is a name overlap: two devices each created their
 * own `contacts-db` file and `images` folder under the same names, because
 * neither looked at the server before creating them. adoptRemote('') is not an
 * option - in a conflicting state it throws the local branch away together with
 * the locally created children, i.e. the local contacts db.
 *
 * So the remote content is absorbed INTO the local objects, and the local root
 * is then published over the remote version. The remote `contacts-db` and
 * `images` objects are orphaned on the server by this: their content has been
 * taken over, and after the root upload nothing references them any more.
 */
export async function resolveRootFolderConflict({ fs, sqlite, contactDbSrv, emitStorageEvent }: {
  fs: web3n.files.WritableFS;
  sqlite: SQLiteOn3NStorage;
  contactDbSrv: ContactDB;
  emitStorageEvent: (event: ContactEvent) => void;
}): Promise<void> {
  const sync = fs.v?.sync;
  if (!sync) {
    return;
  }

  const status = await sync.status('');
  if (status.state !== 'conflicting') {
    return;
  }

  const remoteVersion = status.remote!.latest!;

  emitStorageEvent({ event: 'sync:start', payload: { path: 'root' } });
  try {
    const diff = await sync.diffCurrentAndRemoteFolderVersions('', remoteVersion);
    if (!diff) {
      await w3n.log('warning', 'Root folder is conflicting, but no diff is reported');
      return;
    }

    reportUnexpectedDiffShape(diff);

    if (isInRemoteBranch(diff, CONTACTS_DB_FILE)) {
      await absorbRemoteDbFile(fs, sqlite, contactDbSrv, remoteVersion);
    }

    if (isInRemoteBranch(diff, IMAGES_FOLDER)) {
      await absorbRemoteImages(fs, remoteVersion);
    }

    // Strictly children before the parent: uploading a folder whose child was
    // never uploaded is refused with fs-sync/childNeverUploaded. Both children
    // are offered regardless of the diff, because either of them can be the
    // local-only object that the root upload would trip over. syncUpload skips
    // paths that need no upload.
    await syncUpload({ fs, path: CONTACTS_DB_FILE, emitStorageEvent, immediately: true });
    await syncUpload({ fs, path: IMAGES_FOLDER, emitStorageEvent, immediately: true });
    // The root is conflicting, and without an explicit version syncUpload
    // silently declines it - see needsExplicitUploadVersion.
    await syncUpload({
      fs,
      path: '',
      opts: { uploadVersion: remoteVersion + 1 },
      emitStorageEvent,
      immediately: true,
    });
  } finally {
    emitStorageEvent({ event: 'sync:end', payload: { path: 'root' } });
  }

  emitStorageEvent({ event: 'update:contact-list' });
}

/**
 * Logs the parts of the diff this app cannot produce and therefore does not
 * act on - removals, renames and rekeying of root children, or a child under an
 * unknown name. Guessing at those would be worse than leaving them be.
 */
function reportUnexpectedDiffShape(diff: web3n.files.FolderDiff): void {
  const unknownNames = [
    ...(diff.nameOverlaps ?? []),
    ...(diff.added?.inRemote ?? []),
  ].filter(name => !knownRootChildren.includes(name));

  const isUnexpected = (unknownNames.length > 0)
  || !!diff.removed?.inRemote?.length
  || !!diff.removed?.inLocal?.length
  || !!diff.renamed?.length
  || !!diff.rekeyed?.length;

  if (isUnexpected) {
    w3n.log('warning', 'Unexpected shape of root folder conflict', diff);
  }
}
