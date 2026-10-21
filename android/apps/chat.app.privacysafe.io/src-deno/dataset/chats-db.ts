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
import type { ChatIdObj } from '../../types/asmail-msgs.types.ts';
import type {
  ChatDbEntry,
  ChatsDb,
  GroupChatDbEntry,
  GroupChatTableFields,
  OTOChatDbEntry,
  OTOChatTableFields,
} from '../types/index.ts';
import { CHATS_DB_FNAME, CHATS_DB_META_ATTR, DATASET_META_ATTR } from '../../shared-libs/constants/index.ts';
// @deno-types="../../shared-libs/sqlite-on-3nstorage/index.d.ts"
import { SQLiteOn3NStorage } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import { makeDbWriter } from './db-writer.ts';
import { startupStage } from '../utils/startup-progress.ts';
import {
  otoChatTabFields,
  otoChatWhereParamsFor,
  groupChatTabFields,
  groupChatWhereParamsFor,
  ensureAllAdminsAreInMembers,
  isUniqueViolation,
} from './utils.ts';
import { fromQueryResult, queryParamsFrom, forTableInsert, setExprFor, tableColumnNames } from '../utils/for-sqlite.ts';
import { includesAddress, toCanonicalAddress } from '../../shared-libs/address-utils.ts';
import { msgsDb } from './msgs-db.ts';

const queryToCreateChatsDbV3 = [
  `--sql
    CREATE TABLE group_chats (
      chatId TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      members TEXT NOT NULL,
      admins TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastUpdatedAt INTEGER NOT NULL,
      settings TEXT
    ) STRICT
  `,
  `--sql
    CREATE TABLE oto_chats (
      peerCAddr TEXT NOT NULL PRIMARY KEY,
      peerAddr TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastUpdatedAt INTEGER NOT NULL,
      settings TEXT
    ) STRICT
  `,
].join(';\n');

/**
 * Chat names are not unique. Two group chats with the same name - even with the
 * same members - are a normal thing, and a one-to-one chat is identified by the
 * peer's canonical address, not by the name it is displayed under. Schema V2
 * had UNIQUE indexes on `name` in both tables, which made an invitation with an
 * already taken name fail on the recipient's side, i.e. the chat was not
 * created at all.
 *
 * Like the other on-open fix-ups (see doc/02-data-model.md §1.2), this runs on
 * every start: dropping an index touches no rows and cannot fail on existing
 * data, so it needs no version check - the presence of the index itself is the
 * condition.
 *
 * @returns true if legacy indexes were found and dropped, i.e. the file has to
 * be written back.
 */
function dropLegacyChatNameIndexes(sqlite: SQLiteOn3NStorage): boolean {
  const [legacyIndexes] = sqlite.db.exec(
    `--sql
    SELECT name
    FROM sqlite_master
    WHERE type = 'index' AND name IN ('group_chat_name', 'oto_chat_name')`,
  );
  if (!legacyIndexes) {
    return false;
  }
  sqlite.db.exec(
    `--sql
    DROP INDEX IF EXISTS group_chat_name;
    DROP INDEX IF EXISTS oto_chat_name`,
  );
  return true;
}

/**
 * Databases created by app versions <=0.10.x have no settings column in either
 * chats table: it was added only by the 2.1 branch of the old version
 * dispatcher, which ran its ALTERs only on the second 0.10.x start and was
 * removed in 0.11.0 with no replacement. The ALTERs repeat that migrator
 * verbatim, and the DEFAULT is functionally required, not cosmetic: a chat row
 * with NULL settings makes message sending throw
 * (AUTO_DELETE_MESSAGES_BY_ID[settings?.autoDeleteMessages].value in
 * msg-sending.ts), so existing rows must read as autoDeleteMessages '0' (off).
 *
 * The decision goes by PRAGMA, not by the dataset version xattr: the
 * synced-to-local move above copies bytes only, losing xattrs.
 *
 * @returns true if any column was added, i.e. the file has to be written back.
 */
function addLegacyChatSettingsColumns(sqlite: SQLiteOn3NStorage): boolean {
  let migrated = false;
  if (!tableColumnNames(sqlite.db, 'group_chats').includes('settings')) {
    sqlite.db.exec(
      `ALTER TABLE group_chats ADD COLUMN settings TEXT DEFAULT '{"autoDeleteMessages":"0"}'`,
    );
    migrated = true;
  }
  if (!tableColumnNames(sqlite.db, 'oto_chats').includes('settings')) {
    sqlite.db.exec(
      `ALTER TABLE oto_chats ADD COLUMN settings TEXT DEFAULT '{"autoDeleteMessages":"0"}'`,
    );
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
}): Promise<SQLiteOn3NStorage> {
  const chatsDbFile = await fsLocal.writableFile(CHATS_DB_FNAME);

  // On synced storage, and therefore named: see the same three steps in
  // msgs-db.ts for why a start-up hanging here used to be invisible.
  const hasLegacyFileOnSynced = await startupStage(
    'chats-db/legacy-check-on-synced', () => fs.checkFilePresence(CHATS_DB_FNAME), 10000,
  );
  if (hasLegacyFileOnSynced) {
    await startupStage('chats-db/legacy-move', async () => {
      const chatsBdFileData = await fs.readBytes(CHATS_DB_FNAME);
      if (chatsBdFileData) {
        await chatsDbFile.writeBytes(chatsBdFileData);
        await fs.deleteFile(CHATS_DB_FNAME);
      }
    }, 10000);
  }

  const sqlite = await startupStage(
    'chats-db/open', () => SQLiteOn3NStorage.makeAndStart(chatsDbFile), 10000,
  );

  const res = sqlite.db.exec(`PRAGMA table_info(group_chats)`);
  if (res.length === 0) {
    sqlite.db.exec(queryToCreateChatsDbV3);
    await saveLocally(sqlite);
    await chatsDbFile.updateXAttrs({
      set: { [DATASET_META_ATTR]: { datasetVersion: 3, db: CHATS_DB_META_ATTR } },
    });
  } else {
    let dirty = dropLegacyChatNameIndexes(sqlite);
    if (addLegacyChatSettingsColumns(sqlite)) {
      dirty = true;
    }
    if (dirty) {
      await saveLocally(sqlite);
      await chatsDbFile.updateXAttrs({
        set: { [DATASET_META_ATTR]: { datasetVersion: 3, db: CHATS_DB_META_ATTR } },
      });
    }
  }

  return sqlite;
}

export async function chatsDb({
  fs,
  fsLocal,
  msgsBdSrv,
}: {
  fs: web3n.files.WritableFS;
  fsLocal: web3n.files.WritableFS;
  msgsBdSrv: Awaited<ReturnType<typeof msgsDb>>;
}): Promise<ChatsDb> {
  // Schema creation writes immediately - see the matching comment in msgsDb().
  const sqlite = await getSqliteDb({
    fs,
    fsLocal,
    saveLocally: sql => sql.saveToFile({ skipUpload: true }),
  });

  const writer = makeDbWriter(sqlite, 'chats');

  /**
   * Marks the database as needing a write; the write itself is batched, see
   * db-writer.ts.
   */
  function saveLocally() {
    writer.scheduleSave();
    return Promise.resolve();
  }

  async function flush(): Promise<void> {
    await writer.flush();
  }

  function getOTOChat(peerCAddr: string): OTOChatDbEntry | undefined {
    const { whereClause, whereParams } = otoChatWhereParamsFor(peerCAddr);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM oto_chats
      WHERE ${whereClause}`,
      whereParams,
    );
    return sqlValue ? fromQueryResult(sqlValue, otoChatTabFields)[0] : undefined;
  }

  function getGroupChat(chatId: string): GroupChatDbEntry | undefined {
    const { whereClause, whereParams } = groupChatWhereParamsFor(chatId);
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM group_chats
      WHERE ${whereClause}`,
      whereParams,
    );
    return sqlValue ? fromQueryResult(sqlValue, groupChatTabFields)[0] : undefined;
  }

  function findChat({ isGroupChat, chatId }: ChatIdObj): ChatDbEntry | undefined {
    const chat = (isGroupChat ? getGroupChat(chatId) : getOTOChat(chatId)) as ChatDbEntry | undefined;
    if (chat) {
      chat.isGroupChat = isGroupChat;
      chat.lastMsg = msgsBdSrv.getLatestMsgInChat({ isGroupChat, chatId });
      chat.unread = msgsBdSrv.getUnreadMsgsCountIn({ isGroupChat, chatId });
    }
    return chat;
  }

  async function addOneToOneChat(
    params: Omit<OTOChatDbEntry, 'createdAt' | 'lastUpdatedAt' | 'peerCAddr'>,
  ): Promise<OTOChatDbEntry> {
    const peerCAddr = toCanonicalAddress(params.peerAddr);
    const now = Date.now();
    const { insertParams, orderedColumns, orderedValues } = forTableInsert(
      {
        ...params,
        settings: { autoDeleteMessages: '0' },
        peerCAddr,
        createdAt: now,
        lastUpdatedAt: now,
      },
      otoChatTabFields,
    );

    try {
      sqlite.db.exec(
        `--sql
        INSERT INTO oto_chats (${orderedColumns})
        VALUES (${orderedValues})`,
        insertParams,
      );
      await saveLocally();
    } catch (err) {
      if (isUniqueViolation(err as Error, 'peerCAddr')) {
        // If chat with this peer already exists, return it (get-or-create semantics)
        const existing = getOTOChat(peerCAddr);
        if (existing) {
          return existing;
        }
      }
      throw err;
    }

    const chat = getOTOChat(peerCAddr);
    if (chat) {
      return chat;
    } else {
      throw new Error(`Chat entry should've been created`);
    }
  }

  async function addGroupChat(
    chat: Omit<GroupChatDbEntry, 'createdAt' | 'lastUpdatedAt'>,
  ): Promise<GroupChatDbEntry> {
    ensureAllAdminsAreInMembers(chat.admins, chat.members);

    const now = Date.now();
    const { insertParams, orderedColumns, orderedValues } = forTableInsert(
      {
        ...chat,
        settings: { autoDeleteMessages: '0' },
        createdAt: now,
        lastUpdatedAt: now,
      },
      groupChatTabFields,
    );
    try {
      sqlite.db.exec(
        `--sql
        INSERT INTO group_chats (${orderedColumns})
        VALUES (${orderedValues})`,
        insertParams,
      );
      await saveLocally();
    } catch (err) {
      if (isUniqueViolation(err as Error, 'chatId')) {
        // If group chat with this chatId already exists, return it (get-or-create semantics)
        const existing = getGroupChat(chat.chatId);
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
    const res = getGroupChat(chat.chatId);
    if (res) {
      return res;
    } else {
      throw new Error(`Chat entry should've been created`);
    }
  }

  /**
   * Inserts a chat row EXACTLY as given, and says nothing at all if the chat is
   * already there.
   *
   * addOneToOneChat/addGroupChat above cannot serve a restore: both overwrite
   * `settings` with `{autoDeleteMessages: '0'}` and set createdAt and
   * lastUpdatedAt to Date.now(), which for a restore means an archive that says
   * how old a chat is and where it belongs in the list is ignored on the one
   * occasion the answer is not "now". Their get-or-create semantics are wrong
   * here too: a restore that finds the chat present has to go through the
   * per-aspect rules instead, and needs to be told so.
   *
   * ensureAllAdminsAreInMembers() stays: it is the invariant
   * canReceiveRegularMessages() reads, not a normalization of input.
   */
  async function addOTOChatRecord(chat: OTOChatTableFields): Promise<OTOChatDbEntry | undefined> {
    const { insertParams, orderedColumns, orderedValues } = forTableInsert(chat, otoChatTabFields);
    try {
      sqlite.db.exec(
        `--sql
        INSERT INTO oto_chats (${orderedColumns})
        VALUES (${orderedValues})`,
        insertParams,
      );
      await saveLocally();
    } catch (err) {
      if (isUniqueViolation(err as Error, 'peerCAddr')) {
        return undefined;
      }
      throw err;
    }
    return getOTOChat(chat.peerCAddr);
  }

  async function addGroupChatRecord(chat: GroupChatTableFields): Promise<GroupChatDbEntry | undefined> {
    ensureAllAdminsAreInMembers(chat.admins, chat.members);

    const { insertParams, orderedColumns, orderedValues } = forTableInsert(chat, groupChatTabFields);
    try {
      sqlite.db.exec(
        `--sql
        INSERT INTO group_chats (${orderedColumns})
        VALUES (${orderedValues})`,
        insertParams,
      );
      await saveLocally();
    } catch (err) {
      if (isUniqueViolation(err as Error, 'chatId')) {
        return undefined;
      }
      throw err;
    }
    return getGroupChat(chat.chatId);
  }

  async function updateOTOChatRecord(
    peerCAddr: string,
    toUpdate: Partial<OTOChatDbEntry>,
  ): Promise<OTOChatDbEntry | undefined> {
    const updateParams = queryParamsFrom(
      {
        ...toUpdate,
        peerCAddr,
        lastUpdatedAt: Date.now(),
      },
      otoChatTabFields,
    );
    const setExpr = setExprFor<OTOChatDbEntry>(updateParams, ['peerCAddr']);
    sqlite.db.exec(
      `--sql
      UPDATE oto_chats
      SET ${setExpr}
      WHERE peerCAddr = $peerCAddr`,
      updateParams,
    );
    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally();
      return getOTOChat(peerCAddr);
    }
  }

  async function updateGroupChatRecord(
    chatId: string,
    toUpdate: Partial<GroupChatDbEntry>,
  ): Promise<GroupChatDbEntry | undefined> {
    const updateParams = queryParamsFrom(
      {
        ...toUpdate,
        chatId,
        lastUpdatedAt: Date.now(),
      },
      groupChatTabFields,
    );
    const setExpr = setExprFor<GroupChatDbEntry>(updateParams, ['chatId']);
    sqlite.db.exec(
      `--sql
      UPDATE group_chats
      SET ${setExpr}
      WHERE chatId = $chatId`,
      updateParams,
    );
    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally();
      return getGroupChat(chatId);
    }
  }

  function getOTOChatsList(): OTOChatDbEntry[] {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM oto_chats`,
    );
    return sqlValue ? fromQueryResult(sqlValue, otoChatTabFields) : [];
  }

  function getGroupChatsList(): GroupChatDbEntry[] {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT *
      FROM group_chats`,
    );
    return sqlValue ? fromQueryResult(sqlValue, groupChatTabFields) : [];
  }

  function getChatList(): ChatDbEntry[] {
    const otoChats = (getOTOChatsList() as ChatDbEntry[]).map(c => {
      c.isGroupChat = false;
      const { peerCAddr } = c as OTOChatDbEntry;
      c.lastMsg = msgsBdSrv.getLatestMsgInChat({ isGroupChat: false, chatId: peerCAddr });
      c.unread = msgsBdSrv.getUnreadMsgsCountIn({ isGroupChat: false, chatId: peerCAddr });
      return c;
    });

    const groupChats = (getGroupChatsList() as ChatDbEntry[]).map(c => {
      c.isGroupChat = true;
      const { chatId } = c as GroupChatDbEntry;
      c.lastMsg = msgsBdSrv.getLatestMsgInChat({ isGroupChat: true, chatId });
      c.unread = msgsBdSrv.getUnreadMsgsCountIn({ isGroupChat: true, chatId });
      return c;
    });

    return [...otoChats, ...groupChats];
  }

  function getChatsWithParticipant(cAddr: string): ChatIdObj[] {
    const canonAddr = toCanonicalAddress(cAddr);
    const chatIds: ChatIdObj[] = [];

    for (const { peerCAddr } of getOTOChatsList()) {
      // peerCAddr is already canonical - it is the primary key of the table.
      if (peerCAddr === canonAddr) {
        chatIds.push({ isGroupChat: false, chatId: peerCAddr });
      }
    }

    for (const { chatId, members } of getGroupChatsList()) {
      // Members are spelled as they were given, so they need canonicalizing
      // before they can be compared.
      if (includesAddress(Object.keys(members ?? {}), canonAddr)) {
        chatIds.push({ isGroupChat: true, chatId });
      }
    }

    return chatIds;
  }

  async function deleteOTOChat(peerCAddr: string) {
    const { whereClause, whereParams } = otoChatWhereParamsFor(peerCAddr);
    sqlite.db.exec(
      `--sql
      DELETE FROM oto_chats
      WHERE ${whereClause}`,
      whereParams,
    );
    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally();
    }
  }

  async function deleteGroupChat(chatId: string) {
    const { whereClause, whereParams } = groupChatWhereParamsFor(chatId);
    sqlite.db.exec(
      `--sql
      DELETE FROM group_chats
      WHERE ${whereClause}`,
      whereParams,
    );
    if (sqlite.db.getRowsModified() > 0) {
      await saveLocally();
    }
  }

  async function deleteChat(chatId: ChatIdObj) {
    if (chatId.isGroupChat) {
      await deleteGroupChat(chatId.chatId);
    } else {
      await deleteOTOChat(chatId.chatId);
    }

    return msgsBdSrv.deleteMessagesInChat(chatId);
  }

  return {
    flush,
    findChat,
    addOneToOneChat,
    addGroupChat,
    addOTOChatRecord,
    addGroupChatRecord,
    updateOTOChatRecord,
    updateGroupChatRecord,
    getChatList,
    getChatsWithParticipant,
    deleteChat,
  };
}
