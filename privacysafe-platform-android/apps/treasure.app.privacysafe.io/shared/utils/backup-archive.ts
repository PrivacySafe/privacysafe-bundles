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
// Shape of a backup archive, kept free of any fflate / w3n import so that both
// the deno service and the gui can use it. The deno side packs the files, the
// gui side owns the container and the encryption - see doc/05-backup-and-restore.md.

/** Always stored unencrypted, so an archive can be identified without a key. */
export const METADATA_FILE_NAME = 'treasure_app_privacysafe_io.json';

/** The single entry an encrypted archive carries besides the metadata file. */
export const PAYLOAD_FILE_NAME = 'payload.zip.enc';

/**
 * Layout of the archive, not the version of the app. Bump it when the set of
 * entries changes in a way this build could not read back.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Written into the metadata, so an archive of another app can be told apart. */
export const APP_DOMAIN = 'treasure.app.privacysafe.io';

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
  appDomain: string;
  /** w3n.myVersion() of the app that wrote the archive. */
  version: string;
  formatVersion: number;
  createdAt: string;
  /**
   * Absent from an encrypted archive: how much is stored is not worth
   * disclosing to someone who cannot open the archive anyway.
   */
  recordsCount?: number;
  /** Absent from an encrypted archive, for the same reason. */
  groupsCount?: number;
  /** Absent from an unencrypted archive. */
  encryption?: BackupEncryptionParams;
}

export function makeBackupMetadata({ version, recordsCount, groupsCount, encryption }: {
  version: string;
  recordsCount?: number;
  groupsCount?: number;
  encryption?: BackupEncryptionParams;
}): BackupMetadataContent {
  return {
    appDomain: APP_DOMAIN,
    version,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    ...(recordsCount !== undefined && { recordsCount }),
    ...(groupsCount !== undefined && { groupsCount }),
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
 * Worth telling apart explicitly: a contacts archive carries no appDomain field
 * to check, and its entries look restorable on their own, so without this a
 * foreign archive would reach a destructive restore behind nothing more than a
 * compatibility warning.
 */
export function isForeignAppMetadataPath(path: string): boolean {
  return path !== METADATA_FILE_NAME && /^[a-z0-9-]+(_[a-z0-9-]+)*_app_privacysafe_io\.json$/.test(path);
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
  if (path === METADATA_FILE_NAME || path === PAYLOAD_FILE_NAME) {
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

function twoDigits(value: number): string {
  return `${value}`.padStart(2, '0');
}

/**
 * Default name offered in the save dialog, e.g.
 * `treasure-backup-0_2_3-2026-09-05_14-30.zip`.
 *
 * Dots in the version are replaced rather than kept: a name like
 * `treasure-backup-0.2.3-…` reads as an archive with a `.3-…` extension to file
 * dialogs and unpackers alike. A missing version simply leaves the segment out,
 * instead of writing `undefined` into the file name.
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
    ? `treasure-backup-${version}-${stamp}.zip`
    : `treasure-backup-${stamp}.zip`;
}
