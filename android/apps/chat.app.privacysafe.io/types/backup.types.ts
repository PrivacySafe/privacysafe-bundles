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
// Vocabulary of the backup archive and of the two workflows around it. A
// type-only module: it is imported from the GUI as well as from the deno
// component, so that both sides describe an archive with the same words.
import type { ChatIdObj, ChatMessageId } from './asmail-msgs.types.ts';
import type { AttachmentRecordingInfo, ChatMessageAttachmentsInfo } from './chat.types.ts';
import type {
  GroupChatTableFields,
  MsgDbEntry,
  OTOChatTableFields,
  SyncAspect,
  SyncEntityType,
} from '../src-deno/types/index.ts';

/**
 * Ordering token of a change - (hybrid-logical-clock stamp, device).
 *
 * Structurally the SyncToken of src-deno/services/chat-service/utils, restated
 * here rather than imported: the archive format is what these types describe,
 * and it must not start depending on a module that carries the last-write-wins
 * rules, `w3n` and the database with it.
 */
export interface BackedUpSyncToken {
  ts: number;
  deviceId: string;
}

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
  /**
   * The file is bigger than ATTACHMENT_COPY_THRESHOLD, so the message holds a
   * link to the user's own file rather than a copy in the store. The archive
   * does not follow the link.
   */
  | 'symlink'
  /**
   * The bytes live inside the incoming ASMail message the record was built
   * from, in the shared inbox on the server - not in the local store. Nothing
   * is duplicated: the restored record keeps its `incomingMsgId` and reaches
   * the same bytes the same way it does now.
   */
  | 'in-incoming-msg'
  /** The file is in the store, but could not be read. */
  | 'unreadable'
  /**
   * The record came from ANOTHER DEVICE of the user, and bytes never travel
   * between devices - so there is nothing here to put in the archive.
   *
   * Told apart from `no-local-source` because it is the one reason the user can
   * do something about, and with several devices it is the COMMON one rather
   * than the rare one: an archive is only ever as complete as the device it is
   * taken on.
   */
  | 'on-another-device'
  /** A folder attachment past MAX_FILES_PER_FOLDER_ATTACHMENT; the rest is in. */
  | 'folder-partial'
  /** The user asked for an archive without attachments. */
  | 'not-requested'
  /** No file to read and no marking saying why. Should not happen. */
  | 'no-local-source';

/**
 * The record as it stood when the verdict was reached.
 *
 * Written into the metadata alongside the reason, and that is not verbosity:
 * more than one shape of record reaches the same verdict, and the verdict alone
 * is not enough to explain an archive that came out with no attachments at all.
 * These are exactly the fields planAttachment() decides on, so the archive says
 * not only WHAT it left out but which property made it do so - without anybody
 * having to unpack `messages.json` or grep a log.
 */
export interface SkippedAttachmentRecord {
  hasId: boolean;
  isFolder?: true;
  hasNoLocalSource?: true;
  isIncomingMsg?: true;
  fromDeviceId?: string;
}

export interface SkippedAttachment {
  chatId: ChatIdObj;
  chatMessageId: string;
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
   * barrier of the `replace` mode: "a local entity older than the archive"
   * means exactly "its greatest stamp is below this".
   *
   * Calendar `createdAt` cannot serve for that: tokens live on the HLC scale,
   * which runs ahead of Date.now() as soon as two devices' clocks disagree.
   *
   * Kept in an ENCRYPTED archive's metadata as well, unlike the counts: without
   * it the `replace` mode has no barrier at all.
   */
  snapshotTs?: number;
  /**
   * Absent from an ENCRYPTED archive: the size of a conversation history is not
   * worth disclosing to somebody who cannot open the archive anyway.
   */
  chatsCount?: number;
  messagesCount?: number;
  attachmentsCount?: number;
  /** What did not make it into the archive, and why. */
  skippedAttachments?: SkippedAttachment[];
  /** Absent from an unencrypted archive. */
  encryption?: BackupEncryptionParams;
}

/**
 * An attachment in its archived form.
 *
 * Deliberately NOT left inside the record: attachmentsForPhantom() cuts `id`
 * out and marks the attachment `hasNoLocalSource`, because an id points into
 * another device's file store and can COLLIDE with a local one. An archive
 * needs the opposite - the link between a record and its bytes - so the two are
 * kept apart.
 */
export interface BackedUpAttachment {
  fileName: string;
  size: number;
  isFolder?: boolean;
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
  /**
   * Set when the attachment was recorded in the app.
   *
   * Listed here explicitly because this is the one place where an attachment's
   * fields are enumerated by hand rather than spread: everywhere else a new
   * field on ChatMessageAttachmentsInfo travels by itself. Without it a
   * restored voice or video message would quietly come back as an ordinary
   * media attachment.
   */
  recording?: AttachmentRecordingInfo;
}

/**
 * A message's row as it goes into the archive.
 *
 * The row itself minus the two chat columns (which the addressing pair carries)
 * and minus `attachments` (which becomes its own field). There is no
 * syncedRecordOf() in this app, so the natural archived form of a record is the
 * row - everything the restore has to write is in it.
 */
export type BackedUpMsgRecord = Omit<MsgDbEntry, 'groupChatId' | 'otoPeerCAddr' | 'attachments'>;

export interface BackedUpMsg {
  /**
   * Addressed by a PAIR, not by a message id: the messages table's primary key
   * is (chatMessageId, groupChatId, otoPeerCAddr), so one chatMessageId can
   * legitimately occur in two chats.
   */
  chatId: ChatIdObj;
  chatMessageId: string;
  record: BackedUpMsgRecord;
  attachments?: BackedUpAttachment[];
  versions: Partial<Record<SyncAspect, BackedUpSyncToken>>;
}

/**
 * A chat's row as it goes into the archive.
 *
 * A chat is an entity with five synchronized aspects (`name`, `settings`,
 * `members`, `admins`, `status`) plus `createdAt`/`lastUpdatedAt`/`peerAddr`,
 * so the whole row travels; the aggregates the chat list computes (`lastMsg`,
 * `unread`) are stripped, being derived from the messages.
 */
export type BackedUpChatRecord =
  | ({ isGroupChat: true } & GroupChatTableFields)
  | ({ isGroupChat: false } & OTOChatTableFields);

export interface BackedUpChat {
  chatId: ChatIdObj;
  record: BackedUpChatRecord;
  versions: Partial<Record<SyncAspect, BackedUpSyncToken>>;
}

export interface BackedUpTombstone {
  entityType: SyncEntityType;
  entityId: string;
  /**
   * Which marker this is. `deleted` is the entity's own tombstone; a chat's
   * `historyCleared` is not a tombstone of the chat - the chat lives on - and
   * clearing a chat's history in this app writes ONE such marker rather than a
   * tombstone per message.
   */
  aspect: 'deleted' | 'historyCleared';
  token: BackedUpSyncToken;
  tombstonedAt: number;
}

/**
 * An attachment whose bytes the window is to read out of the file store.
 *
 * The plan the deno component hands over carries ids, never bytes: in this app
 * the window can reach the store itself, so nothing of an attachment crosses
 * IPC.
 */
export interface PlannedAttachment {
  chatId: ChatIdObj;
  chatMessageId: string;
  fileName: string;
  blobName: string;
  entityId: string;
  isFolder?: boolean;
}

/**
 * Everything the deno component knows about an archive to be taken: the records
 * and the work-list of attachments. The window turns this into a zip.
 */
export interface BackupPlan {
  snapshotTs: number;
  chats: BackedUpChat[];
  messages: BackedUpMsg[];
  tombstones: BackedUpTombstone[];
  attachmentsToRead: PlannedAttachment[];
  /** Decided by the database side; the window adds its own to this list. */
  skippedAttachments: SkippedAttachment[];
  chatsCount: number;
  messagesCount: number;
}

/**
 * The three json entries of an archive, as the window read them back.
 *
 * Bytes, not parsed objects: the parse is the restore's own first step, and a
 * malformed entry has to be its error rather than an exception thrown while
 * the argument was being serialized for IPC.
 */
export interface BackupRecordFiles {
  chatsJson: string;
  messagesJson: string;
  tombstonesJson?: string;
}

/**
 * What a restore is allowed to do to what is already here.
 *
 * `merge` only fills gaps and can destroy nothing; `replace` makes the archive
 * the statement of what the state is, deleting local entities older than the
 * archive that the archive does not hold.
 */
export type RestoreMode = 'merge' | 'replace';

/** Why an archive cannot be read. Distinct from "read, but not compatible". */
export type BackupArchiveError =
  | 'corrupted_archive'
  | 'foreign_archive'
  | 'no_chats'
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
  snapshotTs?: number;
  chatsCount?: number;
  messagesCount?: number;
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

/**
 * Numbers for the dialog that picks the mode, from a dry run over the archive
 * that has already been read. Nothing is written to produce these.
 */
export interface RestorePreview {
  mode: RestoreMode;
  /** Entities in the archive that are not here at all. */
  chatsToCreate: number;
  messagesToCreate: number;
  /** Entities the archive would touch an aspect of. `merge` leaves these alone. */
  chatsToUpdate: number;
  messagesToUpdate: number;
  /** Only in `replace`: local entities the archive says are gone. */
  chatsToDelete: number;
  messagesToDelete: number;
  /** Records whose auto-deletion time has already passed; see §6.4 of the plan. */
  expiredSkipped: number;
}

export interface RestoreOutcome {
  restored: boolean;
  chatsCreated: number;
  chatsUpdated: number;
  messagesCreated: number;
  messagesUpdated: number;
  skipped: number;
  /** Records left out because their auto-deletion time has already passed. */
  skippedExpired: number;
  chatsDeleted: number;
  messagesDeleted: number;
  /**
   * Ids of attachments the window stored whose bytes the aspect rules found no
   * use for (in `merge` the record is already here with bytes of its own). The
   * window deletes these, or every restore would leave orphans in the store.
   */
  unusedAttachmentIds: string[];
  /** The inbox listing failed, so reachability of an incomingMsgId is a guess. */
  inboxListingFailed: boolean;
}

export interface BackupProgress {
  /**
   * `scanning` is the only stage of the deno component. The rest belong to the
   * window, which owns the file store, the zip, the passphrase and the dialog.
   */
  stage:
    | 'scanning'
    | 'reading-attachments'
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
    | 'storing-attachments'
    | 'listing-inbox'
    | 'restoring'
    | 'announcing'
    | 'completed'
    | 'error';
  totalItems: number;
  processedItems: number;
  currentItem?: string;
  percent: number;
}

/**
 * One message of a restore snapshot as it travels to the user's other devices.
 *
 * The record travels; the bytes never do, and `incomingMsgId` goes instead (see
 * the carrier rule in doc/08-backup-and-restore.md). Attachment entries keep
 * their names and sizes with `hasNoLocalSource` set, exactly as a phantom of a
 * regular message carries them.
 */
export interface SnapshotMsgEntry {
  chatId: ChatIdObj;
  chatMessageId: string;
  record: BackedUpMsgRecord;
  attachments?: ChatMessageAttachmentsInfo[];
  versions: Partial<Record<SyncAspect, BackedUpSyncToken>>;
}

export interface SnapshotChatEntry {
  chatId: ChatIdObj;
  record: BackedUpChatRecord;
  versions: Partial<Record<SyncAspect, BackedUpSyncToken>>;
}

/** The deletions a `replace` made, carried by the last chunk of the snapshot. */
export interface SnapshotDeletions {
  chatIds?: ChatIdObj[];
  msgIds?: ChatMessageId[];
  token: BackedUpSyncToken;
}
