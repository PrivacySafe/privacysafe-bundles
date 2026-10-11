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
import { SQLiteOn3NStorage } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import { ContactDB, objectFromQueryExecResult } from '../dataset/contacts-db.ts';
import { CONTACTS_DB_FILE } from '../constants.ts';
import { syncUpload } from './sync-upload.ts';
import { syncAdopt } from './sync-adopt.ts';
import { syncDownload } from './sync-download.ts';
import {
  ensureUniqueContactIds, normalizeContactRow, resolveDbFileConflict,
} from './db-file-conflict.ts';
import  { ContactEvent, RawPerson } from '../../src/types/index.ts';

export async function handleDbFileSyncStatus({ fs, sqlite, contactDbSrv, emitStorageEvent }: {
  fs: web3n.files.WritableFS;
  sqlite: SQLiteOn3NStorage;
  contactDbSrv: ContactDB;
  emitStorageEvent: (event: ContactEvent) => void;
}) {
  const dbFileSyncStatus = await fs.v?.sync?.status(CONTACTS_DB_FILE);
  if (!dbFileSyncStatus) {
    return;
  }

  switch (dbFileSyncStatus.state) {
    case 'unsynced': {
      await syncUpload({
        fs,
        path: CONTACTS_DB_FILE,
        emitStorageEvent,
      });
      break;
    }

    case 'behind': {
      await syncAdopt({
        fs,
        path: CONTACTS_DB_FILE,
        opts: { remoteVersion: dbFileSyncStatus.remote!.latest },
        emitStorageEvent,
      });
      const isRemoteVersionOnDisk = await fs.v?.sync?.isRemoteVersionOnDisk(
        CONTACTS_DB_FILE,
        dbFileSyncStatus.remote!.latest!,
      );

      if (isRemoteVersionOnDisk !== 'complete') {
        await syncDownload({
          fs,
          path: CONTACTS_DB_FILE,
          version: dbFileSyncStatus.remote!.latest!,
          emitStorageEvent,
        });
      }

      await sqlite.reloadDb();
      emitStorageEvent({ event: 'update:contact-list' });
      break;
    }

    case 'conflicting': {
      // No sync:start of its own here. syncUpload and syncAdopt each open and
      // close the indicator for what they do; an extra one opened here has no
      // closer of its own, and in the branch below the only thing that would
      // have closed it - an 'upload-done' event - never arrives when the
      // upload cannot get through. The watchdog then re-opened it every minute
      // and the progress bar ran for the rest of the session.
      const { bytes } = await fs.v!.readBytes(
        CONTACTS_DB_FILE,
        undefined,
        undefined,
        { remoteVersion: dbFileSyncStatus.remote!.latest },
      );

      const sqliteTemp = await SQLiteOn3NStorage.makeReadonly(bytes!);
      const [sqlValueRemote] = sqliteTemp.db.exec('SELECT * FROM contacts');
      const [sqlValue] = sqlite.db.exec('SELECT * FROM contacts');
      const contactListRemote = objectFromQueryExecResult<RawPerson>(sqlValueRemote)
        .map(normalizeContactRow);
      const contactList = objectFromQueryExecResult<RawPerson>(sqlValue)
        .map(normalizeContactRow);

      const { areThereDifferences, isLocalAheadOfRemote, resolvedContactList } =
        resolveDbFileConflict(contactListRemote, contactList);

      if (isLocalAheadOfRemote) {
        // THE INVARIANT: while this device holds rows the server does not, the
        // remote version must not be adopted. adoptRemote drops the local
        // branch outright, and the merge then exists only in memory - so any
        // failure between the adoption and the write loses those rows for good.
        //
        // Adopting FIRST and writing the merge on top was tried, to keep the
        // upload out of the conflicting state. It does not survive contact with
        // the platform: after adopting version R the next local write takes
        // number R+1, and the platform keeps written version numbers in a
        // 60-second cache that its GC never clears, so the write fails with
        // "Version R+1 already exists" whenever the dropped branch had got that
        // far - which is the normal case after two local saves. The live test
        // of 2026-09-13 lost a contact created offline exactly this way. See
        // finding 4 in plans/platform-findings-2026-09-13.md.
        //
        // So the merge goes into the LOCAL branch, where it is durable, and is
        // published from there. If the upload loses a race with the other
        // device it stays unsynced and is published after a restart - slow, but
        // nothing is ever lost.
        //
        // ensureUniqueContactIds because the merge keeps every remote-only row
        // under the id it was created with on the other device, and two devices
        // working offline can pick the same randomStr(8). Without it the insert
        // of the clashing row throws contactAlreadyExists and the whole merge
        // is lost.
        //
        // `true` makes it one save for the whole merge: insertContactInto saves
        // the file after EVERY row otherwise, which wrote a local version per
        // contact and ran the version numbers far ahead of the server's.
        //
        // And the table is rewritten only when the REMOTE brought something:
        // otherwise the merge already equals the local table, and rewriting it
        // would write a new local version for nothing. While an upload cannot
        // get through, this pass runs once a minute - in the live test of
        // 2026-09-14 that took the local version from 9 to 41 in half an hour,
        // every one of them identical.
        if (areThereDifferences) {
          await contactDbSrv.updateContactsTable(
            ensureUniqueContactIds(resolvedContactList), true,
          );
        }
        await syncUpload({
          fs,
          path: CONTACTS_DB_FILE,
          opts: { uploadVersion: dbFileSyncStatus.remote!.latest! + 1 },
          emitStorageEvent,
        });
      } else {
        // Nothing of ours is at stake: the merge equals the remote version, so
        // adopting it is both safe and the cheapest way out of the conflict.
        await syncAdopt({
          fs,
          path: CONTACTS_DB_FILE,
          opts: { remoteVersion: dbFileSyncStatus.remote!.latest! },
          emitStorageEvent,
        });
        await sqlite.reloadDb();
      }

      emitStorageEvent({ event: 'update:contact-list' });
      break;
    }

    // no default
  }
}
