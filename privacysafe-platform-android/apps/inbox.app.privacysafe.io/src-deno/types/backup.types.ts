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
// Types of the backup archive and of the two workflows around it. A type-only
// module: it is imported from the GUI as well as from the deno service, so that
// both sides describe an archive with the same words.
import type { MailFolder } from '../../src/common/types/mail.types.ts';
import type { SyncedMsgRecord } from './mail-sync.types.ts';
import type { SyncAspect, SyncEntityType, SyncToken } from './sync-types.ts';

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

/** Why an attachment's bytes are not in the archive. */
export type OmittedAttachmentReason =
  /** A symlink to a file on the user's own disk; the archive does not follow it. */
  | 'external'
  /** Lives inside an incoming message on the server, not in the local store. */
  | 'origin'
  /** The file is in the store, but could not be read. */
  | 'unreadable'
  /**
   * The record came from ANOTHER DEVICE of the user, and bytes never travel
   * between devices - so there is nothing here to put in the archive.
   *
   * Told apart from `no-local-source` because it is the one reason the user can
   * do something about, and with several devices it is the COMMON one rather
   * than the rare one: an archive is only ever as complete as the device it is
   * taken on. Nothing said so until a live run found a mailbox whose whole
   * archive held no attachments at all.
   */
  | 'on-another-device'
  /** The user asked for an archive without attachments. */
  | 'not-requested'
  /** No file to read and no marking saying why. Should not happen. */
  | 'no-local-source';

/**
 * The record as it stood when the verdict was reached.
 *
 * Written into the metadata alongside the reason, and that is not verbosity: the
 * verdict alone twice failed to explain an archive that came out with no
 * attachments at all, because more than one shape of record can reach the same
 * one. These are exactly the fields planAttachment() decides on, so the archive
 * says not only WHAT it left out but which property made it do so - without
 * anybody having to unpack `messages.json` or grep a log.
 */
export interface SkippedAttachmentRecord {
  hasId: boolean;
  type?: string;
  external?: true;
  hasNoLocalSource?: true;
  hasOriginMsgId?: boolean;
}

export interface SkippedAttachment {
  msgId: string;
  fileName: string;
  reason: OmittedAttachmentReason;
  /** The device the file is on, for `on-another-device`. */
  originDeviceId?: string;
  record?: SkippedAttachmentRecord;
}

export interface BackupMetadataContent {
  /**
   * Which app wrote this archive, so that an archive of another privacysafe app
   * can be told apart. Absent from archives written before the field existed,
   * so a missing one is not on its own a reason to refuse.
   */
  appDomain?: string;
  /** w3n.myVersion() of the app that wrote the archive. */
  version: string;
  formatVersion: number;
  createdAt: string;
  /**
   * The hybrid-logical-clock stamp taken when the archive was built - the
   * barrier of the `replace` mode: "a local entity older than the archive" means
   * exactly "its greatest stamp is below this".
   *
   * Calendar `createdAt` cannot serve for that: tokens live on the HLC scale,
   * which runs ahead of Date.now() as soon as two devices' clocks disagree.
   */
  snapshotTs?: number;
  /**
   * Absent from an ENCRYPTED archive: the size of a mailbox is not worth
   * disclosing to somebody who cannot open the archive anyway.
   */
  messagesCount?: number;
  foldersCount?: number;
  attachmentsCount?: number;
  /** What did not make it into the archive, and why. */
  skippedAttachments?: SkippedAttachment[];
  /** Absent from an unencrypted archive. */
  encryption?: BackupEncryptionParams;
}

/**
 * An attachment in its archived form.
 *
 * Deliberately NOT inside `record`: attachmentsForPhantom() cuts `id` out and
 * marks the record `hasNoLocalSource`, because an id points into another
 * device's file store and can COLLIDE with a local one. An archive needs the
 * opposite - the link between a record and its bytes - so the two are kept
 * apart, which also lets syncedRecordOf() be reused unchanged.
 */
export interface BackedUpAttachment {
  fileName: string;
  size: number;
  type?: string;
  originMsgId?: string;
  /**
   * The device the file is on, when it is not on the one that took the archive.
   * Carried so that a restore can say WHICH device rather than only that the
   * file is elsewhere.
   */
  originDeviceId?: string;
  /** Name of the entry under `attachments/`, when the bytes are in the archive. */
  blobName?: string;
  /** Why the bytes are not. */
  omitted?: OmittedAttachmentReason;
}

export interface BackedUpMsg {
  msgId: string;
  incoming: boolean;
  /** The part shared with a phantom; built by syncedRecordOf(). */
  record: SyncedMsgRecord;
  /** `record.attachmentsInfo` is ignored on restore in favour of this. */
  attachments?: BackedUpAttachment[];
  versions: Partial<Record<SyncAspect, SyncToken>>;
}

export interface BackedUpFolder {
  folder: MailFolder;
  versions: Partial<Record<SyncAspect, SyncToken>>;
}

export interface BackedUpTombstone {
  entityType: SyncEntityType;
  entityId: string;
  token: SyncToken;
  tombstonedAt: number;
}

/** Why an archive cannot be read. Distinct from "read, but not compatible". */
export type BackupArchiveError =
  | 'corrupted_archive'
  | 'foreign_archive'
  | 'no_messages'
  | 'unreadable_records'
  | 'archive_too_large'
  | 'passphrase_required'
  | 'wrong_passphrase'
  | 'encryption_unsupported';

/** Why an archive is readable, yet its provenance cannot be confirmed. */
export type BackupVersionWarning = 'missing_metadata' | 'invalid_metadata' | 'version_mismatch';

export interface BackupValidationResult {
  /** Whether the archive can be read at all. Only this blocks a restore. */
  valid: boolean;
  /** Whether its layout is one this build knows; false only warns the user. */
  compatible: boolean;
  appVersion: string;
  archiveVersion?: string;
  formatVersion?: number;
  /** Set by the GUI, which owns the container the passphrase protects. */
  encrypted?: boolean;
  messagesCount?: number;
  foldersCount?: number;
  attachmentsCount?: number;
  createdAt?: string;
  /**
   * What the archive does NOT hold the bytes of, as its metadata records it.
   *
   * Reported before a restore on purpose: this is the one thing a restore
   * cannot bring back, and finding it out afterwards - or by unpacking the
   * archive by hand - is finding it out too late.
   */
  skippedAttachments?: SkippedAttachment[];
  warningReason?: BackupVersionWarning;
  error?: BackupArchiveError;
}

export interface BackupProgress {
  /**
   * No 'encrypting' or 'saving' in the service: those two stages belong to the
   * GUI, which owns the container, the passphrase and the file dialog.
   */
  stage:
    | 'scanning'
    | 'compressing'
    | 'encrypting'
    | 'saving'
    | 'completed'
    | 'error'
    | 'cancelled';
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
  percent: number;
}

export interface RestoreProgress {
  stage:
    | 'unpacking'
    | 'decrypting'
    | 'listing-inbox'
    | 'restoring-attachments'
    | 'restoring-messages'
    | 'announcing'
    | 'completed'
    | 'error';
  totalItems: number;
  processedItems: number;
  currentItem?: string;
  percent: number;
}

export interface BackupCreationResult {
  bytes: Uint8Array;
  skippedAttachments: SkippedAttachment[];
  messagesCount: number;
  foldersCount: number;
  attachmentsCount: number;
  /**
   * Handed back as well as written into the metadata, because for an ENCRYPTED
   * archive the GUI is the one that writes the metadata - into the container,
   * where it stays readable without a passphrase. Without this the restore of an
   * encrypted archive would have no barrier for its `replace` mode.
   */
  snapshotTs: number;
}

export interface RestoreOutcome {
  restored: boolean;
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  /**
   * Restored incoming messages that are no longer in the shared inbox - the ones
   * the archive is now the only carrier of.
   */
  onlyInArchive: number;
  /** The inbox listing failed, so reachability of `origin` attachments is a guess. */
  inboxListingFailed: boolean;
}
