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
import type { ContactEvent } from '../../src/types/index.ts';
import { syncAdopt } from './sync-adopt.ts';

export interface RootReadiness {
  /**
   * The root folder has been reconciled with the server: its children now
   * reflect the server state, so checkFilePresence/writableFile will open the
   * existing objects instead of creating same-named new ones.
   */
  verified: boolean;
  /**
   * Local state must NOT be published while this holds. Set when the root could
   * not be reconciled (offline, or a conflict whose resolution is deferred):
   * uploading from an unverified root is what creates a second `contacts-db`
   * object on the server.
   */
  holdUploads: boolean;
  /**
   * The root is in a conflicting state and its resolution was deferred to the
   * caller, because resolving needs the sqlite handle that does not exist yet.
   * See the two-phase call in contacts-deno-srv.
   */
  conflict: boolean;
}

/**
 * Brings the app's synced root folder in line with the server BEFORE any local
 * object is opened or created.
 *
 * Why the order matters: `checkFilePresence`, `listFolder` and `writableFile`
 * only ever see the CURRENT version of the folder, never the remote branch. On
 * a second device the root starts out `behind`, so its current version has no
 * children at all - and `writableFile('contacts-db')` then creates a brand new
 * object under an already taken name. That is exactly the `nameOverlaps` root
 * conflict this module exists to prevent.
 *
 * On the reach of the offline branch: this is called after the app's synced FS
 * has been obtained, and the platform can only hand that out offline once this
 * app's folder is already on the device. Where it is not, the app does not get
 * this far at all - an already registered user still cannot start it offline,
 * which is a platform limitation reported to its authors. So `holdUploads`
 * covers a device that has run the app online at least once, and that is the
 * state the live test of 2026-08-22 exercised.
 *
 * @param resolveConflict is called for a `conflicting` root. When it is not
 * given, the conflict is reported back through RootReadiness.conflict instead,
 * so that the caller can resolve it once the db handle it needs exists.
 * @param quiet suppresses the log line about the server being unreachable. The
 * caller retries this in a loop, and one identical line per attempt buries
 * everything else - eleven of them in six minutes was the live test of
 * 2026-08-22.
 */
export async function prepareSyncedRoot({ fs, emitStorageEvent, resolveConflict, quiet }: {
  fs: web3n.files.WritableFS;
  emitStorageEvent: (event: ContactEvent) => void;
  resolveConflict?: () => Promise<void>;
  quiet?: boolean;
}): Promise<RootReadiness> {
  const sync = fs.v?.sync;
  if (!sync) {
    // Not a synced storage: there is no remote state to reconcile with, and
    // nothing to hold back.
    return { verified: true, holdUploads: false, conflict: false };
  }

  let status: web3n.files.SyncStatus;
  try {
    status = await sync.status('');
  } catch (err) {
    // status() talks to the server, and offline it throws `connect`. Told apart
    // from other failures on purpose: syncStatusOf() swallows everything, which
    // here would be read as "no sync api" and let uploads through.
    if ((err as web3n.ConnectException).type === 'connect') {
      if (!quiet) {
        await w3n.log('info', 'Root folder is not verified against the server: offline');
      }
    } else {
      await w3n.log('error', 'Could not read the sync status of the root folder', err);
    }
    return { verified: false, holdUploads: true, conflict: false };
  }

  switch (status.state) {
    case 'behind': {
      await syncAdopt({
        fs,
        path: '',
        opts: { remoteVersion: status.remote!.latest },
        emitStorageEvent,
      });
      return { verified: true, holdUploads: false, conflict: false };
    }

    case 'conflicting': {
      if (!resolveConflict) {
        return { verified: false, holdUploads: true, conflict: true };
      }
      await resolveConflict();
      return { verified: true, holdUploads: false, conflict: false };
    }

    // `unsynced` means the local root is ahead of the synced one, so its
    // children already are the ones we know about. Its upload is the job of
    // handleRootFolderSyncStatus, which runs in the initial sync process.
    case 'unsynced':
    case 'synced':
    default:
      return { verified: true, holdUploads: false, conflict: false };
  }
}
