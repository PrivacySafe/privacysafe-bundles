/*
 Copyright (C) 2024-2026 3NSoft Inc.

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
import { SQLiteOn3NStorage } from '../../shared/libs/sqlite-on-3nstorage/index.js';
import type { ParamsObject, QueryExecResult } from '../../shared/libs/sqlite-on-3nstorage/sqljs.d.ts';
import { MAIL_FOLDERS_DEFAULT } from '../../src/common/constants/mail-folders-default.ts';
import type { AppState, IncomingMessageView, MailFolder, OutgoingMessageView } from '../../src/common/types/index.ts';
import {
  INBOX_REMOVAL_DELAY_MS,
  ORPHAN_TTL_MS,
  SYNC_WINDOW_MS,
  TOMBSTONE_TTL_MS,
} from '../../shared/constants/sync.ts';
import { randomIdStr } from '../../shared/utils/random-id.ts';
import type {
  OrphanedSyncDbEntry,
  OrphanedSyncEntry,
  PendingSyncMsgDbEntry,
  PendingSyncMsgEntry,
  SyncAspect,
  SyncEntityType,
  SyncToken,
  SyncVersionDbEntry,
  SyncVersionRow,
  SyncVersionWrite,
} from '../types/sync-types.ts';
import {
  GET_STATE_QUERY,
  UPSERT_STATE_QUERY,
  INSERT_FOLDER_QUERY,
  UPSERT_FOLDER_QUERY,
  GET_FOLDER_LIST_QUERY,
  DELETE_FOLDER_BY_ID_QUERY,
  GET_MESSAGES_QUERY,
  GET_MESSAGE_QUERY_BY_ID,
  INSERT_MESSAGE_QUERY,
  UPSERT_MESSAGE_QUERY,
  DELETE_MESSAGE_BY_ID_QUERY,
  GET_MESSAGES_QUERY_BY_THREAD_ID,
  DELETE_THREAD_QUERY,
  GET_THUMBNAILS_BY_MSG_QUERY,
  UPSERT_THUMBNAIL_QUERY,
  DELETE_THUMBNAILS_BY_MSG_QUERY,
  DELETE_THUMBNAILS_BY_THREAD_QUERY,
  GET_SYNC_DEVICE_QUERY,
  UPSERT_SYNC_DEVICE_QUERY,
  GET_SYNC_VERSION_QUERY,
  GET_ALL_SYNC_VERSIONS_QUERY,
  UPSERT_SYNC_VERSION_QUERY,
  DELETE_SYNC_VERSIONS_OF_QUERY,
  GC_SYNC_VERSIONS_QUERY,
  INSERT_PENDING_SYNC_MSG_QUERY,
  GET_PENDING_SYNC_MSGS_QUERY,
  COUNT_PENDING_SYNC_MSGS_QUERY,
  DELETE_PENDING_SYNC_MSG_QUERY,
  BUMP_PENDING_SYNC_MSG_ATTEMPTS_QUERY,
  GET_PENDING_SYNC_MSG_ATTEMPTS_QUERY,
  DROP_EXPIRED_PENDING_SYNC_MSGS_QUERY,
  INSERT_ORPHANED_SYNC_QUERY,
  GET_ORPHANED_SYNCS_FOR_QUERY,
  DELETE_ORPHANED_SYNC_QUERY,
  COUNT_ORPHANED_SYNCS_QUERY,
  GC_ORPHANED_SYNCS_QUERY,
  SCHEDULE_INBOX_REMOVAL_QUERY,
  GET_EXPIRED_INBOX_REMOVALS_QUERY,
  DELETE_INBOX_REMOVAL_QUERY,
  COUNT_PENDING_INBOX_REMOVALS_QUERY,
  GET_CONTACT_BLACKLIST_QUERY,
  CLEAR_CONTACT_BLACKLIST_QUERY,
  INSERT_CONTACT_BLACKLIST_QUERY,
} from './queries.ts';
import {
  folderValueToSqlInsertParams,
  folderDbValueToFolderValue,
  msgDbValueToMsgValue,
  msgValueToSqlInsertParams,
  appStateDbValueToAppState,
  appStateValueToSqlInsertParams,
  thumbnailsDbValueToRecord,
  objectFromQueryExecResult,
  isEmpty,
} from './utils.ts';
import { makeDbWriter, type DbWriter } from './db-writer.ts';

export interface DBProvider {
  getAppState(): AppState;
  /**
   * Merges the patch into the stored state, rather than replacing it.
   *
   * Callers pass whatever they happen to know - persistIncomingMail passes only
   * the watermark - so a replacing write would wipe every other field the state
   * has. AppState has one field today, so nothing goes off yet; the second field
   * added to it would give a silent defect reproducible only after the first
   * incoming message.
   */
  updateAppState(state: Partial<AppState>, noDiskWrite?: boolean): Promise<void>;
  addFolder(folderData: MailFolder, noDiskWrite?: boolean): Promise<MailFolder[]>;
  /** Same as addFolder, but for a folder that may already be here - applying a phantom. */
  upsertFolder(folderData: MailFolder, noDiskWrite?: boolean): Promise<MailFolder[]>;
  deleteFolder(folderData: MailFolder, noDiskWrite?: boolean): Promise<MailFolder[]>;
  getFolderList(): MailFolder[];
  getFolderById(folderId: string): MailFolder | undefined;
  addMessage(
    msgData: IncomingMessageView | OutgoingMessageView,
    noDiskWrite?: boolean,
  ): Promise<Array<IncomingMessageView | OutgoingMessageView>>;
  updateMessage(
    msgData: IncomingMessageView | OutgoingMessageView,
    noDiskWrite?: boolean,
  ): Promise<Array<IncomingMessageView | OutgoingMessageView>>;
  deleteMessageById(
    msgId: string,
    noDiskWrite?: boolean,
  ): Promise<Array<IncomingMessageView | OutgoingMessageView>>;
  getMessageById(msgId: string): Nullable<IncomingMessageView | OutgoingMessageView>;
  getMessages(): Array<IncomingMessageView | OutgoingMessageView>;
  getMessagesByThread(threadId: string): Array<IncomingMessageView | OutgoingMessageView>;
  deleteThread(threadId: string, noDiskWrite?: boolean): Promise<Array<IncomingMessageView | OutgoingMessageView>>;
  /** Cached attachment previews of one message, by file name. */
  getThumbnails(msgId: string): Record<string, string>;
  upsertThumbnail(msgId: string, fileName: string, dataUrl: string, noDiskWrite?: boolean): Promise<void>;
  deleteThumbnails(msgId: string, noDiskWrite?: boolean): Promise<void>;
  /**
   * Resolves once every mutation made so far is in the database file. Mutations
   * themselves only schedule the write, so this is what a caller about to make
   * a change visible outside this device has to await.
   */
  flush(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Device identity and the hybrid logical clock
  // ---------------------------------------------------------------------------

  /**
   * This installation's device identity: the LWW tie-break, and how a phantom
   * of this device is recognized as its own echo. Made once, on the first start
   * that finds no row.
   */
  getAppDeviceId(): string;
  /**
   * Stamp of a change made on this device.
   *
   * Synchronous on purpose: the atomicity of queueSyncPhantom() rests on there
   * being no await between the writing of the versions and the writing of the
   * journal row, and a stamp taken in between must not be able to reach the file
   * on its own.
   *
   * Taking max() with the highest stamp seen so far means a change made after
   * seeing another device's change always gets a greater stamp, however far this
   * device's wall clock is off.
   */
  nextSyncStamp(): number;
  nextSyncToken(): SyncToken;
  /** Advances the clock past a stamp seen in a received phantom. */
  observeSyncStamp(ts: number): void;
  /** Whether a phantom from another device of this user has ever been seen. */
  hasSeenOtherDevice(): boolean;
  noteOtherDeviceSeen(deviceId: string): Promise<void>;

  // ---------------------------------------------------------------------------
  // Per-aspect ordering tokens
  // ---------------------------------------------------------------------------

  getSyncVersion(
    entityType: SyncEntityType,
    entityId: string,
    aspect: SyncAspect,
  ): SyncVersionDbEntry | undefined;
  setSyncVersion(
    entityType: SyncEntityType,
    entityId: string,
    aspect: SyncAspect,
    version: SyncToken & { tombstonedAt?: number },
  ): Promise<void>;
  /**
   * Every row of `sync_versions`, tombstones included. What a backup exports
   * alongside the records: an archive carries entities together with their
   * per-aspect tokens, which is what lets a restore be expressed in the rules
   * that already exist rather than inventing merge rules of its own.
   */
  getAllSyncVersions(): SyncVersionRow[];
  /**
   * Writes several versions with ONE scheduled file write.
   *
   * A restore writes a token per aspect per message; going through
   * setSyncVersion() would arm the batching writer once per token, and on a
   * mailbox of a few thousand messages that is thousands of rewrites of the
   * whole database file.
   */
  setSyncVersions(versions: SyncVersionWrite[]): Promise<void>;
  /** Drops an entity's versions, except its tombstones. */
  deleteSyncVersionsOf(entityType: SyncEntityType, entityId: string): Promise<void>;
  /** Collects tombstones past TOMBSTONE_TTL_MS, and nothing else. */
  collectGarbageInSyncVersions(now: number): Promise<number>;

  // ---------------------------------------------------------------------------
  // Journal of outgoing phantoms
  // ---------------------------------------------------------------------------

  /**
   * Writes a journal row together with the versions of the change it announces,
   * in one operation with no await between the writes: no file write can then
   * catch a spent ordering token without the phantom that is supposed to spend
   * it.
   */
  queueSyncPhantom(entry: PendingSyncMsgEntry, versions?: SyncVersionWrite[]): Promise<void>;
  getPendingSyncPhantoms(): PendingSyncMsgDbEntry[];
  /** The same number without reading payloads: this one is polled. */
  countPendingSyncPhantoms(): number;
  deletePendingSyncPhantom(id: number): Promise<void>;
  /** @returns the new attempt count, or 0 when the row is no longer there. */
  recordPendingSyncPhantomFailure(id: number): Promise<number>;
  dropExpiredSyncPhantoms(now: number): Promise<number>;

  // ---------------------------------------------------------------------------
  // Buffer of phantoms that arrived before what they are about
  // ---------------------------------------------------------------------------

  addOrphanedSync(entry: OrphanedSyncEntry): Promise<void>;
  getOrphanedSyncsFor(targetMsgId: string): OrphanedSyncDbEntry[];
  deleteOrphanedSync(id: number): Promise<void>;
  countOrphanedSyncs(): number;
  collectGarbageInOrphanedSyncs(now: number): Promise<number>;

  // ---------------------------------------------------------------------------
  // Deferred removal of phantoms from the shared inbox
  // ---------------------------------------------------------------------------

  /**
   * @param delayMs how long the message stays in the shared inbox first;
   *        INBOX_REMOVAL_DELAY_MS by default. 0 is for a removal that was
   *        already meant to happen and failed on the network - it is then due at
   *        once, and the next maintenance pass retries it.
   */
  scheduleInboxMsgRemoval(msgId: string, noDiskWrite?: boolean, delayMs?: number): Promise<void>;
  getExpiredInboxRemovals(now: number): string[];
  dropInboxRemovals(msgIds: string[], noDiskWrite?: boolean): Promise<void>;
  countPendingInboxRemovals(): number;

  // ---------------------------------------------------------------------------
  // Cached copy of the contacts app's blacklist
  // ---------------------------------------------------------------------------

  /**
   * Canonical addresses, as of the last time the contacts app answered.
   *
   * Read synchronously at start-up, before any RPC, so that mail from a blocked
   * sender is filtered from the first message of the session.
   */
  getCachedBlacklist(): string[];
  /** Replaces the cache whole - the contacts app sends the list entire. */
  setCachedBlacklist(addresses: string[]): Promise<void>;

  // ---------------------------------------------------------------------------
  // Restoration from a backup archive
  // ---------------------------------------------------------------------------

  /**
   * Whether a restore is going on right now.
   *
   * In memory rather than in a column, and deliberately: the flag exists to keep
   * the background tracts from rewriting what a restore is writing, and both of
   * those live in this process. A persisted flag would have to be cleared at
   * every start, and a flag whose only correct start-up action is "clear" is a
   * liability.
   *
   * What it changes is one branch of the mail service: while it is raised
   * handleOne() answers "not handled", so the WATERMARK DOES NOT ADVANCE and the
   * catch-up scan lists those messages again once the restore is over. That is
   * why no new lock is needed here.
   */
  isRestoreInProgress(): boolean;
  setRestoreInProgress(value: boolean): void;
}

export async function dataset(): Promise<DBProvider> {
  let sqlite: SQLiteOn3NStorage;
  let writer: DbWriter;

  /**
   * Device identity and the clock, cached in this closure. Both are written
   * through sql.js plus writer.scheduleSave(), so neither costs a file write of
   * its own: whatever spends a stamp marks the database dirty in the same
   * moment, and the batcher glues both into one.
   */
  let appDeviceId = '';
  let lastSyncClockTs = 0;
  let otherDeviceSeenId: string | undefined = undefined;
  let otherDeviceSeenAt: number | undefined = undefined;

  /**
   * Whether a restore is going on. In memory - see isRestoreInProgress() on the
   * interface for why it is not a column.
   */
  let restoreInProgress = false;

  /**
   * Whether this start put any schema in. getRowsModified() is
   * sqlite3_changes(), which counts the rows of the last DML and does not react
   * to DDL at all, so the check below cannot be left to it.
   */
  let schemaChanged = false;

  function ensureTable(name: string, ddl: string): void {
    if (sqlite.db.exec(`PRAGMA table_info(${name})`).length === 0) {
      sqlite.db.exec(ddl);
      schemaChanged = true;
    }
  }

  function ensureColumn(table: string, column: string, ddl: string): void {
    const [info] = sqlite.db.exec(`PRAGMA table_info(${table})`);
    if (!info?.values.some(row => row[1] === column)) {
      sqlite.db.exec(ddl);
      schemaChanged = true;
    }
  }

  async function initialization() {
    // Local, not synced: reading a synced version can block on pulling it from
    // the server, and that sits on the path to this component's first reply.
    const fs = await w3n.storage!.getAppLocalFS();
    const file = await fs.writableFile('storage-db');
    sqlite = await SQLiteOn3NStorage.makeAndStart(file);
    writer = makeDbWriter(sqlite, 'inbox');

    sqlite.db.exec(`--sql
      CREATE TABLE IF NOT EXISTS app (
      id TEXT PRIMARY KEY UNIQUE,
      state TEXT NOT NULL
    ) STRICT`);

    const existingState = getAppStateRaw();
    if (!existingState) {
      await updateAppState({ lastReceivingTimestamp: 0 }, true);
    }

    sqlite.db.exec(`--sql
      CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY UNIQUE,
      name TEXT NOT NULL,
      icon TEXT,
      iconColor TEXT,
      position INTEGER NOT NULL,
      path TEXT NOT NULL,
      isSystem INTEGER NOT NULL
    ) STRICT`);

    const folderList = getFolderList();
    if (isEmpty(folderList)) {
      MAIL_FOLDERS_DEFAULT.forEach(folderData => {
        addFolder(folderData, true);
      });
    }

    sqlite.db.exec(`--sql
      CREATE TABLE IF NOT EXISTS messages (
      msgId TEXT PRIMARY KEY UNIQUE,
      threadId TEXT NOT NULL,
      cTime INTEGER,
      msgType TEXT NOT NULL,
      deliveryTS INTEGER,
      subject TEXT,
      plainTxtBody TEXT,
      htmlTxtBody TEXT,
      jsonBody TEXT NOT NULL,
      recipients TEXT,
      sender TEXT,
      status TEXT,
      statusDescription TEXT,
      attachmentsInfo TEXT,
      mailFolder TEXT NOT NULL,
      FOREIGN KEY (mailFolder) REFERENCES folders (id) ON DELETE CASCADE
    ) STRICT`);

    // Previews of attachments, kept so that reopening a message does not read
    // its attachments again - which for an incoming message means pulling them
    // from the server again.
    //
    // A table of their own rather than a field in attachmentsInfo: that column
    // travels with the message record, and getMessages() reads every message at
    // once, so previews of the whole mailbox would ride along on every call.
    //
    // No foreign key on msgId: PRAGMA foreign_keys is never turned on, which
    // makes the one above decorative too, so rows are removed explicitly by
    // whoever deletes the message.
    sqlite.db.exec(`--sql
      CREATE TABLE IF NOT EXISTS thumbnails (
      msgId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      dataUrl TEXT NOT NULL,
      PRIMARY KEY (msgId, fileName)
    ) STRICT`);

    // The first change to the `messages` table in this app's life, so this is
    // also where a column migration first has to work. A STRICT table takes
    // ADD COLUMN as long as there is no NOT NULL and no DEFAULT.
    ensureColumn('messages', 'originDeviceId', `--sql
      ALTER TABLE messages ADD COLUMN originDeviceId TEXT`);

    // A cached copy of the list that belongs to the contacts app - never a
    // source of truth. It is here so that the incoming filter is armed from the
    // first second of a start: reaching the contacts app takes seconds of
    // retries, and the catch-up scan of the inbox waits for nobody.
    //
    // A table of its own rather than a field of AppState, for the reason spelled
    // out over sync_device below, and one more: AppState travels to the window
    // in `app-state` events, and another app's cache has no business there.
    ensureTable('contact_blacklist', `--sql
      CREATE TABLE IF NOT EXISTS contact_blacklist (
      address TEXT PRIMARY KEY
    ) STRICT`);

    initializeSyncTables();
    loadSyncDeviceRow();

    // Only when this start actually put something in: on every later start the
    // statements above are all no-ops, and rewriting the whole file for them is
    // pure startup cost. The DDL above does not show up in getRowsModified(),
    // which is what `schemaChanged` is for.
    if (schemaChanged || sqlite.db.getRowsModified() > 0) {
      await sqlite.saveToFile({ skipUpload: true });
    }
  }

  function initializeSyncTables(): void {
    // This device's identity and clock. A row in a table of its own rather than
    // a field of AppState: that one is a JSON blob its callers rebuild whole,
    // and persistIncomingMail already writes `{ lastReceivingTimestamp }` into
    // it - anything else put there would be wiped by the first incoming
    // message. `id` is always '0', as in the `app` table.
    //
    // The decisive reason, though, is that durability comes free here: an
    // ordering token is spent when a change is applied and must reach the disk
    // no later than the phantom that spends it. In one database a single
    // flush() covers the clock stamp, the sync_versions rows and the journal
    // row alike.
    ensureTable('sync_device', `--sql
      CREATE TABLE IF NOT EXISTS sync_device (
      id TEXT PRIMARY KEY,
      appDeviceId TEXT NOT NULL,
      lastSyncClockTs INTEGER NOT NULL,
      otherDeviceSeenId TEXT,
      otherDeviceSeenAt INTEGER
    ) STRICT`);

    // Per-aspect ordering tokens. Rows with tombstonedAt are tombstones: they
    // outlive the entity and keep a late phantom from resurrecting it.
    ensureTable('sync_versions', `--sql
      CREATE TABLE IF NOT EXISTS sync_versions (
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      aspect TEXT NOT NULL,
      ts INTEGER NOT NULL,
      deviceId TEXT NOT NULL,
      tombstonedAt INTEGER,
      PRIMARY KEY (entityType, entityId, aspect)
    ) STRICT`);

    // Journal of outgoing phantoms. No index on purpose: it is read whole
    // (ORDER BY ts, id) and normally holds a handful of rows.
    ensureTable('pending_sync_msgs', `--sql
      CREATE TABLE IF NOT EXISTS pending_sync_msgs (
      id INTEGER PRIMARY KEY,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      aspect TEXT NOT NULL,
      entityCount INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL
    ) STRICT`);

    // Buffer of phantoms that arrived before what they are about. `ts` is a
    // column rather than something parsed out of the payload, because the drain
    // goes by the time of the CHANGE, not of the buffering.
    //
    // targetMsgId NOT NULL: unlike chat.app there is no second kind of waiting
    // here ("waiting for the chat itself to show up") - one point of waiting,
    // one trigger of the drain.
    ensureTable('orphaned_syncs', `--sql
      CREATE TABLE IF NOT EXISTS orphaned_syncs (
      id INTEGER PRIMARY KEY,
      targetMsgId TEXT NOT NULL,
      ts INTEGER NOT NULL,
      rawPayload TEXT NOT NULL,
      bufferedAt INTEGER NOT NULL
    ) STRICT`);
    sqlite.db.exec(`--sql
      CREATE INDEX IF NOT EXISTS idx_orphaned_target ON orphaned_syncs (targetMsgId)`);

    // Deferred removal of a phantom from the shared inbox.
    ensureTable('pending_inbox_removals', `--sql
      CREATE TABLE IF NOT EXISTS pending_inbox_removals (
      msgId TEXT PRIMARY KEY,
      removeAfter INTEGER NOT NULL
    ) STRICT`);
  }

  function loadSyncDeviceRow(): void {
    const [sqlValue] = sqlite.db.exec(GET_SYNC_DEVICE_QUERY, { $id: '0' });
    const row = sqlValue
      ? objectFromQueryExecResult<{
          appDeviceId: string;
          lastSyncClockTs: number;
          otherDeviceSeenId: Nullable<string>;
          otherDeviceSeenAt: Nullable<number>;
        }>(sqlValue)[0]
      : undefined;

    if (row?.appDeviceId) {
      appDeviceId = row.appDeviceId;
      lastSyncClockTs = row.lastSyncClockTs || 0;
      otherDeviceSeenId = row.otherDeviceSeenId || undefined;
      otherDeviceSeenAt = row.otherDeviceSeenAt || undefined;
      return;
    }

    // Once per life of an installation. The deno component has no `ui`
    // capability (see manifest.json), so in practice this is `app-<random20>`;
    // the branch is kept as chat.app has it.
    appDeviceId = `app-${randomIdStr(20)}`;
    writeSyncDeviceRow();
    schemaChanged = true;
  }

  function writeSyncDeviceRow(): void {
    sqlite.db.exec(UPSERT_SYNC_DEVICE_QUERY, {
      $id: '0',
      $appDeviceId: appDeviceId,
      $lastSyncClockTs: lastSyncClockTs,
      $otherDeviceSeenId: otherDeviceSeenId ?? null,
      $otherDeviceSeenAt: otherDeviceSeenAt ?? null,
    });
  }

  function getAppStateRaw(): QueryExecResult | undefined {
    const [sqlValue] = sqlite.db.exec(GET_STATE_QUERY);
    if (isEmpty(sqlValue) || !sqlValue?.values?.length) {
      return undefined;
    }
    return sqlValue;
  }

  function getAppState(): AppState {
    const sqlValue = getAppStateRaw();
    if (!sqlValue) {
      return { lastReceivingTimestamp: 0 };
    }
    return appStateDbValueToAppState(sqlValue);
  }

  async function updateAppState(state: Partial<AppState>, noDiskWrite?: boolean): Promise<void> {
    const sqlQueryParams = appStateValueToSqlInsertParams({ ...getAppState(), ...state });
    sqlite.db.exec(UPSERT_STATE_QUERY, sqlQueryParams as ParamsObject);
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
  }

  function getFolderList(): MailFolder[] {
    const [sqlValue] = sqlite.db.exec(GET_FOLDER_LIST_QUERY);
    if (isEmpty(sqlValue)) {
      return [];
    }
    return folderDbValueToFolderValue(sqlValue);
  }

  async function addFolder(folderData: MailFolder, noDiskWrite?: boolean): Promise<MailFolder[]> {
    const sqlQueryParams = folderValueToSqlInsertParams(folderData);
    sqlite.db.exec(INSERT_FOLDER_QUERY, sqlQueryParams as ParamsObject);
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
    return getFolderList();
  }

  async function upsertFolder(folderData: MailFolder, noDiskWrite?: boolean): Promise<MailFolder[]> {
    const sqlQueryParams = folderValueToSqlInsertParams(folderData);
    sqlite.db.exec(UPSERT_FOLDER_QUERY, sqlQueryParams as ParamsObject);
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
    return getFolderList();
  }

  function getFolderById(folderId: string): MailFolder | undefined {
    return getFolderList().find(({ id }) => id === folderId);
  }

  async function deleteFolder(folderData: MailFolder, noDiskWrite?: boolean): Promise<MailFolder[]> {
    if (!folderData.id) {
      throw new Error('[deleteFolder method]: The folder ID is missing.');
    }
    sqlite.db.exec(DELETE_FOLDER_BY_ID_QUERY, { $id: folderData.id });
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
    return getFolderList();
  }

  function getMessages(): Array<IncomingMessageView | OutgoingMessageView> {
    const [sqlValue] = sqlite.db.exec(GET_MESSAGES_QUERY);
    if (isEmpty(sqlValue)) {
      return [];
    }
    return msgDbValueToMsgValue(sqlValue);
  }

  function getMessageById(msgId: string): Nullable<IncomingMessageView | OutgoingMessageView> {
    if (!msgId) {
      throw new Error('[getMessageById method]: The message ID is missing.');
    }
    const [sqlValue] = sqlite.db.exec(GET_MESSAGE_QUERY_BY_ID, { $msgId: msgId });
    if (isEmpty(sqlValue)) {
      return null;
    }
    const msg = msgDbValueToMsgValue(sqlValue);
    return msg[0];
  }

  async function addMessage(
    msgData: IncomingMessageView | OutgoingMessageView,
    noDiskWrite?: boolean,
  ): Promise<Array<IncomingMessageView | OutgoingMessageView>> {
    if (!msgData.msgId) {
      throw new Error('[addMessage method]: The message ID is missing.');
    }
    const sqlQueryParams = msgValueToSqlInsertParams(msgData);
    sqlite.db.exec(INSERT_MESSAGE_QUERY, sqlQueryParams as ParamsObject);
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
    return getMessages();
  }

  async function updateMessage(
    msgData: IncomingMessageView | OutgoingMessageView,
    noDiskWrite?: boolean,
  ): Promise<Array<IncomingMessageView | OutgoingMessageView>> {
    if (!msgData.msgId) {
      throw new Error('[updateMessage method]: The message ID is missing.');
    }
    const sqlQueryParams = msgValueToSqlInsertParams(msgData);
    sqlite.db.exec(UPSERT_MESSAGE_QUERY, sqlQueryParams as ParamsObject);
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
    return getMessages();
  }

  async function deleteMessageById(
    msgId: string,
    noDiskWrite?: boolean,
  ): Promise<Array<IncomingMessageView | OutgoingMessageView>> {
    if (!msgId) {
      throw new Error('[deleteMessage method]: The message ID is missing.');
    }
    sqlite.db.exec(DELETE_MESSAGE_BY_ID_QUERY, { $msgId: msgId });
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
    return getMessages();
  }

  function getMessagesByThread(threadId: string): Array<IncomingMessageView | OutgoingMessageView> {
    if (!threadId) {
      throw new Error('[getMessagesByThread method]: The thread ID is missing.');
    }
    const [sqlValue] = sqlite.db.exec(GET_MESSAGES_QUERY_BY_THREAD_ID, { $threadId: threadId });
    if (isEmpty(sqlValue)) {
      return [];
    }
    return msgDbValueToMsgValue(sqlValue);
  }

  async function deleteThread(
    threadId: string,
    noDiskWrite?: boolean,
  ): Promise<Array<IncomingMessageView | OutgoingMessageView>> {
    if (!threadId) {
      throw new Error('[getMessagesByThread method]: The thread ID is missing.');
    }
    // Before the messages go, while their ids can still be looked up by thread.
    sqlite.db.exec(DELETE_THUMBNAILS_BY_THREAD_QUERY, { $threadId: threadId });
    sqlite.db.exec(DELETE_THREAD_QUERY, { $threadId: threadId });
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
    return getMessages();
  }

  function getThumbnails(msgId: string): Record<string, string> {
    if (!msgId) {
      throw new Error('[getThumbnails method]: The message ID is missing.');
    }
    const [sqlValue] = sqlite.db.exec(GET_THUMBNAILS_BY_MSG_QUERY, { $msgId: msgId });
    if (isEmpty(sqlValue)) {
      return {};
    }
    return thumbnailsDbValueToRecord(sqlValue);
  }

  async function upsertThumbnail(
    msgId: string,
    fileName: string,
    dataUrl: string,
    noDiskWrite?: boolean,
  ): Promise<void> {
    if (!msgId || !fileName) {
      throw new Error('[upsertThumbnail method]: The message ID or the file name is missing.');
    }
    sqlite.db.exec(UPSERT_THUMBNAIL_QUERY, { $msgId: msgId, $fileName: fileName, $dataUrl: dataUrl });
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
  }

  async function deleteThumbnails(msgId: string, noDiskWrite?: boolean): Promise<void> {
    if (!msgId) {
      throw new Error('[deleteThumbnails method]: The message ID is missing.');
    }
    sqlite.db.exec(DELETE_THUMBNAILS_BY_MSG_QUERY, { $msgId: msgId });
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
  }

  // ===========================================================================
  // Synchronization between the user's own devices
  // ===========================================================================

  function getAppDeviceId(): string {
    return appDeviceId;
  }

  function nextSyncStamp(): number {
    lastSyncClockTs = Math.max(Date.now(), lastSyncClockTs + 1);
    writeSyncDeviceRow();
    writer.scheduleSave();
    return lastSyncClockTs;
  }

  function nextSyncToken(): SyncToken {
    return { ts: nextSyncStamp(), deviceId: appDeviceId };
  }

  function observeSyncStamp(ts: number): void {
    if (ts > lastSyncClockTs) {
      lastSyncClockTs = ts;
      writeSyncDeviceRow();
      writer.scheduleSave();
    }
  }

  function hasSeenOtherDevice(): boolean {
    return !!otherDeviceSeenId;
  }

  /**
   * Records the first phantom from another device of this user.
   *
   * Written once and never updated: the question it answers is "does this user
   * have a second device", and the answer does not change back. Keeping it to
   * the first one also keeps this off the write path - every phantom after it
   * costs a comparison and nothing else.
   */
  async function noteOtherDeviceSeen(deviceId: string): Promise<void> {
    if (otherDeviceSeenId || !deviceId) {
      return;
    }
    otherDeviceSeenId = deviceId;
    otherDeviceSeenAt = Date.now();
    writeSyncDeviceRow();
    writer.scheduleSave();
  }

  function getSyncVersion(
    entityType: SyncEntityType,
    entityId: string,
    aspect: SyncAspect,
  ): SyncVersionDbEntry | undefined {
    const [sqlValue] = sqlite.db.exec(GET_SYNC_VERSION_QUERY, {
      $entityType: entityType,
      $entityId: entityId,
      $aspect: aspect,
    });
    if (!sqlValue) {
      return undefined;
    }
    return objectFromQueryExecResult<SyncVersionDbEntry>(sqlValue)[0];
  }

  /**
   * Synchronous on purpose: queueSyncPhantom() below relies on there being no
   * await between the writes it makes.
   */
  function writeSyncVersion({
    entityType,
    entityId,
    aspect,
    ts,
    deviceId,
    tombstonedAt,
    dropOtherAspects,
  }: SyncVersionWrite): void {
    if (dropOtherAspects) {
      sqlite.db.exec(DELETE_SYNC_VERSIONS_OF_QUERY, {
        $entityType: entityType,
        $entityId: entityId,
      });
    }
    sqlite.db.exec(UPSERT_SYNC_VERSION_QUERY, {
      $entityType: entityType,
      $entityId: entityId,
      $aspect: aspect,
      $ts: ts,
      $deviceId: deviceId,
      $tombstonedAt: tombstonedAt ?? null,
    });
  }

  async function setSyncVersion(
    entityType: SyncEntityType,
    entityId: string,
    aspect: SyncAspect,
    version: SyncToken & { tombstonedAt?: number },
  ): Promise<void> {
    writeSyncVersion({ entityType, entityId, aspect, ...version });
    writer.scheduleSave();
  }

  function getAllSyncVersions(): SyncVersionRow[] {
    const [sqlValue] = sqlite.db.exec(GET_ALL_SYNC_VERSIONS_QUERY);
    return sqlValue ? objectFromQueryExecResult<SyncVersionRow>(sqlValue) : [];
  }

  async function setSyncVersions(versions: SyncVersionWrite[]): Promise<void> {
    if (versions.length === 0) {
      return;
    }
    for (const version of versions) {
      writeSyncVersion(version);
    }
    // Once, after all of them: the batching writer is armed by the call, not by
    // the row, so one save here is thousands of file rewrites saved on a restore.
    writer.scheduleSave();
  }

  async function deleteSyncVersionsOf(entityType: SyncEntityType, entityId: string): Promise<void> {
    sqlite.db.exec(DELETE_SYNC_VERSIONS_OF_QUERY, {
      $entityType: entityType,
      $entityId: entityId,
    });
    writer.scheduleSave();
  }

  async function collectGarbageInSyncVersions(now: number): Promise<number> {
    sqlite.db.exec(GC_SYNC_VERSIONS_QUERY, { $expiresBefore: now - TOMBSTONE_TTL_MS });
    const dropped = sqlite.db.getRowsModified();
    if (dropped > 0) {
      writer.scheduleSave();
    }
    return dropped;
  }

  async function queueSyncPhantom(
    entry: PendingSyncMsgEntry,
    versions?: SyncVersionWrite[],
  ): Promise<void> {
    for (const version of versions ?? []) {
      writeSyncVersion(version);
    }
    sqlite.db.exec(INSERT_PENDING_SYNC_MSG_QUERY, {
      $entityType: entry.entityType,
      $entityId: entry.entityId,
      $aspect: entry.aspect,
      $entityCount: entry.entityCount,
      $ts: entry.ts,
      $payload: entry.payload,
    });
    writer.scheduleSave();
  }

  function getPendingSyncPhantoms(): PendingSyncMsgDbEntry[] {
    const [sqlValue] = sqlite.db.exec(GET_PENDING_SYNC_MSGS_QUERY);
    return sqlValue ? objectFromQueryExecResult<PendingSyncMsgDbEntry>(sqlValue) : [];
  }

  function countRows(query: string): number {
    const [sqlValue] = sqlite.db.exec(query);
    return sqlValue ? objectFromQueryExecResult<{ num: number }>(sqlValue)[0].num : 0;
  }

  function countPendingSyncPhantoms(): number {
    return countRows(COUNT_PENDING_SYNC_MSGS_QUERY);
  }

  async function deletePendingSyncPhantom(id: number): Promise<void> {
    sqlite.db.exec(DELETE_PENDING_SYNC_MSG_QUERY, { $id: id });
    if (sqlite.db.getRowsModified() > 0) {
      writer.scheduleSave();
    }
  }

  /**
   * Counts a failed release attempt. A counter only - a row is never dropped
   * for failing: handing a message to delivery fails when the server cannot be
   * reached, and dropping a phantom then would lose exactly the change this
   * journal exists to keep.
   */
  async function recordPendingSyncPhantomFailure(id: number): Promise<number> {
    sqlite.db.exec(BUMP_PENDING_SYNC_MSG_ATTEMPTS_QUERY, { $id: id });
    if (sqlite.db.getRowsModified() === 0) {
      return 0;
    }
    writer.scheduleSave();
    const [sqlValue] = sqlite.db.exec(GET_PENDING_SYNC_MSG_ATTEMPTS_QUERY, { $id: id });
    return sqlValue ? objectFromQueryExecResult<{ attempts: number }>(sqlValue)[0].attempts : 0;
  }

  async function dropExpiredSyncPhantoms(now: number): Promise<number> {
    sqlite.db.exec(DROP_EXPIRED_PENDING_SYNC_MSGS_QUERY, { $expiresBefore: now - SYNC_WINDOW_MS });
    const dropped = sqlite.db.getRowsModified();
    if (dropped > 0) {
      writer.scheduleSave();
    }
    return dropped;
  }

  async function addOrphanedSync(entry: OrphanedSyncEntry): Promise<void> {
    sqlite.db.exec(INSERT_ORPHANED_SYNC_QUERY, {
      $targetMsgId: entry.targetMsgId,
      $ts: entry.ts,
      $rawPayload: entry.rawPayload,
      $bufferedAt: entry.bufferedAt,
    });
    writer.scheduleSave();
  }

  function getOrphanedSyncsFor(targetMsgId: string): OrphanedSyncDbEntry[] {
    const [sqlValue] = sqlite.db.exec(GET_ORPHANED_SYNCS_FOR_QUERY, { $targetMsgId: targetMsgId });
    return sqlValue ? objectFromQueryExecResult<OrphanedSyncDbEntry>(sqlValue) : [];
  }

  async function deleteOrphanedSync(id: number): Promise<void> {
    sqlite.db.exec(DELETE_ORPHANED_SYNC_QUERY, { $id: id });
    if (sqlite.db.getRowsModified() > 0) {
      writer.scheduleSave();
    }
  }

  function countOrphanedSyncs(): number {
    return countRows(COUNT_ORPHANED_SYNCS_QUERY);
  }

  async function collectGarbageInOrphanedSyncs(now: number): Promise<number> {
    sqlite.db.exec(GC_ORPHANED_SYNCS_QUERY, { $expiresBefore: now - ORPHAN_TTL_MS });
    const dropped = sqlite.db.getRowsModified();
    if (dropped > 0) {
      writer.scheduleSave();
    }
    return dropped;
  }

  async function scheduleInboxMsgRemoval(
    msgId: string,
    noDiskWrite?: boolean,
    delayMs?: number,
  ): Promise<void> {
    if (!msgId) {
      throw new Error('[scheduleInboxMsgRemoval method]: The message ID is missing.');
    }
    sqlite.db.exec(SCHEDULE_INBOX_REMOVAL_QUERY, {
      $msgId: msgId,
      $removeAfter: Date.now() + (delayMs ?? INBOX_REMOVAL_DELAY_MS),
    });
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
  }

  function getExpiredInboxRemovals(now: number): string[] {
    const [sqlValue] = sqlite.db.exec(GET_EXPIRED_INBOX_REMOVALS_QUERY, { $now: now });
    return sqlValue ? objectFromQueryExecResult<{ msgId: string }>(sqlValue).map(r => r.msgId) : [];
  }

  async function dropInboxRemovals(msgIds: string[], noDiskWrite?: boolean): Promise<void> {
    if (msgIds.length === 0) {
      return;
    }
    for (const msgId of msgIds) {
      sqlite.db.exec(DELETE_INBOX_REMOVAL_QUERY, { $msgId: msgId });
    }
    if (!noDiskWrite) {
      writer.scheduleSave();
    }
  }

  function countPendingInboxRemovals(): number {
    return countRows(COUNT_PENDING_INBOX_REMOVALS_QUERY);
  }

  function getCachedBlacklist(): string[] {
    const [sqlValue] = sqlite.db.exec(GET_CONTACT_BLACKLIST_QUERY);
    return sqlValue
      ? objectFromQueryExecResult<{ address: string }>(sqlValue).map(r => r.address)
      : [];
  }

  async function setCachedBlacklist(addresses: string[]): Promise<void> {
    // Replaced whole: the contacts app always announces the list entire, so a
    // merge here would keep an address that has just been unblocked.
    sqlite.db.exec(CLEAR_CONTACT_BLACKLIST_QUERY);
    for (const address of addresses) {
      sqlite.db.exec(INSERT_CONTACT_BLACKLIST_QUERY, { $address: address });
    }
    writer.scheduleSave();
  }

  await initialization();

  return {
    getAppState,
    updateAppState,
    addFolder,
    upsertFolder,
    deleteFolder,
    getFolderList,
    getFolderById,
    addMessage,
    updateMessage,
    deleteMessageById,
    getMessageById,
    getMessages,
    getMessagesByThread,
    deleteThread,
    getThumbnails,
    upsertThumbnail,
    deleteThumbnails,
    flush: () => writer.flush(),

    getAppDeviceId,
    nextSyncStamp,
    nextSyncToken,
    observeSyncStamp,
    hasSeenOtherDevice,
    noteOtherDeviceSeen,

    getSyncVersion,
    setSyncVersion,
    getAllSyncVersions,
    setSyncVersions,
    deleteSyncVersionsOf,
    collectGarbageInSyncVersions,

    queueSyncPhantom,
    getPendingSyncPhantoms,
    countPendingSyncPhantoms,
    deletePendingSyncPhantom,
    recordPendingSyncPhantomFailure,
    dropExpiredSyncPhantoms,

    addOrphanedSync,
    getOrphanedSyncsFor,
    deleteOrphanedSync,
    countOrphanedSyncs,
    collectGarbageInOrphanedSyncs,

    scheduleInboxMsgRemoval,
    getExpiredInboxRemovals,
    dropInboxRemovals,
    countPendingInboxRemovals,
    getCachedBlacklist,
    setCachedBlacklist,

    isRestoreInProgress: () => restoreInProgress,
    setRestoreInProgress: value => {
      restoreInProgress = value;
    },
  };
}
