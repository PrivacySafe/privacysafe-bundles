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
import { MultiConnectionIPCWrap } from '../shared-libs/ipc/ipc-service.js';
import { ObserversSet } from '../shared-libs/observer-utils.ts';
import { SQLiteOn3NStorage } from '../shared-libs/sqlite-on-3nstorage/index.js';
import { setupGlobalReportingOfUnhandledErrors } from '../shared-libs/error-handling.ts';
import { sleep } from '../shared-libs/processes/sleep.ts';
import { SingleProc } from '../shared-libs/processes/single.ts';
import { filesStoreService } from './file-store-service/files-store-service.ts';
import { contactsBackupSrv } from './contacts-backup-srv.ts';
import { contactDb } from './dataset/contacts-db.ts';
import { checkServerConnection } from './utils/check-server-connection.ts';
import { checkAddressExistenceForASMail } from './utils/contact-checks.ts';
import { removeUnnecessaryImageFiles as _removeUnnecessaryImageFiles } from './utils/remove-unnecessary-image-files.ts';
import { handleRootFolderSyncStatus } from './utils/handle-root-folder-sync-status.ts';
import { handleImagesFolderSyncStatus } from './utils/handle-images-folder-sync-status.ts';
import { handleDbFileSyncStatus } from './utils/handle-db-file-sync-status.ts';
import { prepareSyncedRoot } from './utils/prepare-synced-root.ts';
import { resolveRootFolderConflict } from './utils/resolve-root-folder-conflict.ts';
import { waitForOnline, watchStorageReconnection } from './utils/storage-connection.ts';
import { startConvergenceWatchdog } from './utils/convergence-watchdog.ts';
import {
  isBlacklistAffecting,
  makeBlacklistBroadcaster,
  selectBlacklisted,
  type BlacklistBroadcaster,
} from './utils/contact-blacklist.ts';
import { randomStr } from '../src/common/services/base/random.ts';
import { isNewContactId } from '../src/common/constants/index.ts';
import { syncUpload } from './utils/sync-upload.ts';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from './constants.ts';
import type {
  AddressCheckResult,
  ContactEvent,
  Person,
  RawPerson,
  TutorialState,
} from '../src/types/index.ts';
import type { ContactsDenoSrv, ContactsDenoSrvInternal, ContactsDenoSrvExternal } from './types.ts';

/** How many times the db file is opened again while its bytes are missing. */
const DB_OPEN_ATTEMPTS = 3;

interface SyncPassOpts {
  /**
   * Leaves the sweep of unused image files out of the pass. Set by callers that
   * run on a timer: the sweep is destructive housekeeping, and repeating it
   * every minute catches the window in which an image is written but the
   * contact referring to it is not saved yet.
   */
  skipImageSweep?: boolean;
}

/** Cap on a single wait for the connection, so that a retry always happens. */
const CONNECTION_WAIT_MS = 60000;

/**
 * How many verifications may fail WHILE the device reports being online before
 * the user is told that synchronisation is stuck. At the platform's 30s
 * connectivity tick this is about a minute and a half of trying.
 */
const STUCK_AFTER_ONLINE_ATTEMPTS = 3;

/**
 * Opens the app's synced storage, waiting for the connection instead of giving
 * up when the platform cannot reach the server.
 *
 * The platform needs the network for this call whenever this app's folder is not
 * on the device yet: it resolves the storage service through a DNS TXT lookup of
 * the user's domain, and caches that nowhere on disk. The failure used to fall
 * through to the startup catch, which closes the service - so the app stayed
 * dead until the platform was restarted by hand, even after the network was
 * back. Retrying here at least removes the manual restart.
 *
 * It does NOT make the app usable offline in that state: with no data on disk
 * there is nothing to serve. That an already registered user cannot start an app
 * offline on a fresh device is a platform limitation, reported to its authors and
 * not something this app can work around.
 *
 * Note the IPC service is only exposed after this resolves, so while the retries
 * run the windows get "Timeout in connecting to service AppContactsInternal" and
 * have to be reopened once the service is up.
 */
async function openSyncedRoot(): Promise<web3n.files.WritableFS> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await w3n.storage!.getAppSyncedFS();
    } catch (err) {
      if ((err as web3n.ConnectException).type !== 'connect') {
        throw err;
      }

      await w3n.log(
        'info',
        `App synced storage is not reachable yet, awaiting a connection (attempt ${attempt})`,
        err,
      );
      await waitForOnline({ timeoutMs: CONNECTION_WAIT_MS });
    }
  }
}

/**
 * Opens the contacts db, awaiting the connection while the file exists but its
 * content is not on disk yet.
 *
 * On a second device the file IS in the folder listing while its bytes still
 * live only on the server, and readBytes() offline throws `connect` - which
 * sqlite-on-3nstorage does not catch, as it tolerates `notFound` only. The
 * failure used to reach the startup catch and close the service. Coming up with
 * an EMPTY db instead would be worse than not starting: the empty table would
 * be saved and published over the existing remote file.
 */
async function openContactsDb(fs: web3n.files.WritableFS): Promise<SQLiteOn3NStorage> {
  // Only meaningful once the root has been reconciled: checkFilePresence reads
  // the current version of the folder, never the remote branch.
  const isDbFileKnown = await fs.checkFilePresence(CONTACTS_DB_FILE);
  const file = await fs.writableFile(CONTACTS_DB_FILE);

  for (let attempt = 1; ; attempt++) {
    try {
      return await SQLiteOn3NStorage.makeAndStart(file);
    } catch (err) {
      const isConnectErr = (err as web3n.ConnectException).type === 'connect';
      if (!isConnectErr || !isDbFileKnown || attempt >= DB_OPEN_ATTEMPTS) {
        throw err;
      }

      await w3n.log(
        'info',
        `Content of ${CONTACTS_DB_FILE} is not on disk yet, awaiting a connection (attempt ${attempt})`,
      );
      // Not whenConnected(): that latch can stay unset for the life of the
      // process, turning this retry into an endless wait. See waitForOnline.
      await waitForOnline({ timeoutMs: CONNECTION_WAIT_MS });
    }
  }
}

async function contactsDenoSrv(): Promise<ContactsDenoSrv> {
  const updateEventsObservers = new ObserversSet<ContactEvent>();
  const updateContactBlacklist = new ObserversSet<Person[]>();

  /**
   * Only ready once contactDbSrv exists. emitStorageEvent is handed to
   * prepareSyncedRoot before that, so the hook below has to be able to answer
   * "not yet" rather than reach for a binding still in its dead zone.
   */
    // eslint-disable-next-line prefer-const
  let blacklist: BlacklistBroadcaster | undefined;

  setupGlobalReportingOfUnhandledErrors(true);

  /**
   * The one point every rewrite of the contacts table passes through -
   * including changes that arrived by synchronisation from another device of
   * the user, and a restore from a backup. That is why the blacklist is
   * recomputed HERE rather than at the call sites that block and unblock: it
   * used to be announced only from changeContactBlockingSettings and
   * deleteContact, so on the user's second device the watchers - and with them
   * the other apps that rely on them - kept serving a stale list.
   *
   * The recomputation is synchronous, and both halves of that are load-bearing;
   * see makeBlacklistBroadcaster.
   */
  function emitStorageEvent(event: ContactEvent) {
    updateEventsObservers.next(event);

    if (blacklist && isBlacklistAffecting(event)) {
      // This function must not throw: it is called from the sync utils, and an
      // exception here would tear down a phase that has already done its work.
      try {
        blacklist.broadcastIfChanged();
      } catch (err) {
        w3n.log('error', 'Could not recompute the contact block list', err);
      }
    }
  }

  function watchEvent(obs: web3n.Observer<ContactEvent>): () => void {
    updateEventsObservers.add(obs);
    return () => updateEventsObservers.delete(obs);
  }

  function watchContactBlacklistChanging(obs: web3n.Observer<Person[]>) {
    updateContactBlacklist.add(obs);
    // Taken and delivered synchronously. The snapshot used to arrive by promise
    // AFTER the observer had joined the set, so a broadcast landing in between
    // overtook it and left the subscriber holding a list OLDER than one it had
    // already been given.
    try {
      obs.next?.(blacklist!.current());
    } catch (err) {
      w3n.log('info', 'A block list subscriber failed on its first snapshot', err);
    }
    return () => updateContactBlacklist.delete(obs);
  }

  const fs = await openSyncedRoot();

  /**
   * The app's LOCAL fs, a sibling of the synced one. Tutorial state lives here
   * rather than in synced storage: it is device-local ui state, and it must
   * survive a full platform restart, which the gui's localStorage does not.
   */
  const localFs = await w3n.storage!.getAppLocalFS!();
  const tutorialWriteProc = new SingleProc();

  function tutorialPath(key: string): string {
    return `${key}.json`;
  }

  async function getTutorialState(key: string): Promise<TutorialState | undefined> {
    const path = tutorialPath(key);
    if (!(await localFs.checkFilePresence(path))) {
      return undefined;
    }
    return await localFs.readJSONFile<TutorialState>(path);
  }

  async function saveTutorialState(key: string, state: TutorialState): Promise<void> {
    const path = tutorialPath(key);
    await tutorialWriteProc.startOrChain(() => localFs.writeJSONFile(path, state));
  }

  /**
   * First phase of bringing the root in line with the server. It MUST precede
   * the writableFile/writableSubRoot calls below: those see only the current
   * version of the folder, so on a device whose root is still `behind` they
   * would create a second contacts-db beside the server's one - which is the
   * name overlap that made the root conflict in the first place.
   *
   * A `conflicting` root is reported back rather than resolved here, because
   * resolving it needs the db handle that only exists further down.
   */
  let rootState = await prepareSyncedRoot({ fs, emitStorageEvent });

  /**
   * Nothing is published while the root is not reconciled with the server.
   * Local writes go on as usual - the first run on a new device stays usable
   * offline, it just keeps its state to itself until the root is verified.
   */
  function areUploadsHeld(): boolean {
    return rootState.holdUploads;
  }

  /**
   * Set while a backup is being restored.
   *
   * A restore replaces the whole contacts table and rewrites the avatar files,
   * and three background activities would undo or corrupt that if they ran in
   * the middle of it: the debounced db upload (publishing a half-written
   * table), the sweep of unused avatars (deleting freshly restored pictures the
   * old table does not reference yet), and the remote-change handling (its own
   * DROP-and-refill of the same table). The first two are skipped outright
   * while this is set; the third is serialized through dbStateProc below.
   */
  let restoreInProgress = false;

  function setRestoreInProgress(value: boolean): void {
    restoreInProgress = value;
  }

  /**
   * Serializes everything that rewrites the contacts table wholesale: the
   * remote-change handling, the startup sync pass, and a restore.
   *
   * These used to be unsynchronized against each other - the watchTree handler
   * took no lock at all - so two interleaved DROP-and-refill cycles could leave
   * the address book in pieces. It cannot be sqlite.sync(): the conflict branch
   * of handleDbFileSyncStatus goes on to call saveToFile, which takes the same
   * proc and deadlocks. Note that startOrChain queues rather than re-enters, so
   * nothing taken under this proc may await another action that also takes it.
   */
  const dbStateProc = new SingleProc();

  const sqlite = await openContactsDb(fs);
  const imagesFolder = await fs.writableSubRoot(IMAGES_FOLDER);

  const filesSrv = await filesStoreService(imagesFolder);

  /**
   * Debounced upload of the db file after local saves (trailing 500ms):
   * a burst of writes yields several local versions and ONE upload of the
   * latest; a lone write is uploaded ~0.5s later. Keeping the file synced
   * right after writes closes the window in which sync choreography
   * (adoptRemote on echoes of our own uploads) resets the file node's
   * version below still-registered local versions — after which every save
   * fails with "Version N already exists". Only the UPLOAD is debounced:
   * the local per-operation save stays awaited, so save-failure rollbacks
   * and RPC reply semantics are untouched. Connect (offline) errors are
   * tolerated by syncUpload; offline also produces no adoption echoes.
   */
  const DB_UPLOAD_DEBOUNCE_MS = 500;
  let dbUploadTimer: ReturnType<typeof setTimeout> | null = null;
  let dbUploadRunning = false;
  let dbUploadQueued = false;

  async function runDbUpload(): Promise<void> {
    // Skipped rather than queued: once the root is verified, the initial sync
    // pass finds the file `unsynced` and uploads whatever the newest local
    // version is by then. The same holds for a restore, which ends by running
    // that pass itself.
    if (areUploadsHeld() || restoreInProgress) {
      return;
    }

    if (dbUploadRunning) {
      dbUploadQueued = true;
      return;
    }
    dbUploadRunning = true;
    try {
      await syncUpload({ fs, path: CONTACTS_DB_FILE, emitStorageEvent, immediately: true });
    } catch (err) {
      w3n.log('warning', `Upload of ${CONTACTS_DB_FILE} after local save failed`, err);
    } finally {
      dbUploadRunning = false;
      if (dbUploadQueued) {
        dbUploadQueued = false;
        void runDbUpload();
      }
    }
  }

  function scheduleDbUpload(): Promise<void> {
    // A restore writes the table through the same save path, and its last
    // insert would arm this timer for a file the restore is about to publish
    // itself, in one deliberate pass.
    if (restoreInProgress) {
      return Promise.resolve();
    }

    if (dbUploadTimer !== null) {
      clearTimeout(dbUploadTimer);
    }
    dbUploadTimer = setTimeout(() => {
      dbUploadTimer = null;
      void runDbUpload();
    }, DB_UPLOAD_DEBOUNCE_MS);
    return Promise.resolve();
  }

  const contactDbSrv = await contactDb(sqlite, scheduleDbUpload);

  // Switched on here, and not where it is declared: emitStorageEvent goes into
  // prepareSyncedRoot above, before the db is open. The starting state is taken
  // as the baseline without a broadcast, so that the first update:contact-list
  // does not announce a list nobody changed. Nothing is missed by starting
  // here - neither prepareSyncedRoot nor handleRootFolderSyncStatus emits any
  // of the events the hook reacts to, and resolveRootFolderConflict runs below.
  blacklist = makeBlacklistBroadcaster({
    listContacts: contactDbSrv.listAllContactsFrom,
    broadcast: updateContactBlacklist.next,
    onError: err => {
      w3n.log('error', 'Could not read the contact block list', err);
    },
  });
  blacklist.prime();

  // Second phase of bringing the root in line with the server: the merge needs
  // contactDbSrv, and it has to happen BEFORE the first saveToFile below and
  // before watchTree starts reacting to remote changes - so that no local state
  // is published over a remote branch that has not been absorbed yet.
  if (rootState.conflict) {
    try {
      await resolveRootFolderConflict({ fs, sqlite, contactDbSrv, emitStorageEvent });
      rootState = { verified: true, holdUploads: false, conflict: false };
    } catch (err) {
      // Uploads stay held: publishing now would overwrite the remote branch.
      await w3n.log('error', 'Could not resolve the root folder conflict on startup', err);
    }
  }

  await sqlite.saveToFile({ skipUpload: true });

  fs.watchTree('', 3, {
    next: async val => {
      const { type, path } = val;
      const processedPath = path.replace('./', '');

      // eslint-disable-next-line default-case
      switch (type) {
        case 'download-done': {
          emitStorageEvent({
            event: 'sync:end',
            payload: { path: processedPath },
          });
          break;
        }

        case 'upload-done': {
          emitStorageEvent({
            event: 'sync:end',
            payload: { path: processedPath },
          });
          break;
        }

        case 'remote-change': {
          // Taken under dbStateProc, so that this cannot interleave with the
          // startup sync pass or with a restore - all three rewrite the same
          // table. NOT wrapped in sqlite.sync(): the handler's conflict branch
          // calls contactDbSrv.updateContactsTable → saveToFile →
          // syncProc.startOrChain, which deadlocks when already inside a
          // sync() action (service then never starts). Serializing this
          // with local writes needs re-entrancy support in
          // sqlite-on-3nstorage first.
          await dbStateProc.startOrChain(async () => {
            if (processedPath === CONTACTS_DB_FILE) {
              await handleDbFileSyncStatus({ fs, sqlite, contactDbSrv, emitStorageEvent });
            } else if (processedPath.includes(IMAGES_FOLDER)) {
              await handleImagesFolderSyncStatus({ fs, emitStorageEvent });
            } else {
              await handleRootFolderSyncStatus({ fs, sqlite, contactDbSrv, emitStorageEvent });
              // The db file goes right after the root, in the same order the
              // startup pass uses. Reconciling the root can adopt a remote
              // version whose contacts-db is a newer object than the one on
              // disk, and nothing here used to look at the file afterwards -
              // so the contacts themselves only caught up on the next
              // remote-change addressed to the file, or on the next startup
              // pass. handleDbFileSyncStatus returns at once when the file
              // needs nothing.
              await handleDbFileSyncStatus({ fs, sqlite, contactDbSrv, emitStorageEvent });
            }
          });
          break;
        }
      }
    },
    error: err => w3n.log('error', 'Error watching the synced FS tree', err),
  });

  /* images code block */
  async function addImage({
    base64,
    id,
    withUploadParentFolder,
  }: {
    base64: string;
    id?: string;
    withUploadParentFolder?: boolean;
  }): Promise<string> {
    const imageFileId = id || randomStr(20);
    // Protected from the sweep from this moment on. The gui writes the image
    // files first and sets avatarId on the contact only when the user saves it,
    // so between the two there is a window - as long as the user cares to take
    // - in which the file is on disk and no contact row refers to it. A sweep
    // landing in that window deletes the avatar the user is in the middle of
    // attaching. Seen for real on 2026-09-14.
    imagesAddedThisSession.add(imageFileId);
    await filesSrv.saveFile({ base64, id: imageFileId });
    // The file is saved locally either way; only its publication waits for the
    // root to be verified. The initial sync pass uploads it afterwards.
    if (areUploadsHeld()) {
      return imageFileId;
    }

    await syncUpload({ fs, path: `${IMAGES_FOLDER}/${imageFileId}`, emitStorageEvent });

    if (withUploadParentFolder) {
      await syncUpload({ fs, path: IMAGES_FOLDER, emitStorageEvent, immediately: true });
    }

    return imageFileId;
  }

  async function getImage(id: string): Promise<string> {
    const imageFile = await filesSrv.getFile(id);
    if (imageFile) {
      return (imageFile as web3n.files.ReadonlyFile).readTxt();
    }

    if (!imageFile && typeof imageFile === 'string') {
      return '[error]';
    }

    return '';
  }

  async function deleteImage(id: string, withoutUpload?: boolean): Promise<void> {
    await filesSrv.deleteFile(id);
    await filesSrv.deleteFile(`${id}-mini`);
    if (!withoutUpload && !areUploadsHeld()) {
      await syncUpload({ fs, path: IMAGES_FOLDER, emitStorageEvent, immediately: true });
    }
  }

  /* contacts code block */
  async function addContact(
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>,
  ): Promise<
    | Person
    | {
        errorType: string;
        errorMessage: string;
      }
  > {
    const isThereSuchContact = !!(await getContactByMail(contact.mail));
    if (isThereSuchContact) {
      return {
        errorType: 'exists',
        errorMessage: `There is already the contact with mail ${contact.mail}`,
      };
    }

    const addedContact = await contactDbSrv.insertContactInto({ contact });
    emitStorageEvent({
      event: 'add:contact',
      payload: {
        data: addedContact,
      },
    });
    return addedContact;
  }

  async function updateContact(
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>,
  ): Promise<Person> {
    const updatedContact = await contactDbSrv.updateContactInto(contact);
    emitStorageEvent({
      event: 'update:contact',
      payload: {
        data: updatedContact,
      },
    });
    // The debounced upload scheduled by saveDbToFile covers this; see addContact.
    return updatedContact;
  }

  async function upsertContact(
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>,
  ): Promise<
    | Person
    | {
        errorType: string;
        errorMessage: string;
      }
  > {
    if (isNewContactId(contact.id)) {
      return await addContact(contact);
    }

    return await updateContact(contact);
  }

  /**
   * @param id
   * @param withoutParentUpload is kept for callers that delete in a batch, so
   * that only the last deletion asks the db to be saved to file - and with it,
   * uploaded. The upload itself is the debounced one; see addContact.
   */
  async function deleteContact(id: string, withoutParentUpload?: boolean): Promise<void> {
    await contactDbSrv.deleteContactFrom(id, withoutParentUpload);
    emitStorageEvent({
      event: 'remove:contact',
      payload: { id },
    });
    // The blacklist watchers are served by the hook in emitStorageEvent above.
  }

  async function getContactList(withImage?: boolean): Promise<Person[]> {
    const list = contactDbSrv.listAllContactsFrom();
    if (!withImage) {
      return list;
    }

    for (const contact of list) {
      const { avatarId } = contact;
      if (avatarId) {
        contact.avatarImage = await getImage(`${avatarId}-mini`);
      }
    }
    return list;
  }

  async function getContactBlacklist(withImage?: boolean): Promise<Person[]> {
    return selectBlacklisted(await getContactList(withImage));
  }

  async function getContact(id: string): Promise<Person | undefined> {
    const contact = contactDbSrv.getContactFrom(id);
    if (!contact) {
      return undefined;
    }

    const { avatarId } = contact;
    if (!avatarId) {
      return contact;
    }

    contact.avatarImage = await getImage(avatarId);
    return contact;
  }

  async function getContactByMail(mail: string): Promise<Person | undefined> {
    if (!mail) {
      return undefined;
    }

    const contact = contactDbSrv.getContactByMail(mail);
    if (!contact) {
      return undefined;
    }

    const { avatarId } = contact;
    if (!avatarId) {
      return contact;
    }

    contact.avatarImage = await getImage(avatarId);
    return contact;
  }

  async function changeContactBlockingSettings({
    id,
    mail,
    value,
  }: {
    id?: string;
    mail?: string;
    value: boolean;
  }) {
    if (!id && !mail) {
      await w3n.log(
        'error',
        '[changeContactBlockingSettings] You must specify either the contact ID or the mail address.',
      );
      throw new Error('You must specify either the contact ID or the mail address.');
    }

    const contact = id ? await getContact(id) : await getContactByMail(mail!);
    if (!contact) {
      throw new Error(
        `[changeContactBlockingSettings] The contact with ${id ? 'ID' : 'MAIL'} "${id || mail}" not found.`,
      );
    }

    if (!contact.settings) {
      contact.settings = {};
    }

    contact.settings.blockUser = value;
    // update:contact from here reaches the blacklist watchers through the hook
    // in emitStorageEvent - which also means that setting the flag to the value
    // it already has announces nothing.
    await updateContact(contact);
    return contact;
  }

  /**
   * Asks ASMail whether an address can receive at all. Lives here because only
   * the deno component is granted `mail: { preflightsTo }` - the GUI windows are
   * not, so they cannot ask directly.
   *
   * Answers undefined instead of failing when the check itself cannot be made,
   * e.g. offline: the caller treats "could not verify" as "carry on", and being
   * unable to check must not turn into a refusal to act.
   */
  async function checkAddressReachability(addr: string): Promise<AddressCheckResult | undefined> {
    try {
      return await checkAddressExistenceForASMail(addr);
    } catch (err) {
      w3n.log('info', `Could not check whether ${addr} can receive`, err);
      return undefined;
    }
  }

  /* utils code block */

  /**
   * Image files written in this session, protected from the sweep of orphans
   * until the app restarts. See addImage for why.
   */
  const imagesAddedThisSession = new Set<string>();

  async function removeUnnecessaryImageFiles() {
    // Every image file no contact row refers to is deleted - and on a device
    // whose db has not been reconciled with the server yet, that is every
    // avatar just downloaded. See prepareSyncedRoot.
    if (!rootState.verified) {
      await w3n.log('info', 'Sweep of unused image files is skipped: the root folder is not verified yet');
      return;
    }

    // Between writing the restored avatars and swapping the table, the table
    // still in place references none of them - so a sweep landing in that
    // window deletes every picture the restore just wrote, silently. The
    // restore lifts this flag before running the sync pass that sweeps.
    if (restoreInProgress) {
      await w3n.log('info', 'Sweep of unused image files is skipped: a restore is running');
      return;
    }

    return _removeUnnecessaryImageFiles({
      fs,
      // Images written in this session count as in use even before a contact
      // refers to them: see addImage. The set is never pruned, so a picture the
      // user attached and then dropped lingers until the next start - and an
      // orphan is never urgent, while a deleted avatar is.
      getIdsOfAllFilesInUse: () => contactDbSrv.getIdsOfAllFilesInUse()
        .concat([...imagesAddedThisSession]),
      emitStorageEvent,
    });
  }

  // Serialized, so that the pass started on a regained connection cannot
  // interleave with one the GUI asks for over IPC - nor with the remote-change
  // handling or a restore, which is why it shares dbStateProc with them.
  async function initialSyncProcess(opts?: SyncPassOpts): Promise<void> {
    return dbStateProc.startOrChain(() => runInitialSyncProcess(opts));
  }

  async function runInitialSyncProcess(
    { skipImageSweep }: SyncPassOpts = {},
  ): Promise<void> {
    if (areUploadsHeld()) {
      await w3n.log('info', 'Initial synchronization is postponed: the root folder is not verified yet');
      return;
    }

    const isThereConnection = await checkServerConnection(fs);
    if (!isThereConnection) {
      return;
    }

    try {
      // The ROOT goes first: what to do about the db file and about the images
      // folder is only decidable once the root's children are the server's
      // ones. It used to be decided about the db file first, before the state
      // of the root had been looked at at all.
      await handleRootFolderSyncStatus({ fs, sqlite, contactDbSrv, emitStorageEvent });
      // See the watchTree handler for why this must NOT go through sqlite.sync().
      await handleDbFileSyncStatus({ fs, sqlite, contactDbSrv, emitStorageEvent });
      await handleImagesFolderSyncStatus({ fs, emitStorageEvent });

      // The sweep is a housekeeping chore, not part of converging, and it is
      // the destructive step of this pass. It belongs to the cadence it was
      // written for - app start - and NOT to the convergence watchdog, which
      // runs this pass once a minute for as long as anything is unpublished.
      // Adding an image is itself what leaves the images folder unsynced, so
      // the watchdog woke up and swept away the avatar the user was attaching.
      if (!skipImageSweep) {
        await removeUnnecessaryImageFiles();
      }
    } catch (err) {
      w3n.log('error', '🔥 Error while initial synchronization process. ', err);
      emitStorageEvent({
        event: 'sync:clean',
        payload: { reason: 'Error while initial synchronization process.' },
      });
    }
  }

  /**
   * Retries the root verification until it succeeds, and lifts the upload hold
   * when it does.
   *
   * This replaces a setTimeout that rescheduled initialSyncProcess from inside
   * itself: its `return` sat in the timer callback, so the body ran offline
   * anyway, and every offline pass added another recursive timer that nothing
   * ever cancelled.
   *
   * The retry is what re-establishes the session, not just what notices it:
   * prepareSyncedRoot's status('') is an HTTP request to the storage server, and
   * the platform re-logs in and marks itself connected on any such request. The
   * previous version of this loop awaited fs.v.sync.whenConnected() instead, and
   * in the live test of 2026-08-22 that never resolved after the network came
   * back - so the hold was never lifted at all. See waitForOnline.
   */
  async function verifyRootWhenConnected(): Promise<void> {
    let failuresWhileOnline = 0;
    let isReportedStuck = false;

    while (!rootState.verified) {
      const isOnlineReported = await waitForOnline({ timeoutMs: CONNECTION_WAIT_MS });

      try {
        // Quiet: the startup call has already logged that the server cannot be
        // reached, and one identical line per attempt buries everything else.
        rootState = await prepareSyncedRoot({
          fs,
          emitStorageEvent,
          quiet: true,
          resolveConflict: () =>
            resolveRootFolderConflict({
              fs,
              sqlite,
              contactDbSrv,
              emitStorageEvent,
            }),
        });
      } catch (err) {
        // Logged and retried, never abandoned: giving up here would keep the
        // upload hold on for the rest of the session.
        await w3n.log('error', 'Could not verify the root folder against the server', err);
      }

      if (rootState.verified) {
        break;
      }

      // Being offline is not news. Failing WHILE the platform says it is online
      // is: the user sees "online" and has no way to tell that nothing is being
      // published. Seen for real in the live tests of 2026-08-22, where the
      // storage session stayed broken for the life of the process.
      if (!isOnlineReported) {
        continue;
      }

      failuresWhileOnline += 1;
      if (!isReportedStuck && failuresWhileOnline >= STUCK_AFTER_ONLINE_ATTEMPTS) {
        isReportedStuck = true;
        await w3n.log(
          'warning',
          `Root folder could not be verified in ${failuresWhileOnline} attempts made while online`,
        );
        emitStorageEvent({
          event: 'sync:stuck',
          payload: { isStuck: true, reason: 'root-folder-not-verified' },
        });
      }
    }

    if (isReportedStuck) {
      emitStorageEvent({ event: 'sync:stuck', payload: { isStuck: false } });
    }

    await initialSyncProcess();
  }

  const backupSrv = await contactsBackupSrv({
    fs,
    sqlite,
    contactDbSrv,
    filesSrv,
    imagesFolder,
    emitStorageEvent,
    areUploadsHeld,
    initialSyncProcess,
    setRestoreInProgress,
    dbStateProc,
  });

  await initialSyncProcess();

  if (!rootState.verified) {
    // Deliberately not awaited: the app has to come up and serve local reads
    // while it waits for the server.
    void verifyRootWhenConnected();
  }

  // TEMPORARY: covers a break of the storage event socket that the platform
  // does not repair, after which watchTree above hears nothing and the devices
  // stop converging. Remove together with watchStorageReconnection once the
  // platform reconnects on its own.
  watchStorageReconnection(() => {
    void initialSyncProcess();
  });

  // TEMPORARY: covers an upload that the platform abandons without telling
  // anyone - there is no failure event in UploadEvent, and startUpload's
  // rejection lands on a promise nobody holds. Without this the device that
  // loses a version race keeps its change forever and the two devices never
  // converge; seen in the live test of 2026-09-13. Remove together with the
  // watchdog itself once findings 1 and 2 of
  // plans/platform-findings-2026-09-13.md are fixed.
  startConvergenceWatchdog({
    fs,
    paths: [CONTACTS_DB_FILE, IMAGES_FOLDER],
    areUploadsHeld,
    runSyncPass: () => initialSyncProcess({ skipImageSweep: true }),
    emitStorageEvent,
    intervalMs: CONNECTION_WAIT_MS,
    stuckAfterAttempts: STUCK_AFTER_ONLINE_ATTEMPTS,
  });

  return {
    fs,
    emitStorageEvent,
    watchEvent,
    watchContactBlacklistChanging,

    addImage,
    getImage,
    deleteImage,

    addContact,
    updateContact,
    upsertContact,
    deleteContact,
    getContactList,
    getContactBlacklist,
    getContact,
    getContactByMail,
    changeContactBlockingSettings,

    checkAddressReachability,

    getTutorialState,
    saveTutorialState,

    ...backupSrv,

    removeUnnecessaryImageFiles,
    initialSyncProcess,
  };
}

contactsDenoSrv()
  .then(srv => {
    const srvWrapInternal = new MultiConnectionIPCWrap('AppContactsInternal');
    const srvWrap = new MultiConnectionIPCWrap('AppContacts');

    srvWrapInternal.exposeReqReplyMethods<ContactsDenoSrvInternal>(srv, [
      'addImage',
      'getImage',
      'deleteImage',

      'upsertContact',
      'deleteContact',
      'getContactList',
      'getContactBlacklist',
      'getContact',
      'changeContactBlockingSettings',

      'checkAddressReachability',

      'getTutorialState',
      'saveTutorialState',

      'createBackupArchive',
      'cancelBackupArchive',
      'validateBackupArchive',
      'restoreBackupArchive',

      'removeUnnecessaryImageFiles',
      'initialSyncProcess',
    ]);
    srvWrapInternal.exposeObservableMethods<
      Pick<ContactsDenoSrv, 'watchEvent' | 'watchContactBlacklistChanging'>
    >(srv, ['watchEvent', 'watchContactBlacklistChanging']);
    srvWrapInternal.startIPC();

    srvWrap.exposeReqReplyMethods<ContactsDenoSrvExternal>(srv, [
      'getContactByMail',
      'addContact',
      'upsertContact',
      'getContact',
      'getContactList',
      'getContactBlacklist',
      'changeContactBlockingSettings',
    ]);
    srvWrap.exposeObservableMethods<Pick<ContactsDenoSrv, 'watchContactBlacklistChanging'>>(srv, [
      'watchContactBlacklistChanging',
    ]);
    srvWrap.startIPC();
  })
  .catch(async err => {
    await w3n.log('error', '🔥 Error in a startup of contacts deno service component. ', err);
    await sleep(10);
    w3n.closeSelf();
  });
