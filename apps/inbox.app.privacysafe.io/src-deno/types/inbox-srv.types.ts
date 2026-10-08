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
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { AppState } from '../../src/common/types/app.types.ts';
import type {
  IncomingMessageView,
  MailFolder,
  OutgoingMessageView,
} from '../../src/common/types/mail.types.ts';
import type { SyncActivityView } from '../services/sync/sync-activity.ts';
import type {
  BackupCreationResult,
  BackupMetadataContent,
  BackupProgress,
  BackupValidationResult,
  RestoreOutcome,
  RestoreProgress,
} from './backup.types.ts';
import type { RestoreMode } from './sync-types.ts';

export interface ItemAttrs {
  fileName?: string;
  messages?: string[];
}

export interface ItemInfo extends ItemAttrs {
  id: string;
  version: number;
  ctime: Date;
  mtime: Date;
}

export interface FileInfo extends ItemInfo {
  isFile: true;
  size: number;
  type: string;
}

export interface FolderInfo extends ItemInfo {
  isFolder: true;
}

export type InboxUpdateEvent =
  | {
      entity: 'message';
      event: 'added' | 'updated' | 'removed';
      msg?: IncomingMessageView | OutgoingMessageView;
      msgId?: string;
    }
  | {
      entity: 'sending';
      event: 'progress';
      id: string;
      progress: web3n.asmail.DeliveryProgress;
    }
  | {
      entity: 'sending';
      event: 'complete';
      id: string;
      status: 'ok' | 'error';
    }
  | {
      entity: 'app-state';
      event: 'updated';
      /** Only what changed; the GUI merges it (see applyAppState). */
      state: Partial<AppState>;
    }
  | {
      entity: 'folder';
      event: 'updated';
      folder: MailFolder;
    }
  | {
      entity: 'folder';
      event: 'removed';
      folderId: string;
    }
  | {
      entity: 'sync';
      event: 'activity';
      view: SyncActivityView;
    }
  | {
      /**
       * How far the archive being packed has got. Deliberately outside
       * COALESCED_ENTITIES (see events.ts): a restore opens the bulk-replay
       * window, and its own progress must not be the thing that window swallows.
       */
      entity: 'backup';
      event: 'progress';
      progress: BackupProgress;
    }
  | {
      entity: 'restore';
      event: 'progress';
      progress: RestoreProgress;
    }
  | {
      /**
       * Re-read the message and folder lists: more changed than is worth
       * reporting one by one.
       *
       * Sent once at the end of the start-up replay of a backlog of
       * synchronization phantoms. That backlog is the whole history of each
       * message it touches, and reporting every step walks the row through that
       * history in front of the user.
       *
       * "Re-read" rather than a batch of the changes, and necessarily: the GUI
       * takes its own first snapshot while the replay is still running, so there
       * is no telling what its lists already hold.
       */
      entity: 'lists';
      event: 'reload';
    };

/**
 * Where the background component is in its startup.
 *
 * Everything else on this service answers only once startup is done, so this is
 * the one thing the GUI can learn while it waits - and the reason it is exposed
 * without waiting for the service itself.
 */
export interface StartupEvent {
  stage: 'starting' | 'migrating-db' | 'migrating-files' | 'ready';
  /** Files moved so far, when `stage` is `migrating-files`. */
  done?: number;
  total?: number;
}

export interface InboxSrv {
  getAppState(): Promise<AppState>;
  /**
   * This installation's device identity - diagnostics, and the app tests.
   *
   * Worth exposing on its own: two copies of the app on one data folder share
   * it, and from the outside that is indistinguishable from broken
   * synchronization.
   */
  getAppDeviceId(): Promise<string>;
  /**
   * The current synchronization state.
   *
   * A getter as well as the event, and necessarily: events are only built while
   * a GUI is attached (emit is lazy), and the catch-up scan often finishes before
   * the GUI subscribes. The monotonic `seq` settles the race between the two.
   */
  getSyncActivityState(): Promise<SyncActivityView>;
  /**
   * Addresses this component is dropping mail from, right now.
   *
   * Answers at once - the tracker is warm from a cache before any RPC - while
   * the contacts app takes up to 13 s of retries to reach from the window. Until
   * it answers, the message list would show no locks and a live Reply button on
   * mail from somebody the user has blocked.
   *
   * Addresses only: names are not needed to decide who is blocked, and the real
   * list, with them, replaces this one as soon as it arrives.
   */
  getBlacklistedAddresses(): Promise<string[]>;
  getFolderList(): Promise<MailFolder[]>;
  /**
   * Creates or updates a folder of the user's.
   *
   * There is no way to make a folder in the GUI yet, so no traffic flows over
   * this entity - the mechanics are built now so that the entity is complete.
   */
  addFolder(folder: MailFolder): Promise<MailFolder[]>;
  deleteFolder(folderId: string): Promise<MailFolder[]>;
  getMessages(): Promise<Array<IncomingMessageView | OutgoingMessageView>>;
  getMessage(msgId: string): Promise<Nullable<IncomingMessageView | OutgoingMessageView>>;
  getMessagesByThread(threadId: string): Promise<Array<IncomingMessageView | OutgoingMessageView>>;
  /**
   * Replays the shared inbox from the watermark, the way a restore does after
   * resetting it - the recovering pass for when the live subscription has gone
   * quiet. Returns how many messages this pass actually added.
   */
  forceRefreshData(): Promise<{ applied: number }>;

  upsertMessage(msg: IncomingMessageView | OutgoingMessageView): Promise<void>;
  moveToTrash(msgId: string): Promise<void>;
  bulkMoveToTrash(msgIds: string[]): Promise<void>;
  bulkRestore(msgIds: string[]): Promise<void>;
  deleteMessages(msgIds: string[]): Promise<void>;
  sendMessage(msg: OutgoingMessageView): Promise<void>;
  cancelSendMessage(msgId: string): Promise<void>;
  preFlight(recipient: string): Promise<number>;
  getReportAddressForDomain(domain: string): Promise<string>;

  addFile(file: web3n.files.ReadonlyFile, info?: ItemAttrs): Promise<string>;
  /**
   * Stores a reference to a file instead of a copy of it, and returns an id that
   * behaves like any other attachment id. This is how an attachment too big to
   * be worth duplicating is kept: ASMail reads attachments lazily and in chunks,
   * so the bytes are taken from the original file when the message is packed.
   *
   * The reference is only as good as its target, which belongs to the user, not
   * to this app. Use hasAttachment() to find out whether it still resolves.
   */
  addLink(file: web3n.files.ReadonlyFile, info?: ItemAttrs): Promise<string>;
  /**
   * Copies an attachment of an incoming message into the store, so that a
   * forward of that message carries the file itself rather than a pointer into a
   * message the user may delete. The bytes stay inside this component.
   */
  storeIncomingAttachment(incomingMsgId: string, fileName: string, msgId: string): Promise<string>;
  /**
   * Whether the attachment's file can still be read. An absent id - the record
   * came from another device of the user - is `false` without any read at all.
   */
  hasAttachment(id: string | undefined): Promise<boolean>;
  getFile(id: string | undefined): Promise<web3n.files.ReadonlyFile>;
  getInfo(id: string): Promise<FileInfo | FolderInfo>;
  updateInfo(id: string, info: ItemAttrs): Promise<void>;
  deleteFile(id: string): Promise<void>;
  copyFileTo(id: string | undefined, target: web3n.files.WritableFile): Promise<void>;
  /**
   * Copies what it can and says how much it left out. A silent skip would put
   * "Attachments have saved" over a folder some of the files never reached.
   */
  copyFilesTo(ids: Array<string | undefined>, fs: web3n.files.WritableFS): Promise<{ skipped: number }>;
  getIncomingAttachment(msgId: string, fileName: string): Promise<web3n.files.ReadonlyFile | null>;
  getIncomingAttachmentsFS(msgId: string): Promise<web3n.files.ReadonlyFS | null>;

  /**
   * Previews of this message's attachments that have already been made, by file
   * name. Making one needs the whole file, which for an incoming attachment
   * means pulling it from the server, so they are kept rather than remade.
   */
  getThumbnails(msgId: string): Promise<Record<string, string>>;
  /**
   * Keeps a preview for next time. Oversized ones are dropped rather than
   * stored: see THUMBNAIL_CACHE_MAX_CHARS.
   */
  saveThumbnail(msgId: string, fileName: string, dataUrl: string): Promise<void>;

  /**
   * Feeds a message of the synchronization type into the receiving tract.
   *
   * The ordinary entrance, simply made callable: the test stand gives two USERS
   * rather than two devices, so phantoms have to be synthesized and handed to a
   * live service. Only the envelope is synthetic.
   *
   * @returns true when the message was handled.
   */
  handleIncomingSyncMsg(msg: web3n.asmail.IncomingMessage): Promise<boolean>;

  /**
   * Packs a backup archive and hands its bytes back.
   *
   * Bytes across the IPC, and not a file, because the manifest gives the GUI
   * `shell.fileDialog` and no `storage`, and this component the other way round.
   * BACKUP_MAX_BYTES is the fuse on that: the size is estimated before anything
   * is packed, and an oversized mailbox is refused with a reason the user can
   * act on rather than by running the device out of memory.
   *
   * @param opts.forEncryption leaves the metadata file out, because the GUI
   *        encrypts this archive whole and puts the metadata into the container
   *        around it - where it stays readable without a passphrase.
   * @param opts.withAttachments false packs records only. The way out of
   *        `archive_too_large`.
   */
  createBackupArchive(opts?: {
    forEncryption?: boolean;
    withAttachments?: boolean;
  }): Promise<BackupCreationResult>;
  /** @returns whether there was a backup to cancel. */
  cancelBackupArchive(): Promise<boolean>;
  /**
   * Reads an archive far enough to tell the user what a restore would do, and
   * refuses early the ones that cannot be read at all.
   *
   * Nothing is written: the archive is opened, its metadata and record counts
   * are taken, and the attachment entries are only counted - never decompressed
   * - so the answer comes before a destructive restore is confirmed. Failures
   * this app understands (a corrupt or foreign archive, unreadable records)
   * come back as `valid: false` with a reason rather than thrown.
   *
   * @param archiveBytes the whole archive, already decrypted by the GUI when it
   *        was protected.
   * @param outerMetadata the metadata of an ENCRYPTED archive, which lives in
   *        the container the GUI opened rather than inside the archive itself.
   * @returns what the archive holds, whether this build can restore it, and a
   *          warning when its provenance or format does not match.
   */
  validateBackupArchive(
    archiveBytes: Uint8Array,
    outerMetadata?: BackupMetadataContent,
  ): Promise<BackupValidationResult>;
  /**
   * Applies an archive, already decrypted by the GUI when it was protected.
   *
   * Also announces the same archive, under the same mode, to the user's other
   * devices, and starts the pass over the shared inbox that the watermark reset
   * calls for. The receiving tract is held off for the whole run, so mail that
   * arrives while the archive is applied is taken on by that pass instead of
   * being lost; the pass itself is deliberately not awaited, the outcome of the
   * restore being final before it.
   *
   * @param archiveBytes the whole archive.
   * @param mode `replace` lets the archive state what the mailbox is, with a
   *        newer local change still winning; `merge` only fills gaps. Both go
   *        through one function, which is also the one a receiving device runs
   *        on the snapshot - see applyRestoreSnapshot().
   * @param outerMetadata the metadata of an ENCRYPTED archive, which lives in
   *        the container the GUI opened rather than inside the archive itself.
   * @returns how many records were created, updated, skipped and deleted, how
   *          much mail now lives only in the archive, and whether the inbox
   *          listing failed.
   */
  restoreBackupArchive(
    archiveBytes: Uint8Array,
    mode: RestoreMode,
    outerMetadata?: BackupMetadataContent,
  ): Promise<RestoreOutcome>;

  watch(obs: web3n.Observer<InboxUpdateEvent>): () => void;
  watchStartup(obs: web3n.Observer<StartupEvent>): () => void;
}

export const INBOX_SRV_REQ_REPLY_METHODS: (keyof InboxSrv)[] = [
  'getAppState',
  'getAppDeviceId',
  'getSyncActivityState',
  'getBlacklistedAddresses',
  'getFolderList',
  'addFolder',
  'deleteFolder',
  'handleIncomingSyncMsg',
  'getMessages',
  'getMessage',
  'getMessagesByThread',
  'forceRefreshData',
  'upsertMessage',
  'moveToTrash',
  'bulkMoveToTrash',
  'bulkRestore',
  'deleteMessages',
  'sendMessage',
  'cancelSendMessage',
  'getReportAddressForDomain',
  'preFlight',
  'addFile',
  'addLink',
  'storeIncomingAttachment',
  'hasAttachment',
  'getFile',
  'getInfo',
  'updateInfo',
  'deleteFile',
  'copyFileTo',
  'copyFilesTo',
  'getIncomingAttachment',
  'getIncomingAttachmentsFS',
  'getThumbnails',
  'saveThumbnail',
  'createBackupArchive',
  'cancelBackupArchive',
  'validateBackupArchive',
  'restoreBackupArchive',
];

export const INBOX_SRV_OBSERVABLE_METHODS: (keyof InboxSrv)[] = ['watch', 'watchStartup'];

/**
 * Observable methods that must answer before the service is built. The rest of
 * the facade waits on the startup that `watchStartup` reports, so routing it
 * the same way would deliver its events after they stopped being of use.
 */
export const INBOX_SRV_EAGER_METHODS: (keyof InboxSrv)[] = ['watchStartup'];
