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
// Pure rules of backup and restore: what an archive holds, what it leaves out,
// which local entities a `replace` says are gone, and how a snapshot is cut
// into phantoms. No `w3n`, no sqlite, no fflate - so all of it can be tested on
// its own, which is how the tables of §10 are checked.
import type { ChatIdObj, ChatMessageId } from '../../../types/asmail-msgs.types.ts';
import type { ChatMessageAttachmentsInfo } from '../../../types/chat.types.ts';
import type {
  BackedUpChat,
  BackedUpChatRecord,
  BackedUpMsg,
  BackedUpMsgRecord,
  BackedUpSyncToken,
  BackedUpTombstone,
  PlannedAttachment,
  SkippedAttachment,
  SnapshotChatEntry,
  SnapshotDeletions,
  SnapshotMsgEntry,
} from '../../../types/backup.types.ts';
import type {
  ChatDbEntry,
  GroupChatDbEntry,
  MsgDbEntry,
  OTOChatDbEntry,
  SyncAspect,
  SyncVersionRow,
} from '../../types/index.ts';
import { attachmentBlobName } from '../../../shared-libs/backup-archive.ts';
import { RESTORE_SNAPSHOT_CHUNK_BYTES } from '../../../shared-libs/constants/backup.ts';
import { chatIdToString } from '../../../shared-libs/chat-ids.ts';

export type AspectTokens = Partial<Record<SyncAspect, BackedUpSyncToken>>;

export interface GroupedSyncVersions {
  /** entityId -> aspect -> token, for live (non-tombstone) versions. */
  chats: Map<string, AspectTokens>;
  msgs: Map<string, AspectTokens>;
  /** Rows that outlive what they describe: 'deleted' and 'historyCleared'. */
  tombstones: BackedUpTombstone[];
}

/**
 * Sorts the whole of sync_versions into what an archive carries.
 *
 * A tombstone row is told apart by `tombstonedAt`, not by its aspect: that
 * column is what the garbage collector goes by, so it is also the definition of
 * "a row that outlives its entity". `historyCleared` is such a row while not
 * being a tombstone of anything - the chat lives on - which is why the archived
 * form names the aspect explicitly.
 */
export function groupSyncVersions(rows: SyncVersionRow[]): GroupedSyncVersions {
  const res: GroupedSyncVersions = { chats: new Map(), msgs: new Map(), tombstones: [] };

  for (const row of rows) {
    const { entityType, entityId, aspect, ts, deviceId, tombstonedAt } = row;
    if (tombstonedAt !== null && tombstonedAt !== undefined) {
      if ((aspect === 'deleted') || (aspect === 'historyCleared')) {
        res.tombstones.push({ entityType, entityId, aspect, token: { ts, deviceId }, tombstonedAt });
      }
      continue;
    }
    const target = (entityType === 'chat') ? res.chats : res.msgs;
    const aspects = target.get(entityId) ?? {};
    aspects[aspect] = { ts, deviceId };
    target.set(entityId, aspects);
  }

  return res;
}

export function chatIdOfMsgRow(row: Pick<MsgDbEntry, 'groupChatId' | 'otoPeerCAddr'>): ChatIdObj {
  return row.groupChatId
    ? { isGroupChat: true, chatId: row.groupChatId }
    : { isGroupChat: false, chatId: row.otoPeerCAddr! };
}

export function chatIdOfChatEntry(chat: ChatDbEntry): ChatIdObj {
  return chat.isGroupChat
    ? { isGroupChat: true, chatId: (chat as GroupChatDbEntry).chatId }
    : { isGroupChat: false, chatId: (chat as OTOChatDbEntry).peerCAddr };
}

/**
 * A message row in its archived form: the row minus the two chat columns (the
 * addressing pair carries those) and minus `attachments`, which becomes a field
 * of its own because an archived attachment has to say where its bytes are.
 */
export function msgRecordForArchive(row: MsgDbEntry): BackedUpMsgRecord {
  const { groupChatId: _g, otoPeerCAddr: _o, attachments: _a, ...rest } = row;
  return rest;
}

/** The inverse: an archived record plus its chat becomes a row to insert. */
export function msgRowFromArchive(
  chatId: ChatIdObj,
  record: BackedUpMsgRecord,
  attachments: ChatMessageAttachmentsInfo[] | null,
): MsgDbEntry {
  return {
    ...record,
    groupChatId: chatId.isGroupChat ? chatId.chatId : null,
    otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
    attachments,
  };
}

/**
 * A chat row in its archived form.
 *
 * The aggregates the chat list computes - `lastMsg` and `unread` - are dropped:
 * they are derived from the messages, and an archive that carried them would
 * restore a chat claiming an unread count its own history contradicts.
 */
export function chatRecordForArchive(chat: ChatDbEntry): BackedUpChatRecord {
  if (chat.isGroupChat) {
    const { chatId, members, admins, name, createdAt, lastUpdatedAt, status, settings } =
      chat as GroupChatDbEntry;
    return { isGroupChat: true, chatId, members, admins, name, createdAt, lastUpdatedAt, status, settings };
  }
  const { peerCAddr, peerAddr, name, createdAt, lastUpdatedAt, status, settings } = chat as OTOChatDbEntry;
  return { isGroupChat: false, peerCAddr, peerAddr, name, createdAt, lastUpdatedAt, status, settings };
}

export function chatIdOfArchivedChat(record: BackedUpChatRecord): ChatIdObj {
  return record.isGroupChat
    ? { isGroupChat: true, chatId: record.chatId }
    : { isGroupChat: false, chatId: record.peerCAddr };
}

/**
 * What is to be done about one attachment of one message.
 *
 * The order of the checks is the whole content of the function: every reason
 * except `unreadable` and `folder-partial` is decidable from the record alone,
 * and the most specific has to come first or every skipped attachment would be
 * reported as `no-local-source`. `symlink`, `unreadable` and `folder-partial`
 * are not here at all - only the window can see those, having the file store in
 * reach.
 */
export function planAttachment({
  chatId,
  chatMessageId,
  record,
  item,
  index,
  withAttachments,
}: {
  chatId: ChatIdObj;
  chatMessageId: string;
  record: Pick<MsgDbEntry, 'isIncomingMsg' | 'settings'>;
  item: ChatMessageAttachmentsInfo;
  index: number;
  withAttachments: boolean;
}): { planned: PlannedAttachment } | { skipped: SkippedAttachment } {
  const skippedRecord = {
    hasId: !!item.id,
    ...(item.isFolder && { isFolder: true as const }),
    ...(item.hasNoLocalSource && { hasNoLocalSource: true as const }),
    ...(record.isIncomingMsg && { isIncomingMsg: true as const }),
    ...(record.settings?.msgOwnersDeviceId && { fromDeviceId: record.settings.msgOwnersDeviceId }),
  };
  const skip = (
    reason: SkippedAttachment['reason'],
    originDeviceId?: string,
  ): { skipped: SkippedAttachment } => ({
    skipped: {
      chatId,
      chatMessageId,
      fileName: item.name,
      reason,
      ...(originDeviceId && { originDeviceId }),
      record: skippedRecord,
    },
  });

  if (!withAttachments) {
    return skip('not-requested');
  }
  // Checked before `isIncomingMsg`: a record that came from another device may
  // well be a record OF an incoming message (a resync answer carries those),
  // and then it is the device, not the inbox, that the bytes are behind.
  if (item.hasNoLocalSource || record.settings?.msgOwnersDeviceId) {
    return skip('on-another-device', item.originDeviceId ?? record.settings?.msgOwnersDeviceId);
  }
  if (record.isIncomingMsg) {
    return skip('in-incoming-msg');
  }
  if (!item.id) {
    return skip('no-local-source');
  }

  return {
    planned: {
      chatId,
      chatMessageId,
      fileName: item.name,
      blobName: attachmentBlobName(chatId, chatMessageId, index),
      entityId: item.id,
      ...(item.isFolder && { isFolder: true }),
    },
  };
}

/**
 * The greatest stamp anything says about a message - its "age".
 *
 * Not the tokens alone, and that is the lesson the reference implementation
 * paid for: creating a record writes no sync version at all in this app (the
 * `record` aspect is guarded by tombstones instead), so by tokens alone every
 * message that appeared AFTER the archive would read as older than it - and a
 * `replace` would delete exactly the messages the user has just received.
 */
export function ageStampOfMsg(row: MsgDbEntry, versions: AspectTokens | undefined): number {
  let stamp = row.timestamp;
  for (const token of Object.values(versions ?? {})) {
    if (token && (token.ts > stamp)) {
      stamp = token.ts;
    }
  }
  return stamp;
}

/**
 * The same for a chat, and it counts its newest message too: deleting a chat
 * takes its history with it, so the history is part of what the decision is
 * about.
 */
export function ageStampOfChat(
  chat: ChatDbEntry,
  versions: AspectTokens | undefined,
  newestMsgTs: number | undefined,
): number {
  let stamp = Math.max(chat.createdAt, chat.lastUpdatedAt, newestMsgTs ?? 0);
  for (const token of Object.values(versions ?? {})) {
    if (token && (token.ts > stamp)) {
      stamp = token.ts;
    }
  }
  return stamp;
}

export interface SurplusInput {
  snapshotTs: number;
  localChats: ChatDbEntry[];
  localMsgs: MsgDbEntry[];
  localVersions: GroupedSyncVersions;
  archivedChatIds: Set<string>;
  /** Keys are msgEntityId-shaped: `<chatIdToString>/<chatMessageId>`. */
  archivedMsgIds: Set<string>;
}

export interface SurplusOfArchive {
  chatIds: ChatIdObj[];
  msgIds: ChatMessageId[];
}

/**
 * What a `replace` is to delete: local entities the archive does not hold AND
 * that are older than the archive.
 *
 * The second half is the barrier. Without it a `replace` would delete
 * everything that happened after the backup was taken, which is the one thing
 * a restore must never do; with it, "the archive says this is gone" and "this
 * is newer than the archive" are told apart.
 *
 * Messages of a chat that is itself surplus are left out of `msgIds`: deleting
 * the chat removes them, and naming them twice would make the neighbours'
 * announcement carry a tombstone per message of a chat that no longer exists.
 */
export function surplusOfArchive({
  snapshotTs,
  localChats,
  localMsgs,
  localVersions,
  archivedChatIds,
  archivedMsgIds,
}: SurplusInput): SurplusOfArchive {
  const newestMsgTsPerChat = new Map<string, number>();
  for (const row of localMsgs) {
    const key = chatIdToString(chatIdOfMsgRow(row));
    const known = newestMsgTsPerChat.get(key);
    if ((known === undefined) || (row.timestamp > known)) {
      newestMsgTsPerChat.set(key, row.timestamp);
    }
  }

  const chatIds: ChatIdObj[] = [];
  const surplusChatKeys = new Set<string>();
  for (const chat of localChats) {
    const chatId = chatIdOfChatEntry(chat);
    const key = chatIdToString(chatId);
    if (archivedChatIds.has(key)) {
      continue;
    }
    const age = ageStampOfChat(chat, localVersions.chats.get(key), newestMsgTsPerChat.get(key));
    if (age < snapshotTs) {
      chatIds.push(chatId);
      surplusChatKeys.add(key);
    }
  }

  const msgIds: ChatMessageId[] = [];
  for (const row of localMsgs) {
    const chatId = chatIdOfMsgRow(row);
    const chatKey = chatIdToString(chatId);
    if (surplusChatKeys.has(chatKey)) {
      continue;
    }
    const key = `${chatKey}/${row.chatMessageId}`;
    if (archivedMsgIds.has(key)) {
      continue;
    }
    if (ageStampOfMsg(row, localVersions.msgs.get(key)) < snapshotTs) {
      msgIds.push({ chatId, chatMessageId: row.chatMessageId });
    }
  }

  return { chatIds, msgIds };
}

export interface SnapshotChunk {
  chats?: SnapshotChatEntry[];
  msgs?: SnapshotMsgEntry[];
  deleted?: SnapshotDeletions;
}

/**
 * Cuts a snapshot into chunks small enough to be one ASMail message each.
 *
 * Sized by the serialized length of an entry rather than by a count: records
 * differ by orders of magnitude - a call record against a long message with a
 * dozen attachments - and a count would either split a small history into
 * needless deliveries or make one message of an unbounded size.
 *
 * Chats come first, so that a neighbour applying the chunks in order has the
 * chat before the messages that belong to it; out of order the messages simply
 * buffer as orphans and are drained when the chat arrives, which is why the
 * ordering is a courtesy and not a requirement.
 *
 * The deletions ride in the LAST chunk: they are announced under a fresh token
 * and must win, and there is no point telling a neighbour what is gone before
 * telling it what is there.
 */
export function chunkRestoreSnapshot({
  chats,
  msgs,
  deleted,
  chunkBytes = RESTORE_SNAPSHOT_CHUNK_BYTES,
}: {
  chats: SnapshotChatEntry[];
  msgs: SnapshotMsgEntry[];
  deleted?: SnapshotDeletions;
  chunkBytes?: number;
}): SnapshotChunk[] {
  const chunks: SnapshotChunk[] = [];
  let current: SnapshotChunk = {};
  let currentSize = 0;

  const flush = (): void => {
    if (current.chats?.length || current.msgs?.length) {
      chunks.push(current);
    }
    current = {};
    currentSize = 0;
  };

  for (const chat of chats) {
    const size = JSON.stringify(chat).length;
    if (currentSize > 0 && (currentSize + size > chunkBytes)) {
      flush();
    }
    (current.chats ??= []).push(chat);
    currentSize += size;
  }

  for (const msg of msgs) {
    const size = JSON.stringify(msg).length;
    if (currentSize > 0 && (currentSize + size > chunkBytes)) {
      flush();
    }
    (current.msgs ??= []).push(msg);
    currentSize += size;
  }

  flush();

  if (deleted && (deleted.chatIds?.length || deleted.msgIds?.length)) {
    // Appended to the last chunk when there is room, and its own chunk when
    // there is not - a chunk carrying only deletions is legitimate, and is what
    // a `replace` of an archive that holds nothing comes down to.
    const last = chunks[chunks.length - 1];
    const size = JSON.stringify(deleted).length;
    if (last && (size < chunkBytes)) {
      last.deleted = deleted;
    } else {
      chunks.push({ deleted });
    }
  }

  return chunks;
}

/**
 * Whether a record is past its auto-deletion time and so not worth restoring.
 *
 * Restoring one is work with a negative result: deleteExpiredMessages() removes
 * it on the next start without a word, auto-deletion not being synchronized. A
 * restore counts these instead, so that "the restore did nothing" has an
 * explanation.
 */
export function isExpiredRecord(record: Pick<MsgDbEntry, 'removeAfter'>, now: number): boolean {
  return (record.removeAfter !== 0) && (record.removeAfter < now);
}

/** Key of a message in the archive's index, and of its sync versions. */
export function archiveMsgKey(chatId: ChatIdObj, chatMessageId: string): string {
  return `${chatIdToString(chatId)}/${chatMessageId}`;
}

export function indexArchivedChats(chats: BackedUpChat[]): Map<string, BackedUpChat> {
  return new Map(chats.map(chat => [chatIdToString(chat.chatId), chat]));
}

export function indexArchivedMsgs(msgs: BackedUpMsg[]): Map<string, BackedUpMsg> {
  return new Map(msgs.map(msg => [archiveMsgKey(msg.chatId, msg.chatMessageId), msg]));
}
