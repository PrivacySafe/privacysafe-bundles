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
// Pure part of the archive format: no fflate, no sqlite, no `w3n`. Everything
// that decides what an entry may be named and how the entries of an unpacked
// archive are sorted lives here, so that it can be tested on its own.
//
// In shared-libs rather than in either component, because the format is now
// known by both: the deno side writes the records, the window writes the zip
// and the container around an encrypted one - and it has to name its metadata
// file exactly the same way.
import type {
  BackupEncryptionParams,
  BackupMetadataContent,
  SkippedAttachment,
} from '../types/backup.types.ts';
import type { ChatIdObj } from '../types/asmail-msgs.types.ts';
import {
  APP_DOMAIN,
  ATTACHMENTS_FOLDER,
  BACKUP_FORMAT_VERSION,
  CHATS_FILE_NAME,
  MESSAGES_FILE_NAME,
  METADATA_FILE_NAME,
  PAYLOAD_FILE_NAME,
  TOMBSTONES_FILE_NAME,
} from './constants/backup.ts';

/**
 * Builds the metadata of an archive.
 *
 * Used by both sides: the window writes it into an unencrypted archive, and
 * into the container around an encrypted one, where it has to stay readable
 * without a passphrase.
 *
 * The counts are optional for exactly that reason - they are left out of an
 * encrypted archive's metadata, while snapshotTs is not.
 */
export function makeBackupMetadata({
  version,
  snapshotTs,
  skippedAttachments,
  chatsCount,
  messagesCount,
  attachmentsCount,
  encryption,
  now,
}: {
  version: string;
  snapshotTs?: number;
  skippedAttachments?: SkippedAttachment[];
  chatsCount?: number;
  messagesCount?: number;
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
    ...(chatsCount !== undefined && { chatsCount }),
    ...(messagesCount !== undefined && { messagesCount }),
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
  chatsBytes?: Uint8Array;
  messagesBytes?: Uint8Array;
  tombstonesBytes?: Uint8Array;
  /**
   * Bytes of a file attachment, keyed by its `blobName`.
   */
  attachments: Map<string, Uint8Array>;
  /**
   * Files of a folder attachment: blobName -> (path inside the folder -> bytes).
   *
   * A folder attachment is archived as a tree (attachments/<blobName>/<rel>),
   * which is what lets a restore put the folder back rather than a flattened
   * bundle of its files.
   */
  folderAttachments: Map<string, Map<string, Uint8Array>>;
  /** Entries this build has no place for; reported, never written. */
  ignored: string[];
}

/**
 * Sorts the entries of an unpacked archive into the things a restore knows how
 * to apply.
 */
export function splitArchiveEntries(entries: [string, Uint8Array][]): SplitArchiveEntries {
  const res: SplitArchiveEntries = {
    attachments: new Map(),
    folderAttachments: new Map(),
    ignored: [],
  };
  const attachmentsPrefix = `${ATTACHMENTS_FOLDER}/`;

  for (const [path, bytes] of entries) {
    if (path === CHATS_FILE_NAME) {
      res.chatsBytes = bytes;
    } else if (path === MESSAGES_FILE_NAME) {
      res.messagesBytes = bytes;
    } else if (path === TOMBSTONES_FILE_NAME) {
      res.tombstonesBytes = bytes;
    } else if (path.startsWith(attachmentsPrefix)) {
      const name = path.slice(attachmentsPrefix.length);
      const sepPos = name.indexOf('/');
      if (!name) {
        res.ignored.push(path);
      } else if (sepPos < 0) {
        res.attachments.set(name, bytes);
      } else {
        // A nested path is a file of a folder attachment. The relative path is
        // kept whole, slashes and all: it is the shape of the folder, and
        // flattening it would put every file of a nested tree in one place.
        const blobName = name.slice(0, sepPos);
        const relPath = name.slice(sepPos + 1);
        if (!blobName || !relPath) {
          res.ignored.push(path);
          continue;
        }
        let folder = res.folderAttachments.get(blobName);
        if (!folder) {
          folder = new Map();
          res.folderAttachments.set(blobName, folder);
        }
        folder.set(relPath, bytes);
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
 * Derived from the ADDRESSING PAIR and the position in the list rather than
 * from the file name: two attachments of one message may share a name, a file
 * name the user chose is free to hold slashes and dots, and - the reason the
 * chat id is in here - one chatMessageId can occur in two chats, the messages
 * table's key being (chatMessageId, groupChatId, otoPeerCAddr).
 */
export function attachmentBlobName(chatId: ChatIdObj, chatMessageId: string, index: number): string {
  const chatPart = `${chatId.isGroupChat ? 'g' : 's'}_${sanitizeForEntryName(chatId.chatId)}`;
  return `${chatPart}__${sanitizeForEntryName(chatMessageId)}__${index}`;
}

export function sanitizeForEntryName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function twoDigits(value: number): string {
  return `${value}`.padStart(2, '0');
}

/**
 * Default name offered in the save dialog, e.g.
 * `chat-backup-0_12_15-2026-09-06_18-20.zip`.
 *
 * Dots in the version are replaced rather than kept: a name like
 * `chat-backup-0.12.15-…` reads as an archive with a `.15-…` extension to file
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
    ? `chat-backup-${version}-${stamp}.zip`
    : `chat-backup-${stamp}.zip`;
}
