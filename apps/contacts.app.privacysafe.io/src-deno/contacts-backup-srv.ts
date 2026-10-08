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
// Only the SYNCHRONOUS fflate api is used here - `Zip` with `ZipDeflate` /
// `ZipPassThrough`, and `unzipSync`. Its asynchronous counterparts spin up a
// worker through URL.createObjectURL(new Blob(...)), which is not something the
// platform's deno component can be relied on to provide. Streaming through
// `Zip` still reports progress per entry, which a single zipSync call could not.
import { Zip, ZipDeflate, ZipPassThrough, unzipSync, type Unzipped } from 'fflate/browser';
// @deno-types="../shared-libs/sqlite-on-3nstorage/index.d.ts"
import { SQLiteOn3NStorage } from '../shared-libs/sqlite-on-3nstorage/index.js';
import { sleep } from '../shared-libs/processes/sleep.ts';
import { SingleProc } from '../shared-libs/processes/single.ts';
import { ContactDB, objectFromQueryExecResult } from './dataset/contacts-db.ts';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from './constants.ts';
import { normalizeContactRow } from './utils/db-file-conflict.ts';
import {
  BACKUP_FORMAT_VERSION,
  METADATA_FILE_NAME,
  isSafeArchivePath,
  makeBackupMetadataBytes,
  prepareRestoredContactRows,
  splitArchiveEntries,
  type BackupMetadataContent,
} from './utils/backup-archive.ts';
import {
  checkBackupFormatCompatibility, checkBackupVersionCompatibility,
} from './utils/check-backup-version.ts';
import type { FilesStoreService } from './file-store-service/files-store-service.ts';
import type {
  BackupArchiveError, BackupValidationResult, ContactEvent, RawPerson,
} from '../src/types/index.ts';

const COMPRESSION_LEVEL = 6;

/**
 * How often the loops yield. TREASURE sleeps 50ms per file, which on an address
 * book of a few hundred avatars is a quarter of a minute of doing nothing; the
 * progress events go out per entry either way, so a short yield now and then is
 * all that is needed to keep the service responsive.
 */
const YIELD_EVERY = 10;
const YIELD_MS = 5;

/**
 * Failure of the archive itself, carrying the reason the ui shows.
 *
 * The class does NOT survive the ipc boundary - only a string does - so the
 * reason is put into the message as well. Callers on this side match on
 * `reason`; the gui has already run validateBackupArchive by the time a restore
 * starts, so it only ever needs the text.
 */
export class BackupArchiveFailure extends Error {
  constructor(public readonly reason: BackupArchiveError) {
    super(`Backup archive cannot be used: ${reason}`);
    this.name = 'BackupArchiveFailure';
  }
}

function checkAbortSignal(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Backup cancelled', 'AbortError');
  }
}

function mergeUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const res = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    res.set(chunk, offset);
    offset += chunk.length;
  }
  return res;
}

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function appVersion(): Promise<string> {
  try {
    return (await w3n.myVersion()) || '0.0.1';
  } catch {
    return '0.0.1';
  }
}

interface ZipEntryInput {
  path: string;
  bytes: Uint8Array;
  /** Stored rather than deflated. Ciphertext does not compress. */
  store?: boolean;
}

/**
 * Packs entries whose content is already in memory.
 *
 * Fed from a single loop with an abort check per entry, so that a cancellation
 * lands between entries rather than only before and after the whole archive.
 */
async function zipEntries(
  entries: ZipEntryInput[],
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  return new Promise<Uint8Array>((resolve, reject) => {
    let isEnded = false;

    const onAbort = () => {
      if (isEnded) {
        return;
      }
      isEnded = true;
      try {
        zip.terminate();
      } catch {
        // The zip is being thrown away; a failure to tear it down changes
        // nothing for the caller, which is already getting an AbortError.
      }
      reject(new DOMException('Backup cancelled', 'AbortError'));
    };

    if (signal?.aborted) {
      reject(new DOMException('Backup cancelled', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const zip = new Zip((err, chunk, isLast) => {
      if (isEnded) {
        return;
      }

      if (err) {
        isEnded = true;
        signal?.removeEventListener('abort', onAbort);
        try {
          zip.terminate();
        } catch {
          // See above.
        }
        reject(err);
        return;
      }

      if (chunk) {
        chunks.push(chunk);
      }

      if (isLast) {
        isEnded = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(mergeUint8Arrays(chunks));
      }
    });

    (async () => {
      try {
        for (let i = 0; i < entries.length; i++) {
          checkAbortSignal(signal);

          const entry = entries[i];
          const zipEntry = entry.store
            ? new ZipPassThrough(entry.path)
            : new ZipDeflate(entry.path, { level: COMPRESSION_LEVEL });
          zip.add(zipEntry);
          zipEntry.push(entry.bytes, true);

          if ((i > 0) && (i % YIELD_EVERY === 0)) {
            await sleep(YIELD_MS);
          }
        }

        checkAbortSignal(signal);
        zip.end();
      } catch (err) {
        if (!isEnded) {
          isEnded = true;
          signal?.removeEventListener('abort', onAbort);
          try {
            zip.terminate();
          } catch {
            // See above.
          }
          reject(err);
        }
      }
    })();
  });
}

interface OpenedArchive {
  entries: Unzipped;
  metadata?: BackupMetadataContent;
  /** The metadata file is there, but is not json this build can read. */
  metadataInvalid: boolean;
}

/**
 * Unpacks an archive.
 *
 * This is always the INNER archive: when the backup file was protected, the gui
 * has already decrypted it and hands over the plaintext bytes, so nothing here
 * deals with passphrases. Its metadata then lives in the container the gui
 * opened, and reaches this side through the `metadata` argument instead.
 */
function openArchive(
  archiveBytes: Uint8Array,
  outerMetadata?: BackupMetadataContent,
  filter?: (file: { name: string }) => boolean,
): OpenedArchive {
  let entries: Unzipped;
  try {
    entries = filter ? unzipSync(archiveBytes, { filter }) : unzipSync(archiveBytes);
  } catch {
    throw new BackupArchiveFailure('corrupted_archive');
  }

  // An encrypted archive keeps no metadata inside, so what the gui read from
  // the container is used as is.
  if (outerMetadata) {
    return { entries, metadata: outerMetadata, metadataInvalid: false };
  }

  let metadata: BackupMetadataContent | undefined;
  let metadataInvalid = false;
  const metadataBytes = entries[METADATA_FILE_NAME];
  if (metadataBytes) {
    try {
      metadata = JSON.parse(fromUtf8(metadataBytes)) as BackupMetadataContent;
    } catch {
      metadataInvalid = true;
    }
  }

  return { entries, metadata, metadataInvalid };
}

/** Rows of the contacts table of a db that lives only as bytes. */
async function readContactsOf(dbBytes: Uint8Array): Promise<RawPerson[]> {
  let sqliteTemp: SQLiteOn3NStorage;
  try {
    sqliteTemp = await SQLiteOn3NStorage.makeReadonly(dbBytes);
    if (!sqliteTemp.listTables().includes('contacts')) {
      throw new Error(`No contacts table in ${CONTACTS_DB_FILE} of the archive`);
    }
  } catch (err) {
    if (err instanceof BackupArchiveFailure) {
      throw err;
    }
    throw new BackupArchiveFailure('unreadable_db');
  }

  const [sqlValue] = sqliteTemp.db.exec('SELECT * FROM contacts');
  // An empty table makes exec answer [], and objectFromQueryExecResult
  // destructures its argument straight away. Everywhere else in this app the
  // table is known to be non-empty; an archive is not.
  if (!sqlValue) {
    return [];
  }

  return objectFromQueryExecResult<RawPerson>(sqlValue).map(normalizeContactRow);
}

export async function contactsBackupSrv({
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
}: {
  fs: web3n.files.WritableFS;
  sqlite: SQLiteOn3NStorage;
  contactDbSrv: ContactDB;
  filesSrv: FilesStoreService;
  imagesFolder: web3n.files.WritableFS;
  emitStorageEvent: (event: ContactEvent) => void;
  areUploadsHeld: () => boolean;
  initialSyncProcess: () => Promise<void>;
  setRestoreInProgress: (value: boolean) => void;
  dbStateProc: SingleProc;
}): Promise<{
  createBackupArchive: (
    opts?: { forEncryption?: boolean },
  ) => Promise<{ bytes: Uint8Array; skippedImages: string[] }>;
  cancelBackupArchive: () => Promise<boolean>;
  validateBackupArchive: (
    archiveBytes: Uint8Array, outerMetadata?: BackupMetadataContent,
  ) => Promise<BackupValidationResult>;
  restoreBackupArchive: (archiveBytes: Uint8Array) => Promise<boolean>;
}> {
  let activeAbortController: AbortController | null = null;

  function emitBackupProgress(
    // No 'encrypting' here: that stage belongs to the gui, which owns the
    // container and the passphrase.
    stage: 'scanning' | 'compressing' | 'completed' | 'error' | 'cancelled',
    { totalFiles = 0, processedFiles = 0, currentFile, percent = 0 }: {
      totalFiles?: number; processedFiles?: number; currentFile?: string; percent?: number;
    } = {},
  ): void {
    emitStorageEvent({
      event: 'backup',
      payload: { stage, totalFiles, processedFiles, currentFile, percent },
    });
  }

  function emitRestoreProgress(
    stage: 'unpacking' | 'decrypting' | 'restoring-images' | 'restoring-contacts'
    | 'syncing' | 'completed' | 'error',
    { totalFiles = 0, processedFiles = 0, currentFile, percent = 0, syncDeferred }: {
      totalFiles?: number; processedFiles?: number; currentFile?: string;
      percent?: number; syncDeferred?: boolean;
    } = {},
  ): void {
    emitStorageEvent({
      event: 'restore',
      payload: { stage, totalFiles, processedFiles, currentFile, percent, syncDeferred },
    });
  }

  function countContacts(): number {
    const [sqlValue] = sqlite.db.exec('SELECT COUNT(*) FROM contacts');
    const count = sqlValue?.values?.[0]?.[0];
    return (typeof count === 'number') ? count : 0;
  }

  async function cancelBackupArchive(): Promise<boolean> {
    if (activeAbortController && !activeAbortController.signal.aborted) {
      activeAbortController.abort();
      activeAbortController = null;
      return true;
    }
    return false;
  }

  async function createBackupArchive(
    { forEncryption }: { forEncryption?: boolean } = {},
  ): Promise<{ bytes: Uint8Array; skippedImages: string[] }> {
    const abortController = new AbortController();
    activeAbortController = abortController;
    const { signal } = abortController;

    try {
      emitBackupProgress('scanning');
      checkAbortSignal(signal);

      // Exported from memory rather than read off the file: the service holds
      // the db open, so the file lags behind by whatever has not been saved
      // yet - and on a device whose bytes are still only on the server, reading
      // it fails outright.
      const dbBytes = sqlite.db.export();
      const contactsCount = countContacts();
      const imageNames = (await fs.listFolder(IMAGES_FOLDER))
      .filter(entry => entry.isFile)
      .map(entry => entry.name);

      checkAbortSignal(signal);

      // +1 for the metadata file, which is written last: it carries the list of
      // avatars that had to be skipped, and that is only known once they have
      // all been tried. Entry order does not matter to a reader - unzipSync
      // indexes the archive by name.
      const totalFiles = imageNames.length + 2;
      const skippedImages: string[] = [];
      const contentEntries: ZipEntryInput[] = [{ path: CONTACTS_DB_FILE, bytes: dbBytes }];

      emitBackupProgress('compressing', {
        totalFiles,
        processedFiles: 1,
        currentFile: CONTACTS_DB_FILE,
        percent: Math.round((1 / totalFiles) * 100),
      });

      for (let i = 0; i < imageNames.length; i++) {
        checkAbortSignal(signal);

        const name = imageNames[i];
        emitBackupProgress('compressing', {
          totalFiles,
          processedFiles: i + 2,
          currentFile: `${IMAGES_FOLDER}/${name}`,
          percent: Math.round(((i + 2) / totalFiles) * 100),
        });

        try {
          contentEntries.push({
            path: `${IMAGES_FOLDER}/${name}`,
            bytes: utf8(await imagesFolder.readTxtFile(name)),
          });
        } catch (err) {
          // An avatar listed in the folder while its bytes are still only on
          // the server reads as not found. One unreadable avatar must not fail
          // the whole backup - it goes into the metadata instead, so that a
          // contact without a picture afterwards is explainable.
          skippedImages.push(name);
          await w3n.log('warning', `Avatar ${name} is left out of the backup`, err);
        }

        if ((i > 0) && (i % YIELD_EVERY === 0)) {
          await sleep(YIELD_MS);
        }
      }

      checkAbortSignal(signal);

      // With `forEncryption` the metadata is left out: the gui encrypts this
      // archive whole and writes the metadata into the container around it,
      // where it stays readable without a passphrase. `skippedImages` goes back
      // with the bytes, since only this side knows what had to be left out.
      const archive = await zipEntries(
        forEncryption ? contentEntries : [
          ...contentEntries,
          {
            path: METADATA_FILE_NAME,
            bytes: makeBackupMetadataBytes({
              version: await appVersion(), skippedImages, contactsCount,
            }),
          },
        ],
        signal,
      );

      emitBackupProgress('completed', {
        totalFiles, processedFiles: totalFiles, percent: 100,
      });

      return { bytes: archive, skippedImages };
    } catch (err) {
      if (signal.aborted || (err as Error)?.name === 'AbortError') {
        emitBackupProgress('cancelled');
      } else {
        emitBackupProgress('error');
      }
      throw err;
    } finally {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }
  }

  async function validateBackupArchive(
    archiveBytes: Uint8Array, outerMetadata?: BackupMetadataContent,
  ): Promise<BackupValidationResult> {
    const version = await appVersion();

    let imagesCount = 0;
    let opened: OpenedArchive;
    try {
      opened = openArchive(archiveBytes, outerMetadata, file => {
        // Counted in the filter rather than by unpacking the whole archive:
        // returning false here leaves the entry compressed, so the avatars are
        // tallied without paying to decompress any of them.
        if (file.name.startsWith(`${IMAGES_FOLDER}/`)) {
          imagesCount += 1;
          return false;
        }
        return (file.name === METADATA_FILE_NAME) || (file.name === CONTACTS_DB_FILE);
      });
    } catch (err) {
      if (err instanceof BackupArchiveFailure) {
        return {
          valid: false, compatible: false, appVersion: version, error: err.reason,
        };
      }
      throw err;
    }

    const { entries, metadata, metadataInvalid } = opened;

    const dbBytes = entries[CONTACTS_DB_FILE];
    if (!dbBytes) {
      // The likeliest way here is an archive of a DIFFERENT privacysafe app -
      // worth catching before the user confirms a destructive restore.
      return {
        valid: false, compatible: false, appVersion: version,
        error: 'no_contacts_db',
      };
    }

    let contactsCount: number;
    try {
      contactsCount = (await readContactsOf(dbBytes)).length;
    } catch (err) {
      if (err instanceof BackupArchiveFailure) {
        return {
          valid: false, compatible: false, appVersion: version, error: err.reason,
        };
      }
      throw err;
    }

    const compatible = checkBackupFormatCompatibility(
      BACKUP_FORMAT_VERSION, metadata?.formatVersion,
    );
    const versionCheck = checkBackupVersionCompatibility(version, metadata?.version);
    const warningReason = metadataInvalid
      ? 'invalid_metadata' as const
      : (!metadata ? 'missing_metadata' as const : versionCheck.reason);

    return {
      valid: true,
      compatible,
      appVersion: version,
      archiveVersion: metadata?.version,
      formatVersion: metadata?.formatVersion,
      contactsCount,
      imagesCount,
      ...(!compatible && warningReason && { warningReason }),
    };
  }

  /** Takes the archive already decrypted by the gui, when it was protected. */
  async function restoreBackupArchive(archiveBytes: Uint8Array): Promise<boolean> {
    // Set before anything is read: it silences the debounced db upload, the
    // sweep of unused avatars, and the remote-change handling that would
    // otherwise rewrite the very table this is replacing.
    setRestoreInProgress(true);

    try {
      emitRestoreProgress('unpacking', { percent: 0 });

      const { entries } = openArchive(archiveBytes);
      const safeEntries = Object.entries(entries)
      .filter(([path]) => isSafeArchivePath(path)) as [string, Uint8Array][];
      const { dbBytes, images, ignored } = splitArchiveEntries(safeEntries);

      if (!dbBytes) {
        throw new BackupArchiveFailure('no_contacts_db');
      }
      if (ignored.length > 0) {
        await w3n.log(
          'info', `Entries of the backup archive left unused: ${ignored.join(', ')}`,
        );
      }

      const archivedRows = await readContactsOf(dbBytes);
      const ownAddress = await w3n.mailerid!.getUserId();
      const { rows, dropped, deduped, ownContactAdded } = prepareRestoredContactRows(
        archivedRows, ownAddress, Date.now(),
      );
      if (dropped || deduped || ownContactAdded) {
        await w3n.log(
          'info',
          `Restoring ${rows.length} contacts: ${dropped} row(s) had no usable address, `
          + `${deduped} duplicate(s) were folded, own contact ${ownContactAdded ? 'was' : 'was not'} re-added`,
        );
      }

      emitRestoreProgress('restoring-images', {
        totalFiles: images.length, processedFiles: 0, percent: 5,
      });

      // Serialized against the remote-change handling and the startup sync
      // pass: both of them rewrite the contacts table too, and two interleaved
      // DROP-and-refill cycles would leave the address book in pieces.
      await dbStateProc.startOrChain(async () => {
        // Avatars FIRST. Between swapping the table and writing the files the
        // gui would render every restored contact with a missing picture.
        for (let i = 0; i < images.length; i++) {
          const { name, bytes } = images[i];
          const txt = fromUtf8(bytes);

          const existing = await filesSrv.getFile(name);
          // '' means "listed, but the bytes are still on the server" - not a
          // file to compare against, and `''.readTxt` does not exist.
          const isUnchanged = !!existing
          && (typeof existing !== 'string')
          && (await existing.readTxt() === txt);

          if (!isUnchanged) {
            await filesSrv.saveFile({ base64: txt, id: name });
          }

          emitRestoreProgress('restoring-images', {
            totalFiles: images.length,
            processedFiles: i + 1,
            currentFile: `${IMAGES_FOLDER}/${name}`,
            percent: 5 + Math.round(((i + 1) / (images.length || 1)) * 30),
          });

          if ((i > 0) && (i % YIELD_EVERY === 0)) {
            await sleep(YIELD_MS);
          }
        }

        emitRestoreProgress('restoring-contacts', {
          totalFiles: rows.length, processedFiles: 0, percent: 35,
        });

        // withoutSaveToFile, so that the file is written once, from the last
        // insert. Saving per row would produce a local version per contact and
        // re-arm the debounced upload as many times - the ground on which
        // "Version N already exists" grew.
        await contactDbSrv.updateContactsTable(rows, true);
        if (rows.length === 0) {
          // updateContactsTable saves from its LAST insert, so an empty list
          // would leave the dropped table unsaved.
          await sqlite.saveToFile({ skipUpload: true });
        }
      });

      emitRestoreProgress('restoring-contacts', {
        totalFiles: rows.length, processedFiles: rows.length, percent: 60,
      });

      // Ids change wholesale in a restore, so an open contact card may now
      // point at nothing. The handler of this event both refetches the list and
      // leaves such a card.
      emitStorageEvent({ event: 'update:contact-list' });

      // Lifted BEFORE the sync pass: the sweep of unused avatars runs inside it
      // and would refuse to work while a restore is marked as running. By this
      // point the table matches the files, so the sweep deletes exactly what
      // the restored book does not reference.
      setRestoreInProgress(false);

      const syncDeferred = areUploadsHeld();
      emitRestoreProgress('syncing', { percent: 60, syncDeferred });
      if (!syncDeferred) {
        // Started outside dbStateProc: startOrChain queues rather than
        // re-enters, and the pass takes the same proc.
        await initialSyncProcess();
      } else {
        await w3n.log(
          'info',
          'Restored data is kept on this device: uploads are held until the root folder is verified',
        );
      }

      emitRestoreProgress('completed', {
        totalFiles: rows.length, processedFiles: rows.length, percent: 100, syncDeferred,
      });
      await sleep(500);

      return true;
    } catch (err) {
      emitRestoreProgress('error');
      throw err;
    } finally {
      setRestoreInProgress(false);
    }
  }

  return {
    createBackupArchive,
    cancelBackupArchive,
    validateBackupArchive,
    restoreBackupArchive,
  };
}
