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
// Pure part of backup and restore: no fflate, no sqlite, no `w3n`. Everything
// that decides WHAT goes into an archive and what an entry name may be lives
// here, so that it can be unit-tested on its own; the service module next to it
// only does the io.
//
// Imported from the GUI as well - the container around an encrypted archive is
// built there, and it has to name its metadata file exactly the same way.
import type {
  BackedUpAttachment,
  BackupEncryptionParams,
  BackupMetadataContent,
  SkippedAttachment,
} from '../types/backup.types.ts';

/** Always stored unencrypted, so an archive can be identified without a key. */
export const METADATA_FILE_NAME = 'inbox_app_privacysafe_io.json';

/** The single entry an encrypted archive carries besides the metadata file. */
export const PAYLOAD_FILE_NAME = 'payload.zip.enc';

export const MESSAGES_FILE_NAME = 'messages.json';
export const FOLDERS_FILE_NAME = 'folders.json';
export const TOMBSTONES_FILE_NAME = 'tombstones.json';

/** Prefix of the entries carrying attachment bytes. */
export const ATTACHMENTS_FOLDER = 'attachments';

/**
 * Layout of the archive, not the version of the app. Bump it when the set of
 * entries or the shape of a record changes in a way this build could not read
 * back. See checkBackupFormatCompatibility.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Written into the metadata, so an archive of another app can be told apart. */
export const APP_DOMAIN = 'inbox.app.privacysafe.io';

/**
 * The most an archive may weigh.
 *
 * The bytes cross the app's IPC, because the manifest gives the GUI
 * `shell.fileDialog` and no `storage`, while the deno component has it the other
 * way round. That is fine for an address book and not fine for a mailbox with
 * gigabytes of attachments, so the size is estimated BEFORE anything is packed
 * and an oversized backup is refused with a reason the user can act on - take it
 * without attachments. Streaming straight into a WritableFile is out of scope:
 * it rules out encrypting in the GUI, AES-GCM needing the whole buffer.
 */
export const BACKUP_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * How much of a restore snapshot goes into one phantom.
 *
 * The worst case - the user wiped the server and the archive is the only carrier
 * of every incoming message - is bounded from above by BACKUP_MAX_BYTES, so what
 * grows with it is the NUMBER of deliveries and not the size of one message.
 */
export const RESTORE_SNAPSHOT_CHUNK_BYTES = 192 * 1024;

/**
 * Builds the metadata of an archive.
 *
 * Used by both sides: the service writes it into an unencrypted archive, while
 * the GUI writes it into the container around an encrypted one, where it has to
 * stay readable without a passphrase.
 *
 * The counts are optional for exactly that reason - they are left out of an
 * encrypted archive's metadata.
 */
export function makeBackupMetadata({
  version,
  snapshotTs,
  skippedAttachments,
  messagesCount,
  foldersCount,
  attachmentsCount,
  encryption,
  now,
}: {
  version: string;
  snapshotTs?: number;
  skippedAttachments?: SkippedAttachment[];
  messagesCount?: number;
  foldersCount?: number;
  attachmentsCount?: number;
  encryption?: BackupEncryptionParams;
  /** Injected by the specs; Date.now() otherwise. */
  now?: Date;
}): BackupMetadataContent {
  return {
    appDomain: APP_DOMAIN,
    version,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: (now ?? new Date()).toISOString(),
    ...(snapshotTs !== undefined && { snapshotTs }),
    ...(messagesCount !== undefined && { messagesCount }),
    ...(foldersCount !== undefined && { foldersCount }),
    ...(attachmentsCount !== undefined && { attachmentsCount }),
    ...(skippedAttachments && skippedAttachments.length > 0 && { skippedAttachments }),
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
 * Worth telling apart explicitly: archives written before `appDomain` was added
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
 * Folder entries and the junk a desktop zip tool adds are dropped as noise; the
 * traversal checks matter, because the archive is a file the user picked and
 * nothing stops it from carrying `../../` in an entry name.
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
  messagesBytes?: Uint8Array;
  foldersBytes?: Uint8Array;
  tombstonesBytes?: Uint8Array;
  /** `name` is the entry's name inside `attachments/`, i.e. its `blobName`. */
  attachments: Map<string, Uint8Array>;
  /** Entries this build has no place for; reported, never written. */
  ignored: string[];
}

/**
 * Sorts the entries of an unpacked archive into the things a restore knows how
 * to apply.
 */
export function splitArchiveEntries(entries: [string, Uint8Array][]): SplitArchiveEntries {
  const res: SplitArchiveEntries = { attachments: new Map(), ignored: [] };
  const attachmentsPrefix = `${ATTACHMENTS_FOLDER}/`;

  for (const [path, bytes] of entries) {
    if (path === MESSAGES_FILE_NAME) {
      res.messagesBytes = bytes;
    } else if (path === FOLDERS_FILE_NAME) {
      res.foldersBytes = bytes;
    } else if (path === TOMBSTONES_FILE_NAME) {
      res.tombstonesBytes = bytes;
    } else if (path.startsWith(attachmentsPrefix)) {
      const name = path.slice(attachmentsPrefix.length);
      // A nested path under attachments/ is not something this app writes, and
      // a blobName could not address it - so it is noise, not an attachment.
      if (name && !name.includes('/')) {
        res.attachments.set(name, bytes);
      } else {
        res.ignored.push(path);
      }
    } else if ((path !== METADATA_FILE_NAME) && (path !== PAYLOAD_FILE_NAME)) {
      res.ignored.push(path);
    }
  }

  return res;
}

/**
 * The name an attachment's bytes go under inside the archive.
 *
 * Derived from the message id and the position in the list rather than from the
 * file name: two attachments of one message may share a name, and a file name
 * the user chose is free to hold slashes, dots and anything else a zip entry
 * name must not.
 */
export function attachmentBlobName(msgId: string, index: number): string {
  return `${sanitizeForEntryName(msgId)}__${index}`;
}

function sanitizeForEntryName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/**
 * The entry an attachment's bytes are read back from, or the reason there are
 * none.
 *
 * Exported and pure because it is the one place where "there are no bytes for
 * this file" is decided, and both the packing and the unpacking side must agree
 * on it.
 */
export function attachmentBytesOf(
  attachment: BackedUpAttachment,
  entries: ReadonlyMap<string, Uint8Array>,
): Uint8Array | undefined {
  if (!attachment.blobName) {
    return undefined;
  }
  return entries.get(attachment.blobName);
}

function twoDigits(value: number): string {
  return `${value}`.padStart(2, '0');
}

/**
 * Default name offered in the save dialog, e.g.
 * `inbox-backup-0_3_41-2026-09-06_18-20.zip`.
 *
 * Dots in the version are replaced rather than kept: a name like
 * `inbox-backup-0.3.41-…` reads as an archive with a `.41-…` extension to file
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
    ? `inbox-backup-${version}-${stamp}.zip`
    : `inbox-backup-${stamp}.zip`;
}
