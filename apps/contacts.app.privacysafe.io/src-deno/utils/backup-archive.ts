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
// Pure part of backup and restore, kept free of any fflate / sqlite / w3n
// import so that it can be unit-tested without the ~1MB precompiled sqlite
// runtime or a zip implementation. Everything that decides WHAT goes into an
// archive, and what a restored row must look like, lives here; the service
// module next to it only does the io.
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from '../constants.ts';
import { ensureUniqueContactIds } from './db-file-conflict.ts';
import { randomStr } from '../../src/common/services/base/random.ts';
import { canonicalMail } from '@main/common/utils/mail-address.ts';
import type { RawPerson } from '../../src/types/index.ts';

/** Always stored unencrypted, so an archive can be identified without a key. */
export const METADATA_FILE_NAME = 'contacts_app_privacysafe_io.json';

/** The single entry an encrypted archive carries besides the metadata file. */
export const PAYLOAD_FILE_NAME = 'payload.zip.enc';

/**
 * Layout of the archive, not the version of the app. Bump it when the set of
 * entries or the contacts table schema changes in a way this build could not
 * read back. See checkBackupFormatCompatibility.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Written into the metadata, so an archive of another app can be told apart. */
export const APP_DOMAIN = 'contacts.app.privacysafe.io';

export interface BackupEncryptionParams {
  alg: 'AES-GCM';
  keyLen: number;
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
}

export interface BackupMetadataContent {
  /**
   * Which app wrote this archive. Absent from archives written before the field
   * was added, so a missing one is not on its own a reason to refuse.
   */
  appDomain?: string;
  /** w3n.myVersion() of the app that wrote the archive. */
  version: string;
  formatVersion: number;
  createdAt: string;
  /**
   * Absent from an encrypted archive: the size of an address book is not worth
   * disclosing to someone who cannot open the archive anyway.
   */
  contactsCount?: number;
  /** Avatars whose bytes were still only on the server when the backup ran. */
  skippedImages?: string[];
  /** Absent from an unencrypted archive. */
  encryption?: BackupEncryptionParams;
}

/**
 * Builds the metadata of an archive.
 *
 * Used by both sides: the service writes it into an unencrypted archive, while
 * the gui writes it into the container around an encrypted one, where it has to
 * stay readable without a passphrase.
 */
export function makeBackupMetadata({ version, skippedImages, contactsCount, encryption }: {
  version: string;
  skippedImages?: string[];
  contactsCount?: number;
  encryption?: BackupEncryptionParams;
}): BackupMetadataContent {
  return {
    appDomain: APP_DOMAIN,
    version,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    ...(skippedImages && (skippedImages.length > 0) && { skippedImages }),
    ...((contactsCount !== undefined) && { contactsCount }),
    ...(encryption && { encryption }),
  };
}

export function makeBackupMetadataBytes(
  params: Parameters<typeof makeBackupMetadata>[0],
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(makeBackupMetadata(params), null, 2));
}

/**
 * Every privacysafe app names its metadata file after its own domain, so an
 * entry matching this pattern but not METADATA_FILE_NAME belongs to a backup of
 * a different app.
 *
 * Worth telling apart explicitly: archives written before appDomain was added
 * carry no field to check, and another app's entries can look restorable on
 * their own - which would put a foreign archive in front of a destructive
 * restore behind nothing more than a compatibility warning.
 */
export function isForeignAppMetadataPath(path: string): boolean {
  return (path !== METADATA_FILE_NAME)
  && /^[a-z0-9-]+(_[a-z0-9-]+)*_app_privacysafe_io\.json$/.test(path);
}

/**
 * Whether an archive entry may be written to the app's storage.
 *
 * Folder entries and the junk a desktop zip tool adds are dropped as noise;
 * the traversal checks matter, because the archive is a file the user picked
 * and nothing stops it from carrying `../../` in an entry name.
 */
export function isSafeArchivePath(path: string): boolean {
  if (!path || path.endsWith('/')) {
    return false;
  }
  // Another app's metadata file is never ours to write, even if an archive
  // holding one somehow got this far.
  if (isForeignAppMetadataPath(path)) {
    return false;
  }
  if (path.startsWith('__MACOSX/') || path.includes('.DS_Store')) {
    return false;
  }
  if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
    return false;
  }
  return true;
}

export interface SplitArchiveEntries {
  dbBytes?: Uint8Array;
  images: { name: string; bytes: Uint8Array }[];
  /** Entries this build has no place for; reported, never written. */
  ignored: string[];
}

/**
 * Sorts the entries of an unpacked archive into the two things a restore knows
 * how to apply. `name` of an image is its name inside the images folder, which
 * is what filesStoreService works with.
 */
export function splitArchiveEntries(
  entries: [string, Uint8Array][],
): SplitArchiveEntries {
  const res: SplitArchiveEntries = { images: [], ignored: [] };
  const imagesPrefix = `${IMAGES_FOLDER}/`;

  for (const [path, bytes] of entries) {
    if (path === CONTACTS_DB_FILE) {
      res.dbBytes = bytes;
    } else if (path.startsWith(imagesPrefix)) {
      const name = path.slice(imagesPrefix.length);
      // A nested path under images/ is not something this app writes, and
      // filesStoreService could not address it - so it is noise, not an avatar.
      if (name && !name.includes('/')) {
        res.images.push({ name, bytes });
      } else {
        res.ignored.push(path);
      }
    } else if (path !== METADATA_FILE_NAME && path !== PAYLOAD_FILE_NAME) {
      res.ignored.push(path);
    }
  }

  return res;
}

export interface PreparedContactRows {
  rows: RawPerson[];
  /** Rows thrown away for having no usable mail address. */
  dropped: number;
  /** Rows folded into another row denoting the same account. */
  deduped: number;
  /** Whether the user's own record had to be put back. */
  ownContactAdded: boolean;
}

/** Key rows are matched on: the canonical address, or the raw one if unusable. */
function mailKey(mail: string): string {
  return canonicalMail(mail) ?? mail.toLowerCase();
}

/**
 * Brings rows read out of an archive to a shape updateContactsTable is certain
 * to swallow whole.
 *
 * This is not defensive polish: updateContactsTable DROPs the table before its
 * first insert, so a row that fails halfway - a null mail against a NOT NULL
 * column, a duplicated primary key - leaves the address book truncated with no
 * way back. Everything that could fail an insert is settled here, before the
 * table is touched.
 */
export function prepareRestoredContactRows(
  rows: RawPerson[],
  ownAddress: string,
  now: number,
): PreparedContactRows {
  let dropped = 0;
  const byMail = new Map<string, RawPerson>();

  for (const row of rows) {
    const mail = (typeof row?.mail === 'string') ? row.mail.trim() : '';
    if (!mail) {
      dropped += 1;
      continue;
    }

    const id = (typeof row.id === 'string' && row.id.trim())
      ? row.id.trim()
      : randomStr(8);
    const timestamp = Number(row.timestamp) || 0;
    const normalized: RawPerson = { ...row, id, mail, timestamp };

    const key = mailKey(mail);
    const seen = byMail.get(key);
    // One account, one contact: the same address under two ids is what the
    // app's own duplicate check exists to prevent, and a restore must not be
    // the way around it. The fresher record wins, as everywhere else here.
    if (!seen || (normalized.timestamp > seen.timestamp)) {
      byMail.set(key, normalized);
    }
  }

  const deduped = rows.length - dropped - byMail.size;
  const prepared = [...byMail.values()];

  // The user's own record is inserted by initializeDB as the first contact and
  // is relied on throughout the ui - it renders as "Me", it is excluded from
  // "select all" arithmetic, and it cannot be deleted. An archive taken before
  // that record existed, or one from another account, would leave the user
  // without it.
  const ownKey = mailKey(ownAddress);
  const ownContactAdded = !!ownAddress && !byMail.has(ownKey);
  if (ownContactAdded) {
    prepared.unshift({ id: ownAddress, mail: ownAddress, timestamp: now } as RawPerson);
  }

  // Last, so that a row carrying the own address as its id cannot displace the
  // record just put in front: ensureUniqueContactIds keeps the first occurrence.
  return { rows: ensureUniqueContactIds(prepared), dropped, deduped, ownContactAdded };
}

function twoDigits(value: number): string {
  return `${value}`.padStart(2, '0');
}

/**
 * Default name offered in the save dialog, e.g.
 * `contacts-backup-0_8_34-2026-09-05_14-30.zip`.
 *
 * Dots in the version are replaced rather than kept: a name like
 * `contacts-backup-0.8.34-…` reads as an archive with an `.34-…` extension to
 * file dialogs and unpackers alike. A missing version simply leaves the segment
 * out, instead of writing `undefined` into the file name.
 */
export function backupFileName(date: Date, appVersion?: string): string {
  const stamp = [
    date.getFullYear(),
    '-', twoDigits(date.getMonth() + 1),
    '-', twoDigits(date.getDate()),
    '_', twoDigits(date.getHours()),
    '-', twoDigits(date.getMinutes()),
  ].join('');

  // Trimmed before the `v` is stripped: the other way round a leading space
  // shields the prefix and it survives into the file name.
  const version = (appVersion ?? '').trim().replace(/^v/, '').replace(/\./g, '_');

  return version
    ? `contacts-backup-${version}-${stamp}.zip`
    : `contacts-backup-${stamp}.zip`;
}
