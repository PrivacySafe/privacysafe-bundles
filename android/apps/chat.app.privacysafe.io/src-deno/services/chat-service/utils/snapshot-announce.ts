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
// The ONE carrier of a snapshot to the user's other devices, and the one way
// a snapshot is read out of this device's database.
//
// Two features send snapshots: a restore announces what it restored, and a
// device answers 'resync:chats' with the chats another device is missing.
// Both go through here, so a receiver cannot tell them apart by anything but
// the fields that say what to do with them - and applies both with
// applyRestoreSnapshot().
import type { ChatIdObj } from '../../../../types/asmail-msgs.types.ts';
import type {
  BackedUpSyncToken,
  RestoreMode,
  SnapshotChatEntry,
  SnapshotDeletions,
  SnapshotMsgEntry,
} from '../../../../types/backup.types.ts';
import type { DB } from '../../../types/index.ts';
import { chatIdToString } from '../../../../shared-libs/chat-ids.ts';
import {
  archiveMsgKey,
  chatIdOfChatEntry,
  chatIdOfMsgRow,
  chatRecordForArchive,
  chunkRestoreSnapshot,
  groupSyncVersions,
  msgRecordForArchive,
} from '../../backup-service/backup-records.ts';
import { makeSystemEventPhantom, queueSnapshotChunks } from '../../mail-sending-service/index.ts';
import { attachmentsForPhantom } from './_msgs-related-methods.ts';

export interface DbSnapshot {
  chats: SnapshotChatEntry[];
  msgs: SnapshotMsgEntry[];
}

/**
 * Reads chats - all of them, or the ones named - with their whole histories
 * and per-aspect tokens, in the form a snapshot carries.
 *
 * The attachment list is the record's own, ids included: what travels is
 * decided by announceSnapshot(), which cuts the ids out the same way for any
 * snapshot. Messages of chats that are not in the result are not read out
 * either - a record whose chat the receiver cannot create would only be
 * skipped there.
 */
export function readSnapshotFromDb(db: DB, onlyChats?: ChatIdObj[]): DbSnapshot {
  const wanted = onlyChats ? new Set(onlyChats.map(chatIdToString)) : undefined;
  const versions = groupSyncVersions(db.getAllSyncVersions());

  const chats: SnapshotChatEntry[] = [];
  for (const chat of db.getChatList()) {
    const chatId = chatIdOfChatEntry(chat);
    const key = chatIdToString(chatId);
    if (wanted && !wanted.has(key)) {
      continue;
    }
    chats.push({
      chatId,
      record: chatRecordForArchive(chat),
      versions: versions.chats.get(key) ?? {},
    });
  }

  if (chats.length === 0) {
    return { chats, msgs: [] };
  }

  const present = new Set(chats.map(({ chatId }) => chatIdToString(chatId)));
  const msgs: SnapshotMsgEntry[] = [];
  for (const row of db.getAllMessages()) {
    const chatId = chatIdOfMsgRow(row);
    if (!present.has(chatIdToString(chatId))) {
      continue;
    }
    msgs.push({
      chatId,
      chatMessageId: row.chatMessageId,
      record: msgRecordForArchive(row),
      ...(row.attachments?.length && { attachments: row.attachments }),
      versions: versions.msgs.get(archiveMsgKey(chatId, row.chatMessageId)) ?? {},
    });
  }

  return { chats, msgs };
}

/**
 * Tells the user's other devices about a snapshot, as a chain of ordinary
 * `synchronization` phantoms carrying the `restore:snapshot` system event.
 *
 * The records travel with their per-aspect tokens, and the receiving side
 * applies them with applyRestoreSnapshot() - the function a restoring device
 * runs on itself - which is what makes `merge` there mean what it means here.
 *
 * Attachment bytes never travel. The attachment list is the one
 * attachmentsForPhantom() builds for any record, and `incomingMsgId` in the
 * record is what lets a receiver reach the bytes of a received message through
 * the shared inbox.
 *
 * Returns the number of chunks queued; nothing is queued for an empty snapshot.
 */
export async function announceSnapshot({
  db,
  ownAddr,
  sourceDeviceId,
  snapshotId,
  mode,
  snapshotTs,
  restoreToken,
  applyNewerAspects,
  chats,
  msgs,
  deleted,
}: {
  db: DB;
  ownAddr: string;
  sourceDeviceId: string;
  /** Ties the chunks together, in the journal and in the receivers' logs. */
  snapshotId: string;
  mode: RestoreMode;
  snapshotTs: number;
  /** Only a `replace` has one; it must reach every device unchanged. */
  restoreToken?: BackedUpSyncToken;
  /** Only an answer to 'resync:chats'; see RestoreSnapshotSysMsgData. */
  applyNewerAspects?: boolean;
  chats: SnapshotChatEntry[];
  msgs: SnapshotMsgEntry[];
  deleted?: SnapshotDeletions;
}): Promise<number> {
  // The record travels; the bytes do not, and `id` is cut out of every
  // attachment by the one function that does that for phantoms as well.
  const wireMsgs: SnapshotMsgEntry[] = msgs.map(msg => {
    const attachments = attachmentsForPhantom(msg.attachments, sourceDeviceId);
    return {
      chatId: msg.chatId,
      chatMessageId: msg.chatMessageId,
      record: msg.record,
      ...(attachments && { attachments }),
      versions: msg.versions,
    };
  });

  const chunks = chunkRestoreSnapshot({ chats, msgs: wireMsgs, deleted });
  if (chunks.length === 0) {
    return 0;
  }

  const phantoms = chunks.map((chunk, index) => {
    // chatId of the ENVELOPE is the chat of the chunk's first record, and a
    // chunk of deletions alone addresses this user's own chats through the
    // first id it names. Our own branch ignores this field; an older build
    // uses it only in its `chatRequired` gate, and with a chat that really
    // exists it goes straight to `default:` - whereas a made-up sentinel
    // would make it buffer every chunk in orphaned_messages for 15 days.
    const envelopeChatId =
      chunk.chats?.[0]?.chatId
      ?? chunk.msgs?.[0]?.chatId
      ?? chunk.deleted?.chatIds?.[0]
      ?? chunk.deleted?.msgIds?.[0]?.chatId
      ?? { isGroupChat: false, chatId: ownAddr };

    return makeSystemEventPhantom({
      chatId: envelopeChatId,
      sourceDeviceId,
      // Each chunk gets its own stamp: the journal orders rows by ts, and
      // equal stamps would leave the order of the chunks to the row ids.
      timestamp: snapshotTs + index,
      chatSystemData: {
        event: 'restore:snapshot',
        value: {
          mode,
          snapshotTs,
          restoreId: snapshotId,
          part: index + 1,
          of: chunks.length,
          ...(applyNewerAspects && { applyNewerAspects: true as const }),
          // In EVERY chunk, not only where records sit: a neighbour applies
          // the chunks independently and each one that restores a record has
          // to stamp it with the same token.
          ...(restoreToken && { restoreToken }),
          ...(chunk.chats && { chats: chunk.chats }),
          ...(chunk.msgs && { msgs: chunk.msgs }),
          ...(chunk.deleted && { deleted: chunk.deleted }),
        },
      },
    });
  });

  await queueSnapshotChunks({ db, ownAddr, restoreId: snapshotId, chunks: phantoms });
  return phantoms.length;
}
