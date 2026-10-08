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
// @deno-types="../../shared-libs/sqlite-on-3nstorage/index.d.ts"
import { objectFromQueryExecResult, SQLiteOn3NStorage } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import {
  MSGS_DBS_DIR_NAME,
  MSGS_DB_FNAME_PREFIX,
  DATASET_META_ATTR,
  ORPHANED_MSGS_DBS_DIR_NAME,
  AUXILIARY_DB_META_ATTR,
  MAIN_DB_META_ATTR,
  LIFETIME_DAYS_IN_AUXILIARY_DB,
} from '../../shared-libs/constants/index.ts';
import { msgsOrphanedTabFiels, msgsTabFields, msgWhereParamsFor } from './utils.ts';
import { makeDbWriter } from './db-writer.ts';
import { startupStage } from '../utils/startup-progress.ts';
import type { ChatIdObj, ChatMessageId } from '../../types/asmail-msgs.types.ts';
import type { ChatMessageReaction, MessageStatus, MsgPageCursor } from '../../types/chat.types.ts';
import type { ParamsObject } from '../../shared-libs/sqlite-on-3nstorage/sqljs.d.ts';
import type {
  MsgDbEntry,
  MsgsDb,
  OrphanedMsgDbEntry,
  PendingSyncMsgDbEntry,
  PendingSyncMsgEntry,
  RefsToMsgsDataNoInDB,
  SyncAspect,
  SyncEntityType,
  SyncVersionDbEntry,
  SyncVersionRow,
  SyncVersionWrite,
} from '../types/index.ts';
import {
  andEqualExprFor,
  forTableInsert,
  fromQueryResult,
  queryParamsFrom,
  setExprFor,
  tableColumnNames,
} from '../utils/for-sqlite.ts';

const queryToCreateMsgsTableV2 = `--sql
  CREATE TABLE messages (
    groupChatId TEXT,
    otoPeerCAddr TEXT,
    chatMessageId TEXT NOT NULL,
    isIncomingMsg INTEGER NOT NULL,
    incomingMsgId TEXT,
    groupSender TEXT,
    body TEXT,
    attachments TEXT,
    chatMessageType TEXT NOT NULL,
    relatedMessage TEXT,
    status TEXT,
    timestamp INTEGER NOT NULL,
    removeAfter INTEGER NOT NULL,
    history TEXT,
    reactions TEXT,
    settings TEXT,
    PRIMARY KEY (chatMessageId, groupChatId, otoPeerCAddr)
  ) STRICT
`;

// Executed on every kind of messages table - freshly created, migrated from an
// old schema, or one migrated by the 0.10.x dispatcher, which ran the ALTERs
// but never created the *_lifetime indexes - so every statement must stay
// IF NOT EXISTS, and the batch must run after the removeAfter column exists.
const queryToCreateMsgsIndexes = [
  `--sql
    CREATE INDEX IF NOT EXISTS grchat_id_msg_ts ON messages (
      groupChatId, timestamp	ASC
    )
  `,
  `--sql
    CREATE INDEX IF NOT EXISTS grchat_id_msg_ts_lifetime ON messages (
      groupChatId, timestamp, removeAfter	ASC
    )
  `,
  `--sql
    CREATE INDEX IF NOT EXISTS grchat_msg_statuses ON messages (
      groupChatId, status, isIncomingMsg, chatMessageType
    )
  `,
  `--sql
    CREATE INDEX IF NOT EXISTS oto_peer_msg_ts ON messages (
      otoPeerCAddr, timestamp	ASC
    )
  `,
  `--sql
    CREATE INDEX IF NOT EXISTS oto_peer_msg_ts_lifetime ON messages (
      otoPeerCAddr, timestamp, removeAfter	ASC
    )
  `,
  `--sql
    CREATE INDEX IF NOT EXISTS oto_peer_msg_statuses ON messages (
      otoPeerCAddr, status, isIncomingMsg, chatMessageType
    )
  `,
  `--sql
    CREATE INDEX IF NOT EXISTS msg_direction_ts ON messages (
      isIncomingMsg, timestamp	ASC
    )
  `,
].join(';\n');

const queryToCreateMsgsOrphanedDbV3 = [
  `--sql
    CREATE TABLE orphaned_messages (
      id INTEGER PRIMARY KEY,
      groupChatId TEXT,
      otoPeerCAddr TEXT,
      incomingMsgId TEXT,
      targetMessageId TEXT,
      rawPayload TEXT NOT NULL,
      bufferedAt INTEGER NOT NULL
    ) STRICT
  `,
  `--sql
    CREATE INDEX IF NOT EXISTS idx_orphaned_target ON orphaned_messages(
      targetMessageId
    )
  `,
  `--sql
    CREATE INDEX IF NOT EXISTS idx_orphaned_chat ON orphaned_messages(
      groupChatId, otoPeerCAddr
    )
  `,
].join(';\n');

const queryToCreatePendingInboxRemovalsV1 = `--sql
  CREATE TABLE pending_inbox_removals (
    msgId TEXT PRIMARY KEY,
    removeAfter INTEGER NOT NULL
  ) STRICT
`;

/**
 * Previews of message attachments, kept so that they are not made again.
 *
 * Making one needs the whole file, and an attachment of an incoming message is
 * not on this device until something reads it - so a chat with ten photos in a
 * message pulled all ten from the server on every open, and a video preview
 * costs a full decode on top of that.
 *
 * Lives in the auxiliary database rather than the main one: saveToFile()
 * serializes the whole base and rewrites the file, and the main one (messages,
 * sync_versions, pending_sync_msgs) is written far the most often - data URLs
 * there would be paid for on every one of those writes. This is also where the
 * other locally-rebuildable things already are.
 *
 * The key is (chat, message, file name), not the flat (message, file name)
 * INBOX can use: a chatMessageId is unique only within its chat. The columns
 * are named as in the messages table on purpose, so that msgWhereParamsFor()
 * builds the WHERE clause for them unchanged.
 *
 * No foreign key: PRAGMA foreign_keys is never turned on in this project, so
 * rows are removed by whoever removes the message.
 */
const queryToCreateThumbnailsV1 = `--sql
  CREATE TABLE thumbnails (
    groupChatId TEXT NOT NULL,
    otoPeerCAddr TEXT NOT NULL,
    chatMessageId TEXT NOT NULL,
    fileName TEXT NOT NULL,
    dataUrl TEXT NOT NULL,
    PRIMARY KEY (groupChatId, otoPeerCAddr, chatMessageId, fileName)
  ) STRICT
`;

/**
 * Per-aspect ordering tokens for last-write-wins synchronization between the
 * user's own devices.
 *
 * Kept in a table of its own rather than inside a chat's or a message's
 * settings: a chat's settings are themselves a synchronized aspect, sent
 * wholesale in an 'update:settings' phantom and written wholesale on receipt,
 * so version data stored there would leak into phantoms and be clobbered.
 *
 * Lives in the main database, not the auxiliary one: a version must last as
 * long as the entity it describes, while the auxiliary DB is garbage-collected
 * by age. tombstonedAt is set only for the 'deleted' aspect, whose rows outlive
 * the deleted entity (to keep it from being resurrected) and are the only ones
 * collected by age.
 */
const queryToCreateSyncVersionsV1 = `--sql
  CREATE TABLE sync_versions (
    entityType TEXT NOT NULL,
    entityId TEXT NOT NULL,
    aspect TEXT NOT NULL,
    ts INTEGER NOT NULL,
    deviceId TEXT NOT NULL,
    tombstonedAt INTEGER,
    PRIMARY KEY (entityType, entityId, aspect)
  ) STRICT
`;

/**
 * Journal of outgoing sync phantoms.
 *
 * A change made on this device reaches the user's other devices as a phantom,
 * and the change's ordering token is spent the moment the change is applied. If
 * the phantom is then lost (the component is closed, delivery cannot be
 * reached), nothing re-sends it and the other devices never learn about the
 * change. So the intent to send is written down together with the change, and
 * the actual sending is a separate pass that clears the row once delivery has
 * accepted the message.
 *
 * Lives in the main database, next to sync_versions: the row and the token it
 * belongs to must land in one file write.
 */
const queryToCreatePendingSyncMsgsV1 = `--sql
  CREATE TABLE pending_sync_msgs (
    id INTEGER PRIMARY KEY,
    entityType TEXT NOT NULL,
    entityId TEXT NOT NULL,
    aspect TEXT NOT NULL,
    ts INTEGER NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL
  ) STRICT
`;

const allMsgsIndexNames = [
  'grchat_id_msg_ts',
  'grchat_id_msg_ts_lifetime',
  'grchat_msg_statuses',
  'oto_peer_msg_ts',
  'oto_peer_msg_ts_lifetime',
  'oto_peer_msg_statuses',
  'msg_direction_ts',
];

/**
 * Brings an existing messages table to the current schema. Databases created
 * by app versions <=0.10.x lack the removeAfter and settings columns: they were
 * added only by the 2.1 branch of the old version dispatcher, which itself ran
 * the ALTERs only on the second 0.10.x start and was removed in 0.11.0 with no
 * replacement, so the first query naming removeAfter used to kill the whole
 * component on such profiles.
 *
 * The decision goes by PRAGMA/sqlite_master, not by the dataset version xattr:
 * the synced-to-local move above copies bytes only, losing xattrs. The ALTERs
 * repeat the 2.1 migrator verbatim (nullable removeAfter DEFAULT 0), so a
 * migrated file matches the schema shape already living on 2.1-migrated
 * accounts, keeping two schema shapes in the wild instead of three. The chat
 * settings' counterpart lives in chats-db.ts and MUST keep its DEFAULT there;
 * message settings read safely as NULL (optJsonTransform, `settings?.` reads).
 *
 * @returns true when anything changed, i.e. the file has to be written back.
 * The explicit check matters: DDL does not show in getRowsModified(), and the
 * index batch alone is all no-ops on a healthy database.
 */
function migrateLegacyMsgsTable(sqlite: SQLiteOn3NStorage): boolean {
  const columns = tableColumnNames(sqlite.db, 'messages');
  let migrated = false;
  if (!columns.includes('settings')) {
    sqlite.db.exec(`ALTER TABLE messages ADD COLUMN settings TEXT DEFAULT '{}'`);
    migrated = true;
  }
  if (!columns.includes('removeAfter')) {
    sqlite.db.exec(`ALTER TABLE messages ADD COLUMN removeAfter INTEGER DEFAULT 0`);
    migrated = true;
  }
  // 2.1-migrated databases also run without the *_lifetime indexes: the old
  // dispatcher never created them. Must come after the ALTERs - two of the
  // indexes reference removeAfter.
  const [presentIndexes] = sqlite.db.exec(
    `--sql
    SELECT name
    FROM sqlite_master
    WHERE type = 'index' AND name IN (${allMsgsIndexNames.map(n => `'${n}'`).join(', ')})`,
  );
  if ((presentIndexes?.values.length ?? 0) < allMsgsIndexNames.length) {
    sqlite.db.exec(queryToCreateMsgsIndexes);
    migrated = true;
  }
  return migrated;
}

async function getSqliteDb({
  fs,
  fsLocal,
  saveLocally,
}: {
  fs: web3n.files.WritableFS;
  fsLocal: web3n.files.WritableFS;
  saveLocally: (sql: SQLiteOn3NStorage) => Promise<void>;
}): Promise<{ sqlite: SQLiteOn3NStorage; auxiliarySqlite: SQLiteOn3NStorage }> {
  const msgsDbFileName = `${MSGS_DB_FNAME_PREFIX}0`;
  const msgsDbFilePath = `${MSGS_DBS_DIR_NAME}/${msgsDbFileName}`;

  // These three touch SYNCED storage, and are the calls a start-up is most
  // likely to be stuck in: on the day this logging was written, the platform
  // log was full of fs-sync failures at exactly the times the component went
  // quiet. Each is named so that the log says which one has not returned.
  const hasLegacyFileOnSynced = await startupStage(
    'msgs-db/legacy-check-on-synced', () => fs.checkFilePresence(msgsDbFilePath), 10000,
  );
  if (hasLegacyFileOnSynced) {
    await startupStage('msgs-db/legacy-move', async () => {
      const msgsBdFileData = await fs.readBytes(msgsDbFilePath);
      if (msgsBdFileData) {
        await fsLocal.makeFolder(MSGS_DBS_DIR_NAME);
        await fsLocal.writeBytes(msgsDbFilePath, msgsBdFileData);
        await fs.deleteFile(msgsDbFilePath);
      }
    }, 10000);
  }

  const msgsDbFile = await fsLocal.writableFile(msgsDbFilePath);
  const sqlite = await startupStage(
    'msgs-db/open-main', () => SQLiteOn3NStorage.makeAndStart(msgsDbFile), 10000,
  );

  const res = sqlite.db.exec(`PRAGMA table_info(messages)`);
  if (res.length === 0) {
    sqlite.db.exec(queryToCreateMsgsTableV2);
    sqlite.db.exec(queryToCreateMsgsIndexes);
    await saveLocally(sqlite);
    await msgsDbFile.updateXAttrs({
      set: { [DATASET_META_ATTR]: { datasetVersion: 2, db: MAIN_DB_META_ATTR } },
    });
  } else if (migrateLegacyMsgsTable(sqlite)) {
    await saveLocally(sqlite);
    await msgsDbFile.updateXAttrs({
      set: { [DATASET_META_ATTR]: { datasetVersion: 2, db: MAIN_DB_META_ATTR } },
    });
  }

  const msgsOrphanedDbFile = await fsLocal.writableFile(`${MSGS_DBS_DIR_NAME}/${ORPHANED_MSGS_DBS_DIR_NAME}`);
  const auxiliarySqlite = await startupStage(
    'msgs-db/open-auxiliary', () => SQLiteOn3NStorage.makeAndStart(msgsOrphanedDbFile), 10000,
  );

  if (auxiliarySqlite.db.exec(`PRAGMA table_info(orphaned_messages)`).length > 0) {
    // Schema V2 made every INSERT fail (incomingMsgId/targetMessageId NOT NULL), so a table
    // left over from it is guaranteed to be empty; recreating it loses nothing. Unlike the
    // main tables' migrations, the xattr is a good enough detector here: its worst-case loss
    // only recreates a guaranteed-empty table.
    const meta = (await msgsOrphanedDbFile.getXAttr(DATASET_META_ATTR)) as { datasetVersion?: number } | undefined;
    if (meta?.datasetVersion !== 3) {
      auxiliarySqlite.db.exec(`DROP TABLE orphaned_messages`);
    }
  }

  if (auxiliarySqlite.db.exec(`PRAGMA table_info(orphaned_messages)`).length === 0) {
    auxiliarySqlite.db.exec(queryToCreateMsgsOrphanedDbV3);
    await saveLocally(auxiliarySqlite);
    await msgsOrphanedDbFile.updateXAttrs({
      set: { [DATASET_META_ATTR]: { datasetVersion: 3, db: AUXILIARY_DB_META_ATTR } },
    });
  }

  if (auxiliarySqlite.db.exec(`PRAGMA table_info(pending_inbox_removals)`).length === 0) {
    auxiliarySqlite.db.exec(queryToCreatePendingInboxRemovalsV1);
    await saveLocally(auxiliarySqlite);
  }

  if (sqlite.db.exec(`PRAGMA table_info(sync_versions)`).length === 0) {
    sqlite.db.exec(queryToCreateSyncVersionsV1);
    await saveLocally(sqlite);
  }

  if (sqlite.db.exec(`PRAGMA table_info(pending_sync_msgs)`).length === 0) {
    sqlite.db.exec(queryToCreatePendingSyncMsgsV1);
    await saveLocally(sqlite);
  }

  // No data migration to do: on a profile made before this table existed it is
  // simply created here, and previews are made again as messages are shown.
  if (auxiliarySqlite.db.exec(`PRAGMA table_info(thumbnails)`).length === 0) {
    auxiliarySqlite.db.exec(queryToCreateThumbnailsV1);
    await saveLocally(auxiliarySqlite);
  }

  return {
    sqlite,
    auxiliarySqlite,
  };
}

export async function msgsDb({
  fs,
  fsLocal,
}: {
  fs: web3n.files.WritableFS;
  fsLocal: web3n.files.WritableFS;
}): Promise<MsgsDb> {
  // Schema creation writes immediately: getSqliteDb() sets the dataset version
  // xattr right after, and a file that lags behind its version attribute would
  // read back as "version is there, tables are not".
  const { sqlite, auxiliarySqlite } = await getSqliteDb({
    fs,
    fsLocal,
    saveLocally: sql => sql.saveToFile({ skipUpload: true }),
  });

  const mainWriter = makeDbWriter(sqlite, 'messages');
  const auxiliaryWriter = makeDbWriter(auxiliarySqlite, 'auxiliary messages');

  /**
   * Marks the database of a mutation as needing a write. The write itself is
   * batched - see db-writer.ts, and flush() below for the durability points.
   */
  function saveLocally(sql: SQLiteOn3NStorage) {
    (sql === sqlite ? mainWriter : auxiliaryWriter).scheduleSave();
    return Promise.resolve();
  }

  async function flush(): Promise<void> {
    await Promise.all([mainWriter.flush(), auxiliaryWriter.flush()]);
  }

  async function addMessage(msg: MsgDbEntry) {
    const { insertParams, orderedColumns, orderedValues } = forTableInsert(msg, msgsTabFields);

    sqlite.db.exec(
      `--sql
      INSERT INTO messages (${orderedColumns})
      VALUES (${orderedValues})`,
      insertParams,
    );
    await saveLocally(sqlite);
  }

  async function getMessage(id: ChatMessageId): Promise<MsgDbEntry | undefined> {
    const { whereMsg, whereMsgParams } = msgWhereParamsFor(id);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM messages
      WHERE ${whereMsg}`,
      whereMsgParams,
    );

    if (sqlValue) {
      return fromQueryResult(sqlValue, msgsTabFields)[0];
    }
  }

  /**
   * Whether some message row still points at this inbox message.
   *
   * Only messages with attachments do: for those, `incomingMsgId` is kept and
   * the inbox message stays on the server as the one carrier of the attachment
   * bytes (see handleRegularMsg). Asked before taking anything off the server
   * that was received earlier, so that a message already in the history is not
   * stripped of its files afterwards.
   */
  function isMsgKeptForInboxMsg(incomingMsgId: string): boolean {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT 1
      FROM messages
      WHERE incomingMsgId=$incomingMsgId
      LIMIT 1`,
      { $incomingMsgId: incomingMsgId },
    );
    return !!sqlValue;
  }

  /**
   * Every message row there is, oldest first.
   *
   * Only a backup needs this: everything else reads a chat, or a page of one.
   * Ordered by timestamp so that an archive reads as the history does, and so
   * that a restore inserts a chat's messages in the order they were said.
   */
  function getAllMessages(): MsgDbEntry[] {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM messages
      ORDER BY timestamp ASC`,
    );
    return sqlValue ? fromQueryResult<MsgDbEntry>(sqlValue, msgsTabFields) : [];
  }

  /** The count alone, without reading a single row - for a dialog's summary. */
  function countMessages(): number {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT COUNT(*) AS count
      FROM messages`,
    );
    return sqlValue ? objectFromQueryExecResult<{ count: number }>(sqlValue)[0].count : 0;
  }

  /**
   * How many message rows a chat holds. force-refresh compares it across its
   * pass to tell new messages from re-reads and from update-only system events,
   * which change a row without adding one.
   */
  function countMessagesInChat({ isGroupChat, chatId }: ChatIdObj): number {
    const chatColumn = isGroupChat ? 'groupChatId' : 'otoPeerCAddr';
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT COUNT(*) AS count
      FROM messages
      WHERE ${chatColumn} = $chatId`,
      { $chatId: chatId },
    );
    return sqlValue ? objectFromQueryExecResult<{ count: number }>(sqlValue)[0].count : 0;
  }

  async function getMessagesInOneToOneChat(otoPeerCAddr: string) {
    const whereParams = queryParamsFrom<Pick<MsgDbEntry, 'otoPeerCAddr'>>({ otoPeerCAddr }, msgsTabFields);
    const whereClause = andEqualExprFor(whereParams);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM messages
      WHERE ${whereClause}
      ORDER BY timestamp ASC`,
      whereParams,
    );
    return sqlValue ? fromQueryResult(sqlValue, msgsTabFields) : [];
  }

  async function getMessagesInGroupChat(chatId: string) {
    const whereParams = queryParamsFrom<Pick<MsgDbEntry, 'groupChatId'>>({ groupChatId: chatId }, msgsTabFields);
    const whereClause = andEqualExprFor(whereParams);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM messages
      WHERE ${whereClause}
      ORDER BY timestamp ASC`,
      whereParams,
    );

    return sqlValue ? fromQueryResult(sqlValue, msgsTabFields) : [];
  }

  function getMessagesByChat({ isGroupChat, chatId }: ChatIdObj) {
    return isGroupChat ? getMessagesInGroupChat(chatId) : getMessagesInOneToOneChat(chatId);
  }

  /**
   * Reads the newest `limit` messages of a chat, or the ones right before the
   * cursor. Selection runs from newest to oldest to take the tail of the history
   * without counting it first, and the result is reversed, so that callers get
   * the same ascending order as getMessagesByChat().
   *
   * The cursor compares a (timestamp, chatMessageId) pair rather than the
   * timestamp alone: timestamps come from Date.now() and repeat, and a plain
   * `timestamp < cursor` would drop a message that shares a millisecond with the
   * one on a page boundary.
   */
  function getMessagesPageInChat({ isGroupChat, chatId }: ChatIdObj, limit: number, before?: MsgPageCursor) {
    const chatColumn = isGroupChat ? 'groupChatId' : 'otoPeerCAddr';
    const params: ParamsObject = {
      $chatId: chatId,
      $limit: limit,
    };
    let beforeClause = '';

    if (before) {
      params.$beforeTs = before.timestamp;
      params.$beforeId = before.chatMessageId;
      beforeClause = `AND (
        timestamp < $beforeTs
        OR (timestamp = $beforeTs AND chatMessageId < $beforeId)
      )`;
    }

    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM messages
      WHERE ${chatColumn} = $chatId ${beforeClause}
      ORDER BY timestamp DESC, chatMessageId DESC
      LIMIT $limit`,
      params,
    );

    return sqlValue ? fromQueryResult<MsgDbEntry>(sqlValue, msgsTabFields).reverse() : [];
  }

  function getNotRegularMessagesByChat(chatId: ChatIdObj): MsgDbEntry[] {
    const query = `--sql
    SELECT *, groupChatId || otoPeerCAddr AS chatId
    FROM messages
    WHERE chatId=$chatId AND (chatMessageType='system' OR chatMessageType='invitation')`;

    const [sqlValue] = sqlite.db.exec(query, { $chatId: chatId.chatId });
    const msgs = sqlValue
      ? fromQueryResult<MsgDbEntry & { chatId?: string; maxTS?: number }>(sqlValue, msgsTabFields)
      : null;

    if (!msgs) {
      return [];
    }

    for (const msg of msgs) {
      msg?.chatId && delete msg.chatId;
    }

    return msgs;
  }

  function getMessagesWithSyncingSelfStatus(): MsgDbEntry[] {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM messages
      WHERE status='syncing_self' AND isIncomingMsg=0
      ORDER BY timestamp ASC`,
    );

    return sqlValue ? fromQueryResult(sqlValue, msgsTabFields) : [];
  }

  async function getExpiredMessages(now: number): Promise<MsgDbEntry[]> {
    const query = `--sql
    SELECT *
    FROM messages
    WHERE chatMessageType='regular' AND removeAfter<$now AND removeAfter<>0`;
    const [sqlValue] = sqlite.db.exec(query, { $now: now });
    return sqlValue ? fromQueryResult(sqlValue, msgsTabFields) : [];
  }

  async function deleteMessage(chatMessageId: ChatMessageId) {
    const { whereMsg, whereMsgParams } = msgWhereParamsFor(chatMessageId);
    sqlite.db.exec(
      `--sql
      DELETE
      FROM messages
      WHERE ${whereMsg}`,
      whereMsgParams,
    );
    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally(sqlite);
    }
    // Every single-message deletion there is - one message, a batch, the
    // lifetime sweep, a deletion that arrived from the other side - comes
    // through here, which is why the cached previews are dropped in the
    // database layer rather than in each of those paths.
    await deleteThumbnails(chatMessageId);
  }

  /**
   * Latest message of a chat, or null when the chat has none.
   *
   * ORDER BY + LIMIT rather than MAX(timestamp): a bare aggregate with no
   * GROUP BY always yields exactly one row, so an empty chat used to come back
   * as a row of NULLs instead of null. The GUI then showed a phantom last
   * message with an empty sender for a chat whose history had just been cleared.
   */
  function getLatestMsgInChat({ chatId }: ChatIdObj): MsgDbEntry | null {
    const query = `--sql
      SELECT *, groupChatId || otoPeerCAddr AS chatId
      FROM messages
      WHERE chatId=$chatId
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const [sqlValue] = sqlite.db.exec(query, { $chatId: chatId });
    if (!sqlValue) {
      return null;
    }
    const [msg] = fromQueryResult<MsgDbEntry & { chatId?: string }>(sqlValue, msgsTabFields);
    if (!msg) {
      return null;
    }
    delete msg.chatId;
    return msg;
  }

  function getUnreadMsgsCountIn({ isGroupChat, chatId }: ChatIdObj): number {
    const whereParams = queryParamsFrom<
      Pick<MsgDbEntry, 'groupChatId' | 'otoPeerCAddr' | 'isIncomingMsg' | 'chatMessageType' | 'status'>
    >(
      {
        groupChatId: isGroupChat ? chatId : null,
        otoPeerCAddr: !isGroupChat ? chatId : null,
        isIncomingMsg: true,
        chatMessageType: 'regular',
        status: 'unread',
      },
      msgsTabFields,
    );
    const whereClause = andEqualExprFor(whereParams);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT COUNT(*) AS unread
      FROM messages
      WHERE ${whereClause}`,
      whereParams,
    );

    return sqlValue ? objectFromQueryExecResult<{ unread: number }>(sqlValue)[0].unread : 0;
  }

  function getLatestIncomingMsgTimestamp(): number | undefined {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT max(timestamp) as maxTS
      FROM messages
      WHERE isIncomingMsg = 1`,
    );
    if (!sqlValue) {
      return;
    }

    const { maxTS } = objectFromQueryExecResult<{ maxTS: number | null }>(sqlValue)[0];

    return maxTS === null ? undefined : maxTS;
  }

  /**
   * Latest incoming message of a chat, for the force-refresh scan: the scan
   * lists the shared inbox from this deliveryTS onwards, and incoming records
   * keep the delivery timestamp as their own (see handleRegularMsg), so this is
   * the exact floor the inbox listing understands.
   */
  function getLatestIncomingMsgTimestampInChat({ isGroupChat, chatId }: ChatIdObj): number | undefined {
    const chatColumn = isGroupChat ? 'groupChatId' : 'otoPeerCAddr';
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT max(timestamp) as maxTS
      FROM messages
      WHERE isIncomingMsg = 1 AND ${chatColumn} = $chatId`,
      { $chatId: chatId },
    );
    if (!sqlValue) { return; }

    const { maxTS } = objectFromQueryExecResult<{ maxTS: number | null }>(sqlValue)[0];

    return maxTS === null ? undefined : maxTS;
  }

  async function getRecentReactions(quantity: number): Promise<string[]> {
    const sqlQuery = `--sql
      SELECT *
      FROM messages
      WHERE chatMessageType='regular' AND reactions IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ${quantity * 4}`;

    const [sqlValue] = sqlite.db.exec(sqlQuery);

    if (!sqlValue) {
      return [];
    }

    const ownAddr = await w3n.mail?.getUserId();

    const messages = sqlValue ? fromQueryResult(sqlValue, msgsTabFields) : [];
    const result = [] as string[];
    for (const msg of messages) {
      const { reactions } = msg;
      const reaction = (reactions as Record<string, ChatMessageReaction>)[ownAddr!];
      if (reaction && !result.includes(reaction.name)) {
        result.unshift(reaction.name);
      }
    }

    return result.splice(0, quantity);
  }

  async function getInboxMsgsOfOTOChat(otoPeerCAddr: string): Promise<string[]> {
    const whereParams = queryParamsFrom<Pick<MsgDbEntry, 'otoPeerCAddr' | 'isIncomingMsg'>>(
      { otoPeerCAddr, isIncomingMsg: true },
      msgsTabFields,
    );
    const whereClause = andEqualExprFor(whereParams);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT incomingMsgId
      FROM messages
      WHERE ${whereClause} AND incomingMsgId IS NOT NULL`,
      whereParams,
    );

    return sqlValue ? fromQueryResult(sqlValue, msgsTabFields).map(r => r.incomingMsgId!) : [];
  }

  async function getInboxMsgsOfGroupChat(groupChatId: string): Promise<string[]> {
    const whereParams = queryParamsFrom<Pick<MsgDbEntry, 'groupChatId' | 'isIncomingMsg'>>(
      { groupChatId, isIncomingMsg: true },
      msgsTabFields,
    );
    const whereClause = andEqualExprFor(whereParams);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT incomingMsgId
      FROM messages
      WHERE ${whereClause} AND incomingMsgId IS NOT NULL`,
      whereParams,
    );
    return sqlValue ? fromQueryResult(sqlValue, msgsTabFields).map(r => r.incomingMsgId!) : [];
  }

  async function getAllOutgoingMsgAttachmentsInGroupChat(
    groupChatId: string,
  ): Promise<RefsToMsgsDataNoInDB['outgoingMsgs']> {
    const whereParams = queryParamsFrom<Pick<MsgDbEntry, 'groupChatId' | 'isIncomingMsg'>>(
      { groupChatId, isIncomingMsg: false },
      msgsTabFields,
    );
    const whereClause = andEqualExprFor(whereParams);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT chatMessageId, attachments
      FROM messages
      WHERE ${whereClause} AND attachments IS NOT NULL`,
      whereParams,
    );

    return sqlValue
      ? fromQueryResult(sqlValue, msgsTabFields).map(r => ({
          chatMsgId: r.chatMessageId,
          attachments: r.attachments!,
        }))
      : [];
  }

  async function getAllOutgoingMsgAttachmentsInOTOChat(
    otoPeerCAddr: string,
  ): Promise<RefsToMsgsDataNoInDB['outgoingMsgs']> {
    const whereParams = queryParamsFrom<Pick<MsgDbEntry, 'otoPeerCAddr' | 'isIncomingMsg'>>(
      { otoPeerCAddr, isIncomingMsg: false },
      msgsTabFields,
    );
    const whereClause = andEqualExprFor(whereParams);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT chatMessageId, attachments
      FROM messages
      WHERE ${whereClause} AND attachments IS NOT NULL`,
      whereParams,
    );

    return sqlValue
      ? fromQueryResult(sqlValue, msgsTabFields).map(r => ({
          chatMsgId: r.chatMessageId,
          attachments: r.attachments!,
        }))
      : [];
  }

  async function msgsInInboxAndOutgoingAttachmentsInGroupChat(chatId: string): Promise<RefsToMsgsDataNoInDB> {
    const inboxMsgs = await getInboxMsgsOfGroupChat(chatId);
    const outgoingMsgs = await getAllOutgoingMsgAttachmentsInGroupChat(chatId);
    return { inboxMsgs, outgoingMsgs };
  }

  async function msgsInInboxAndOutgoingAttachmentsInOTOChat(otoPeerCAddr: string): Promise<RefsToMsgsDataNoInDB> {
    const inboxMsgs = await getInboxMsgsOfOTOChat(otoPeerCAddr);
    const outgoingMsgs = await getAllOutgoingMsgAttachmentsInOTOChat(otoPeerCAddr);

    return { inboxMsgs, outgoingMsgs };
  }

  async function deleteMessagesInOneToOneChat(otoPeerCAddr: string): Promise<boolean> {
    const whereGroupParams = queryParamsFrom<Pick<MsgDbEntry, 'otoPeerCAddr'>>({ otoPeerCAddr }, msgsTabFields);
    const whereGroup = andEqualExprFor(whereGroupParams);
    sqlite.db.exec(
      `--sql
      DELETE
      FROM messages
      WHERE ${whereGroup}`,
      whereGroupParams,
    );
    const msgsDeleted = sqlite.db.getRowsModified() > 0;

    // The mass delete goes around removeMsgBytes, hence around deleteMessage:
    // this is the second, and last, point where cached previews are dropped.
    await deleteThumbnailsWhere(whereGroup, whereGroupParams);

    return msgsDeleted;
  }

  async function deleteMessagesInGroupChat(groupChatId: string): Promise<boolean> {
    const whereGroupParams = queryParamsFrom<Pick<MsgDbEntry, 'groupChatId'>>({ groupChatId }, msgsTabFields);
    const whereGroup = andEqualExprFor(whereGroupParams);
    sqlite.db.exec(
      `--sql
      DELETE
      FROM messages
      WHERE ${whereGroup}`,
      whereGroupParams,
    );
    const msgsDeleted = sqlite.db.getRowsModified() > 0;

    await deleteThumbnailsWhere(whereGroup, whereGroupParams);

    return msgsDeleted;
  }

  async function deleteMessagesInChat({
    isGroupChat,
    chatId,
  }: ChatIdObj): Promise<RefsToMsgsDataNoInDB | undefined> {
    const dataNotInDB = isGroupChat
      ? await msgsInInboxAndOutgoingAttachmentsInGroupChat(chatId)
      : await msgsInInboxAndOutgoingAttachmentsInOTOChat(chatId);

    const dbUpdated = isGroupChat
      ? await deleteMessagesInGroupChat(chatId)
      : await deleteMessagesInOneToOneChat(chatId);

    if (dbUpdated) {
      await saveLocally(sqlite);
      return dataNotInDB;
    }
  }

  async function updateMessageRecord(
    chatMessageId: ChatMessageId,
    toUpdate: Partial<MsgDbEntry>,
  ): Promise<MsgDbEntry | undefined> {
    const { whereMsg, whereMsgParams } = msgWhereParamsFor(chatMessageId);
    const updateParams = queryParamsFrom(toUpdate, msgsTabFields);
    const setExpr = setExprFor<MsgDbEntry>(updateParams, ['groupChatId', 'otoPeerCAddr', 'chatMessageId']);
    sqlite.db.exec(
      `--sql
      UPDATE messages
      SET ${setExpr}
      WHERE ${whereMsg}`,
      {
        ...updateParams,
        ...whereMsgParams,
      },
    );

    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally(sqlite);
      return await getMessage(chatMessageId);
    }
  }

  async function updateMessageStatus(
    chatMessageId: ChatMessageId,
    status: MessageStatus,
  ): Promise<MsgDbEntry | undefined> {
    const { whereMsg, whereMsgParams } = msgWhereParamsFor(chatMessageId);
    const updateParams = queryParamsFrom({ status }, msgsTabFields);
    const setExpr = setExprFor<MsgDbEntry>(updateParams, []);
    sqlite.db.exec(
      `--sql
      UPDATE messages
      SET ${setExpr}
      WHERE ${whereMsg}`,
      {
        ...updateParams,
        ...whereMsgParams,
      },
    );

    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally(sqlite);
      return await getMessage(chatMessageId);
    }
  }

  /* block for working with "phantom" incoming messages */
  async function addOrphanedMessage(data: OrphanedMsgDbEntry) {
    const { insertParams, orderedColumns, orderedValues } = forTableInsert(
      {
        ...data,
        bufferedAt: Date.now(),
      },
      msgsOrphanedTabFiels,
    );

    auxiliarySqlite.db.exec(
      `--sql
      INSERT INTO orphaned_messages (${orderedColumns})
      VALUES (${orderedValues})`,
      insertParams,
    );
    await saveLocally(auxiliarySqlite);
  }

  function getStuckMessagesForTargetMessageId(targetMessageId: string): (OrphanedMsgDbEntry & { id: number })[] {
    const [sqlValue] = auxiliarySqlite.db.exec(
      `--sql
      SELECT *
      FROM orphaned_messages
      WHERE targetMessageId=$targetMessageId
      ORDER BY bufferedAt ASC`,
      { $targetMessageId: targetMessageId },
    );

    return sqlValue
      ? (fromQueryResult(sqlValue, msgsOrphanedTabFiels) as (OrphanedMsgDbEntry & { id: number })[])
      : [];
  }

  function getStuckMessagesWithoutTarget(chatId: ChatIdObj): (OrphanedMsgDbEntry & { id: number })[] {
    const whereParams = queryParamsFrom<Pick<OrphanedMsgDbEntry, 'groupChatId' | 'otoPeerCAddr'>>(
      {
        groupChatId: chatId.isGroupChat ? chatId.chatId : null,
        otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
      },
      msgsOrphanedTabFiels,
    );
    const whereClause = andEqualExprFor(whereParams);
    const [sqlValue] = auxiliarySqlite.db.exec(
      `--sql
      SELECT *
      FROM orphaned_messages
      WHERE ${whereClause} AND targetMessageId IS NULL
      ORDER BY bufferedAt ASC`,
      whereParams,
    );

    return sqlValue
      ? (fromQueryResult(sqlValue, msgsOrphanedTabFiels) as (OrphanedMsgDbEntry & { id: number })[])
      : [];
  }

  /**
   * Distinct (chat, message) targets that buffered phantoms are waiting for.
   * This is the work-list of the start-up resync pass: each row is a record
   * some other device has and this one lost, worth asking for again.
   */
  function getStuckOrphanTargets(): { chatId: ChatIdObj; targetMessageId: string }[] {
    const [sqlValue] = auxiliarySqlite.db.exec(
      `--sql
      SELECT DISTINCT groupChatId, otoPeerCAddr, targetMessageId
      FROM orphaned_messages
      WHERE targetMessageId IS NOT NULL`,
    );

    if (!sqlValue) {
      return [];
    }

    type TargetRow = { groupChatId: string | null; otoPeerCAddr: string | null; targetMessageId: string };
    return objectFromQueryExecResult<TargetRow>(sqlValue).map(
      ({ groupChatId, otoPeerCAddr, targetMessageId }: TargetRow) => ({
        chatId: groupChatId
          ? { isGroupChat: true, chatId: groupChatId }
          : { isGroupChat: false, chatId: otoPeerCAddr! },
        targetMessageId,
      }),
    );
  }

  /**
   * How many phantoms wait in the buffer for a chat or a record to appear.
   * Part of the startup diagnostics line: a number that stays high means this
   * device keeps receiving changes whose subject it never gets.
   */
  function countOrphanedSyncs(): number {
    const [sqlValue] = auxiliarySqlite.db.exec(
      `--sql
      SELECT COUNT(*) AS num
      FROM orphaned_messages`,
    );

    return sqlValue ? objectFromQueryExecResult<{ num: number }>(sqlValue)[0].num : 0;
  }

  async function deleteOrphanedMessage(id: number) {
    auxiliarySqlite.db.exec(
      `--sql
      DELETE FROM orphaned_messages
      WHERE id=$id`,
      { $id: id },
    );

    if (auxiliarySqlite.db.getRowsModified() > 0) {
      await saveLocally(auxiliarySqlite);
    }
  }

  async function collectGarbageInAuxiliaryDB() {
    const expirationTimestamp = Date.now() - LIFETIME_DAYS_IN_AUXILIARY_DB;
    auxiliarySqlite.db.exec(
      `--sql
      DELETE FROM orphaned_messages
      WHERE bufferedAt < $expirationTimestamp`,
      { $expirationTimestamp: expirationTimestamp },
    );

    if (auxiliarySqlite.db.getRowsModified() > 0) {
      await saveLocally(auxiliarySqlite);
    }
  }

  /* block for scheduling deferred removal of inbox messages (ASMail inbox is
     shared across a user's own devices, so an inbox message can't be removed
     as soon as one device is done with it) */
  async function scheduleInboxMsgRemoval(msgId: string) {
    const removeAfter = Date.now() + LIFETIME_DAYS_IN_AUXILIARY_DB;
    auxiliarySqlite.db.exec(
      `--sql
      INSERT OR REPLACE INTO pending_inbox_removals (msgId, removeAfter)
      VALUES ($msgId, $removeAfter)`,
      { $msgId: msgId, $removeAfter: removeAfter },
    );
    await saveLocally(auxiliarySqlite);
  }

  function getDueInboxMsgRemovals(now: number): string[] {
    const [sqlValue] = auxiliarySqlite.db.exec(
      `--sql
      SELECT msgId
      FROM pending_inbox_removals
      WHERE removeAfter < $now`,
      { $now: now },
    );

    return sqlValue
      ? objectFromQueryExecResult<{ msgId: string }>(sqlValue).map((r: { msgId: string }) => r.msgId)
      : [];
  }

  async function clearInboxMsgRemovals(msgIds: string[]) {
    if (msgIds.length === 0) {
      return;
    }

    for (const msgId of msgIds) {
      auxiliarySqlite.db.exec(
        `--sql
        DELETE FROM pending_inbox_removals
        WHERE msgId=$msgId`,
        { $msgId: msgId },
      );
    }

    await saveLocally(auxiliarySqlite);
  }

  /* block for cached previews of message attachments */

  /**
   * Previews of this message's attachments that have already been made, by file
   * name. Synchronous: the read goes to the in-memory sql.js base.
   */
  function getThumbnails(id: ChatMessageId): Record<string, string> {
    const { whereMsg, whereMsgParams } = msgWhereParamsFor(id);
    const [sqlValue] = auxiliarySqlite.db.exec(
      `--sql
      SELECT fileName, dataUrl
      FROM thumbnails
      WHERE ${whereMsg}`,
      whereMsgParams,
    );

    if (!sqlValue) {
      return {};
    }

    const byFileName: Record<string, string> = {};
    for (const row of objectFromQueryExecResult<{ fileName: string; dataUrl: string }>(sqlValue)) {
      byFileName[row.fileName] = row.dataUrl;
    }
    return byFileName;
  }

  async function upsertThumbnail(id: ChatMessageId, fileName: string, dataUrl: string): Promise<void> {
    const { whereMsgParams } = msgWhereParamsFor(id);
    auxiliarySqlite.db.exec(
      `--sql
      INSERT INTO thumbnails (groupChatId, otoPeerCAddr, chatMessageId, fileName, dataUrl)
      VALUES ($groupChatId, $otoPeerCAddr, $chatMessageId, $fileName, $dataUrl)
      ON CONFLICT(groupChatId, otoPeerCAddr, chatMessageId, fileName) DO UPDATE
      SET dataUrl=$dataUrl`,
      { ...whereMsgParams, $fileName: fileName, $dataUrl: dataUrl },
    );
    await saveLocally(auxiliarySqlite);
  }

  async function deleteThumbnails(id: ChatMessageId): Promise<void> {
    const { whereMsg, whereMsgParams } = msgWhereParamsFor(id);
    await deleteThumbnailsWhere(whereMsg, whereMsgParams);
  }

  /**
   * Rows matching a WHERE built over the same column names the messages table
   * uses - one message, or every message of a chat.
   */
  async function deleteThumbnailsWhere(where: string, whereParams: ParamsObject): Promise<void> {
    auxiliarySqlite.db.exec(
      `--sql
      DELETE FROM thumbnails
      WHERE ${where}`,
      whereParams,
    );

    if (auxiliarySqlite.db.getRowsModified() > 0) {
      await saveLocally(auxiliarySqlite);
    }
  }

  /* block for per-aspect synchronization versions (last-write-wins ordering
     of changes made on the user's own devices) */
  function getSyncVersion(
    entityType: SyncEntityType,
    entityId: string,
    aspect: SyncAspect,
  ): SyncVersionDbEntry | undefined {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT ts, deviceId, tombstonedAt
      FROM sync_versions
      WHERE entityType=$entityType AND entityId=$entityId AND aspect=$aspect`,
      { $entityType: entityType, $entityId: entityId, $aspect: aspect },
    );

    if (!sqlValue) {
      return;
    }
    return objectFromQueryExecResult<SyncVersionDbEntry>(sqlValue)[0];
  }

  async function setSyncVersion(
    entityType: SyncEntityType,
    entityId: string,
    aspect: SyncAspect,
    { ts, deviceId, tombstonedAt }: { ts: number; deviceId: string; tombstonedAt?: number },
  ): Promise<void> {
    sqlite.db.exec(
      `--sql
      INSERT OR REPLACE INTO sync_versions (
        entityType, entityId, aspect, ts, deviceId, tombstonedAt
      ) VALUES ($entityType, $entityId, $aspect, $ts, $deviceId, $tombstonedAt)`,
      {
        $entityType: entityType,
        $entityId: entityId,
        $aspect: aspect,
        $ts: ts,
        $deviceId: deviceId,
        $tombstonedAt: tombstonedAt ?? null,
      },
    );
    await saveLocally(sqlite);
  }

  /**
   * Every row of sync_versions, tombstones included.
   *
   * Only a backup needs this too: the LWW code reads one (entity, aspect) at a
   * time, and tombstones it reads only through isDeletedLaterThan(). An archive
   * has to carry them all, because the tokens are what let a restore be
   * expressed in the merge rules that already exist rather than in rules of its
   * own.
   */
  function getAllSyncVersions(): SyncVersionRow[] {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT entityType, entityId, aspect, ts, deviceId, tombstonedAt
      FROM sync_versions`,
    );
    return sqlValue ? objectFromQueryExecResult<SyncVersionRow>(sqlValue) : [];
  }

  /**
   * Writes a batch of sync versions, with a single file write for the lot.
   *
   * A restore records a token per aspect per entity, which through
   * setSyncVersion() would be one scheduled write of the whole database per
   * row. writeSyncVersion() below is the same rule this uses, so a batched
   * write and a single one cannot drift apart.
   */
  async function setSyncVersions(writes: SyncVersionWrite[]): Promise<void> {
    if (writes.length === 0) {
      return;
    }
    for (const write of writes) {
      writeSyncVersion(write);
    }
    await saveLocally(sqlite);
  }

  /**
   * Drops versions of an entity, except its tombstones: the whole point of a
   * tombstone is to outlive the entity and keep a late phantom from
   * resurrecting it.
   */
  async function deleteSyncVersionsOf(entityType: SyncEntityType, entityId: string): Promise<void> {
    sqlite.db.exec(
      `--sql
      DELETE FROM sync_versions
      WHERE entityType=$entityType AND entityId=$entityId AND tombstonedAt IS NULL`,
      { $entityType: entityType, $entityId: entityId },
    );
    await saveLocally(sqlite);
  }

  /* block for the journal of outgoing sync phantoms (see
     queryToCreatePendingSyncMsgsV1 above) */

  /**
   * Writes a sync version, and, for a tombstone, drops the entity's other
   * aspect versions first - same rule as recordDeletion() in sync-versions.ts.
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
      sqlite.db.exec(
        `--sql
        DELETE FROM sync_versions
        WHERE entityType=$entityType AND entityId=$entityId AND tombstonedAt IS NULL`,
        { $entityType: entityType, $entityId: entityId },
      );
    }
    sqlite.db.exec(
      `--sql
      INSERT OR REPLACE INTO sync_versions (
        entityType, entityId, aspect, ts, deviceId, tombstonedAt
      ) VALUES ($entityType, $entityId, $aspect, $ts, $deviceId, $tombstonedAt)`,
      {
        $entityType: entityType,
        $entityId: entityId,
        $aspect: aspect,
        $ts: ts,
        $deviceId: deviceId,
        $tombstonedAt: tombstonedAt ?? null,
      },
    );
  }

  async function queueSyncPhantom(entry: PendingSyncMsgEntry, versions?: SyncVersionWrite[]): Promise<void> {
    for (const version of versions ?? []) {
      writeSyncVersion(version);
    }
    sqlite.db.exec(
      `--sql
      INSERT INTO pending_sync_msgs (entityType, entityId, aspect, ts, payload, attempts)
      VALUES ($entityType, $entityId, $aspect, $ts, $payload, 0)`,
      {
        $entityType: entry.entityType,
        $entityId: entry.entityId,
        $aspect: entry.aspect,
        $ts: entry.ts,
        $payload: entry.payload,
      },
    );
    await saveLocally(sqlite);
  }

  function getPendingSyncPhantoms(): PendingSyncMsgDbEntry[] {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT id, entityType, entityId, aspect, ts, payload, attempts
      FROM pending_sync_msgs
      ORDER BY ts ASC, id ASC`,
    );

    return sqlValue ? objectFromQueryExecResult<PendingSyncMsgDbEntry>(sqlValue) : [];
  }

  /**
   * Same number as getPendingSyncPhantoms().length, without reading the
   * payloads: this one is polled (by the sync activity tracker), and pulling
   * every phantom's JSON body a few times a second is not what the journal is
   * for.
   */
  function countPendingSyncPhantoms(): number {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT COUNT(*) AS num
      FROM pending_sync_msgs`,
    );

    return sqlValue ? objectFromQueryExecResult<{ num: number }>(sqlValue)[0].num : 0;
  }

  async function deletePendingSyncPhantom(id: number): Promise<void> {
    sqlite.db.exec(
      `--sql
      DELETE FROM pending_sync_msgs
      WHERE id=$id`,
      { $id: id },
    );

    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally(sqlite);
    }
  }

  /**
   * Counts a failed release attempt. A counter only - a row is never dropped
   * for failing: handing a message to delivery fails when the server cannot be
   * reached, and dropping a phantom then would lose exactly the change this
   * journal exists to keep. Rows leave by being delivered, or by aging out
   * (see dropExpiredSyncPhantoms).
   */
  async function recordPendingSyncPhantomFailure(id: number): Promise<number> {
    sqlite.db.exec(
      `--sql
      UPDATE pending_sync_msgs
      SET attempts = attempts + 1
      WHERE id=$id`,
      { $id: id },
    );
    await saveLocally(sqlite);

    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT attempts
      FROM pending_sync_msgs
      WHERE id=$id`,
      { $id: id },
    );

    return sqlValue ? objectFromQueryExecResult<{ attempts: number }>(sqlValue)[0].attempts : 0;
  }

  /**
   * Drops phantoms of changes older than the synchronization window, returning
   * how many went.
   *
   * A device that was offline for longer than the window cannot announce its
   * change usefully any more: the receiving devices collect tombstones and
   * buffered phantoms by the same age, so such a phantom would be ignored - or
   * worse, applied against state that has since moved on. This is also what
   * keeps a payload that delivery refuses for good from holding the head of the
   * queue forever.
   */
  async function dropExpiredSyncPhantoms(now: number): Promise<number> {
    const expirationTimestamp = now - LIFETIME_DAYS_IN_AUXILIARY_DB;
    sqlite.db.exec(
      `--sql
      DELETE FROM pending_sync_msgs
      WHERE ts < $expirationTimestamp`,
      { $expirationTimestamp: expirationTimestamp },
    );

    const dropped = sqlite.db.getRowsModified();
    if (dropped > 0) {
      await saveLocally(sqlite);
    }
    return dropped;
  }

  async function collectGarbageInSyncVersions(now: number): Promise<void> {
    const expirationTimestamp = now - LIFETIME_DAYS_IN_AUXILIARY_DB;
    sqlite.db.exec(
      `--sql
      DELETE FROM sync_versions
      WHERE tombstonedAt IS NOT NULL AND tombstonedAt < $expirationTimestamp`,
      { $expirationTimestamp: expirationTimestamp },
    );

    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally(sqlite);
    }
  }

  return {
    flush,
    addMessage,
    getMessage,
    isMsgKeptForInboxMsg,
    getAllMessages,
    countMessages,
    countMessagesInChat,
    getExpiredMessages,
    getMessagesByChat,
    getMessagesPageInChat,
    getNotRegularMessagesByChat,
    getMessagesWithSyncingSelfStatus,
    getLatestIncomingMsgTimestamp,
    getLatestIncomingMsgTimestampInChat,
    getLatestMsgInChat,
    getUnreadMsgsCountIn,
    getRecentReactions,
    deleteMessage,
    deleteMessagesInChat,
    updateMessageRecord,
    updateMessageStatus,

    addOrphanedMessage,
    getStuckMessagesForTargetMessageId,
    getStuckMessagesWithoutTarget,
    getStuckOrphanTargets,
    countOrphanedSyncs,
    deleteOrphanedMessage,
    collectGarbageInAuxiliaryDB,

    scheduleInboxMsgRemoval,
    getDueInboxMsgRemovals,
    clearInboxMsgRemovals,

    getThumbnails,
    upsertThumbnail,
    deleteThumbnails,

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
  };
}
