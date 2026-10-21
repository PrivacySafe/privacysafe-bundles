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
// The database side of backup and restore.
//
// What lives here and what lives in the window is a deliberate split (see
// doc/08-backup-and-restore.md §1): this component owns the records - it hands
// out the json and the work-list of attachments, applies a restore, and
// announces it to the user's other devices. The window owns the bytes of the
// attachments, the zip, WebCrypto and the file dialogs.
//
// Attachment bytes cross the IPC boundary in NEITHER direction, and neither
// does the passphrase. What crosses is json records and a map of
// blobName -> entityId.
import type { ChatIdObj } from '../../../types/asmail-msgs.types.ts';
import type {
  BackedUpAttachment,
  BackedUpChat,
  BackedUpMsg,
  BackedUpTombstone,
  BackupPlan,
  BackupRecordFiles,
  BackupProgress,
  RestoreMode,
  RestoreOutcome,
  RestorePreview,
  RestoreProgress,
  PlannedAttachment,
  SkippedAttachment,
  SnapshotChatEntry,
  SnapshotMsgEntry,
} from '../../../types/backup.types.ts';
import type { ChatMessageAttachmentsInfo } from '../../../types/chat.types.ts';
import type { ChatSrvEmit, DB, FileStoreService, MsgDbEntry } from '../../types/index.ts';
import { SingleProc } from '../../../shared-libs/processes/single.ts';
import { chatIdToString } from '../../../shared-libs/chat-ids.ts';
import { generateFastRandomString } from '../../../shared-libs/generate-random-string.ts';
import { INBOX_SCAN_FLOOR_MS } from '../../../shared-libs/constants/inbox.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import {
  applyRestoreSnapshot,
  tombstoneVerdictForRestore,
  type RestoreSnapshotCtx,
} from '../chat-service/utils/restore-snapshot.ts';
import { attachmentsForPhantom } from '../chat-service/utils/_msgs-related-methods.ts';
import { chatEntityId, msgEntityId, parseMsgEntityId } from '../chat-service/utils/sync-versions.ts';
import { isNewerToken } from '../chat-service/utils/sync-versions.ts';
import { makeSystemEventPhantom, queueSnapshotChunks } from '../mail-sending-service/index.ts';
import {
  archiveMsgKey,
  chatIdOfChatEntry,
  chatIdOfMsgRow,
  chatRecordForArchive,
  chunkRestoreSnapshot,
  groupSyncVersions,
  indexArchivedChats,
  indexArchivedMsgs,
  isExpiredRecord,
  msgRecordForArchive,
  planAttachment,
  surplusOfArchive,
  type GroupedSyncVersions,
} from './backup-records.ts';

const log = makeLogger('ChatBackup');

/** Thrown when a backup was cancelled; recognized by the window as such. */
const CANCELLED_MESSAGE = 'Backup was cancelled';

export interface ChatBackupSrv {
  createBackupPlan(opts: { withAttachments?: boolean }): Promise<BackupPlan>;
  cancelBackupPlan(): Promise<void>;
  previewRestore(recordFiles: BackupRecordFiles, mode: RestoreMode): Promise<RestorePreview>;
  restoreBackupArchive(params: {
    recordFiles: BackupRecordFiles;
    storedAttachments: Record<string, string>;
    mode: RestoreMode;
    snapshotTs?: number;
  }): Promise<RestoreOutcome>;
}

export function chatBackupSrv({
  db,
  emit,
  filesStore,
  ownAddr,
  getAppDeviceId,
  nextSyncStamp,
  beginBulkReplay,
  endBulkReplay,
  drainOrphanedForChat,
}: {
  db: DB;
  emit: ChatSrvEmit;
  filesStore: FileStoreService;
  ownAddr: string;
  getAppDeviceId: () => string;
  nextSyncStamp: () => Promise<number>;
  beginBulkReplay: () => void;
  endBulkReplay: () => void;
  drainOrphanedForChat: (chatId: ChatIdObj) => Promise<void>;
}): ChatBackupSrv {
  // One process for both: a backup and a restore must not interleave, and a
  // second backup started while the first is scanning would read a database
  // being written by the first restore.
  const backupProc = new SingleProc();
  let cancelRequested = false;

  function emitBackupProgress(progress: BackupProgress | null): void {
    emit.common({ updatedEntityType: 'backup-progress', event: 'changed', progress });
  }

  function emitRestoreProgress(progress: RestoreProgress | null): void {
    emit.common({ updatedEntityType: 'restore-progress', event: 'changed', progress });
  }

  function throwIfCancelled(): void {
    if (cancelRequested) {
      throw new Error(CANCELLED_MESSAGE);
    }
  }

  async function cancelBackupPlan(): Promise<void> {
    cancelRequested = true;
  }

  async function createBackupPlan({
    withAttachments = true,
  }: { withAttachments?: boolean }): Promise<BackupPlan> {
    return backupProc.startOrChain(async () => {
      cancelRequested = false;
      emitBackupProgress({
        stage: 'scanning', totalFiles: 0, processedFiles: 0, percent: 0,
      });

      // Writes are batched (DB_FLUSH_DELAY_MS / DB_FLUSH_MAX_PENDING), so
      // without this the archive lags behind what the user is looking at.
      await db.flush();
      throwIfCancelled();

      // Taken BEFORE anything is read, so that no record of the archive can
      // carry a stamp above it - which is what makes it a usable barrier for a
      // later `replace`.
      const snapshotTs = await nextSyncStamp();

      // getChatList() carries the aggregates the chat list needs; the archived
      // form strips them (they are derived from the messages).
      const chatEntries = db.getChatList();
      const msgRows = db.getAllMessages();
      const versions = groupSyncVersions(db.getAllSyncVersions());

      const chats: BackedUpChat[] = chatEntries.map(chat => {
        const chatId = chatIdOfChatEntry(chat);
        return {
          chatId,
          record: chatRecordForArchive(chat),
          versions: versions.chats.get(chatIdToString(chatId)) ?? {},
        };
      });

      const attachmentsToRead: PlannedAttachment[] = [];
      const skippedAttachments: SkippedAttachment[] = [];

      const messages: BackedUpMsg[] = msgRows.map(row => {
        const chatId = chatIdOfMsgRow(row);
        const chatMessageId = row.chatMessageId;
        const attachments = row.attachments?.length
          ? row.attachments.map((item, index) => {
              const verdict = planAttachment({
                chatId, chatMessageId, record: row, item, index, withAttachments,
              });
              const archived: BackedUpAttachment = {
                fileName: item.name,
                size: item.size,
                ...(item.isFolder && { isFolder: true }),
                ...(item.originDeviceId && { originDeviceId: item.originDeviceId }),
                ...(item.recording && { recording: item.recording }),
              };
              if ('planned' in verdict) {
                attachmentsToRead.push(verdict.planned);
                return { ...archived, blobName: verdict.planned.blobName };
              }
              skippedAttachments.push(verdict.skipped);
              return { ...archived, omitted: verdict.skipped.reason };
            })
          : undefined;

        return {
          chatId,
          chatMessageId,
          record: msgRecordForArchive(row),
          ...(attachments && { attachments }),
          versions: versions.msgs.get(archiveMsgKey(chatId, chatMessageId)) ?? {},
        };
      });

      log.info(
        `Backup plan: ${chats.length} chat(s), ${messages.length} message(s), `
          + `${versions.tombstones.length} tombstone(s), ${attachmentsToRead.length} file(s) to read, `
          + `${skippedAttachments.length} skipped`,
      );

      return {
        snapshotTs,
        chats,
        messages,
        tombstones: versions.tombstones,
        attachmentsToRead,
        skippedAttachments,
        chatsCount: chats.length,
        messagesCount: messages.length,
      };
    });
  }

  /**
   * Parses the three json entries of an archive.
   *
   * Bytes come across as strings and are parsed here rather than in the window:
   * a malformed entry is a reason to refuse the restore, and it has to surface
   * as that rather than as an exception thrown while an argument was being
   * serialized.
   */
  function parseRecordFiles(files: BackupRecordFiles): {
    chats: BackedUpChat[];
    msgs: BackedUpMsg[];
    tombstones: BackedUpTombstone[];
  } {
    const chats = JSON.parse(files.chatsJson) as BackedUpChat[];
    const msgs = JSON.parse(files.messagesJson) as BackedUpMsg[];
    const tombstones = files.tombstonesJson
      ? (JSON.parse(files.tombstonesJson) as BackedUpTombstone[])
      : [];
    if (!Array.isArray(chats) || !Array.isArray(msgs) || !Array.isArray(tombstones)) {
      throw new Error('Backup archive records are not of the expected shape');
    }
    return { chats, msgs, tombstones };
  }

  /**
   * The single listing of the shared inbox a restore makes.
   *
   * It answers two questions at once: whether an archived `incomingMsgId` still
   * points at anything, and therefore whether it may be written. The floor is
   * required - on a falsy fromTS the platform's index throws ENOENT instead of
   * listing (see INBOX_SCAN_FLOOR_MS).
   *
   * A failure is not fatal: the caller is told that "not in the set" means
   * nothing, and trusts the archive instead.
   */
  async function listInboxMsgIds(): Promise<{ ids: Set<string>; available: boolean }> {
    try {
      const listing = await w3n.mail!.inbox.listMsgs(INBOX_SCAN_FLOOR_MS);
      return { ids: new Set(listing.map(item => item.msgId)), available: true };
    } catch (err) {
      await w3n.log('error', `Restore could not list the shared inbox; reachability of received files is a guess`, err);
      return { ids: new Set(), available: false };
    }
  }

  /**
   * Turns an archived attachment list into the record's attachment list, with
   * the ids the WINDOW created for the bytes it wrote back.
   *
   * The archived `id` is never reused: it points into the file store of the
   * device the archive was taken on and can collide with a local one.
   */
  function attachmentsFromArchive(
    archived: BackedUpAttachment[] | undefined,
    storedAttachments: Record<string, string>,
  ): ChatMessageAttachmentsInfo[] | undefined {
    if (!archived?.length) {
      return undefined;
    }
    return archived.map(item => {
      const storedId = item.blobName ? storedAttachments[item.blobName] : undefined;
      return {
        name: item.fileName,
        size: item.size,
        ...(item.isFolder && { isFolder: true }),
        ...(item.recording && { recording: item.recording }),
        ...(storedId
          ? { id: storedId }
          : {
              hasNoLocalSource: true,
              ...(item.originDeviceId && { originDeviceId: item.originDeviceId }),
            }),
      };
    });
  }

  function snapshotChatsOf(chats: BackedUpChat[]): SnapshotChatEntry[] {
    return chats.map(({ chatId, record, versions }) => ({ chatId, record, versions }));
  }

  function snapshotMsgsOf(
    msgs: BackedUpMsg[],
    storedAttachments: Record<string, string>,
  ): SnapshotMsgEntry[] {
    return msgs.map(({ chatId, chatMessageId, record, attachments, versions }) => ({
      chatId,
      chatMessageId,
      record,
      ...(() => {
        const resolved = attachmentsFromArchive(attachments, storedAttachments);
        return resolved ? { attachments: resolved } : {};
      })(),
      versions,
    }));
  }

  /**
   * A dry run of the restore: the numbers the mode dialog shows before the most
   * destructive action in the whole feature.
   *
   * Nothing is written, and it needs no mechanism of its own - `replace`'s
   * deletions are surplusOfArchive() over the state as it stands, which is
   * exactly what the restore itself will compute.
   */
  async function previewRestore(
    recordFiles: BackupRecordFiles,
    mode: RestoreMode,
  ): Promise<RestorePreview> {
    const { chats, msgs } = parseRecordFiles(recordFiles);
    const now = Date.now();

    let chatsToCreate = 0;
    let chatsToUpdate = 0;
    for (const chat of chats) {
      if (db.findChat(chat.chatId)) {
        if (mode === 'replace') {
          chatsToUpdate += 1;
        }
      } else {
        chatsToCreate += 1;
      }
    }

    let messagesToCreate = 0;
    let messagesToUpdate = 0;
    let expiredSkipped = 0;
    for (const msg of msgs) {
      const existing = await db.getMessage({ chatId: msg.chatId, chatMessageId: msg.chatMessageId });
      if (existing) {
        if (mode === 'replace') {
          messagesToUpdate += 1;
        }
        // Tombstones asked in the SAME order the restore asks them in, and
        // through the same function: before this, the preview counted every
        // absent record as one that would come back, so in a chat whose history
        // had been cleared the dialog promised messages the restore then
        // refused - and it promised them for `merge`, the mode a user picks
        // precisely because they want to know what it will do.
      } else if (tombstoneVerdictForRestore(db, mode, msg).blocked) {
        continue;
      } else if (isExpiredRecord(msg.record, now)) {
        expiredSkipped += 1;
      } else {
        messagesToCreate += 1;
      }
    }

    let chatsToDelete = 0;
    let messagesToDelete = 0;
    if (mode === 'replace') {
      const surplus = computeSurplus(chats, msgs, snapshotTsOfRecords(chats, msgs));
      chatsToDelete = surplus.chatIds.length;
      messagesToDelete = surplus.msgIds.length;
    }

    return {
      mode,
      chatsToCreate,
      chatsToUpdate,
      messagesToCreate,
      messagesToUpdate,
      chatsToDelete,
      messagesToDelete,
      expiredSkipped,
    };
  }

  /**
   * The stamp a preview judges surplus by, when the caller gave none.
   *
   * A preview is offered the record files alone, so the greatest stamp the
   * archive itself carries stands in for the metadata's `snapshotTs`. It can
   * only be lower than the real one, which makes the preview's delete count a
   * lower bound - understating what a `replace` would remove is the wrong way
   * round, so restoreBackupArchive is given the metadata stamp explicitly and
   * this is only ever the fallback.
   */
  function snapshotTsOfRecords(chats: BackedUpChat[], msgs: BackedUpMsg[]): number {
    let stamp = 0;
    for (const chat of chats) {
      stamp = Math.max(stamp, chat.record.createdAt, chat.record.lastUpdatedAt);
      for (const token of Object.values(chat.versions)) {
        stamp = Math.max(stamp, token?.ts ?? 0);
      }
    }
    for (const msg of msgs) {
      stamp = Math.max(stamp, msg.record.timestamp);
      for (const token of Object.values(msg.versions)) {
        stamp = Math.max(stamp, token?.ts ?? 0);
      }
    }
    return stamp;
  }

  function computeSurplus(
    chats: BackedUpChat[],
    msgs: BackedUpMsg[],
    snapshotTs: number,
  ): { chatIds: ChatIdObj[]; msgIds: { chatId: ChatIdObj; chatMessageId: string }[] } {
    const localVersions: GroupedSyncVersions = groupSyncVersions(db.getAllSyncVersions());
    return surplusOfArchive({
      snapshotTs,
      localChats: db.getChatList(),
      localMsgs: db.getAllMessages(),
      localVersions,
      archivedChatIds: new Set(indexArchivedChats(chats).keys()),
      archivedMsgIds: new Set(indexArchivedMsgs(msgs).keys()),
    });
  }

  /**
   * Writes the tombstones of an archive.
   *
   * A `deleted` tombstone goes in only when the entity is neither here nor in
   * the archive: a tombstone over a LIVING entity would block every future
   * update of it through isDeletedLaterThan, which is far worse than an archive
   * whose deletion is forgotten.
   *
   * A chat's `historyCleared` marker is written unconditionally (subject to the
   * usual token comparison): it deletes nothing by itself, it only forbids
   * re-creating messages older than itself.
   *
   * `tombstonedAt` is the ARCHIVED one, not Date.now(): otherwise every restore
   * would extend the life of every tombstone by another 15 days, and the
   * garbage collection of sync_versions would never catch up.
   */
  async function restoreTombstones(
    tombstones: BackedUpTombstone[],
    chats: BackedUpChat[],
    msgs: BackedUpMsg[],
  ): Promise<void> {
    const archivedChatKeys = new Set(indexArchivedChats(chats).keys());
    const archivedMsgKeys = new Set(indexArchivedMsgs(msgs).keys());
    const writes: Parameters<DB['setSyncVersions']>[0] = [];

    for (const { entityType, entityId, aspect, token, tombstonedAt } of tombstones) {
      const stored = db.getSyncVersion(entityType, entityId, aspect);
      if (!isNewerToken(token, stored)) {
        continue;
      }

      if (aspect === 'deleted') {
        if (entityType === 'chat') {
          // entityId of a chat is chatIdToString()'d, which is the very key the
          // archive index uses.
          if (archivedChatKeys.has(entityId)) {
            continue;
          }
          const parsed = chatIdFromEntityId(entityId);
          if (parsed && db.findChat(parsed)) {
            continue;
          }
        } else {
          if (archivedMsgKeys.has(entityId)) {
            continue;
          }
          const parsed = parseMsgEntityId(entityId);
          if (parsed) {
            const existing = await db.getMessage(parsed);
            if (existing) {
              continue;
            }
          }
          // An entityId this build cannot take apart is written anyway: the
          // alternative is dropping a deletion the archive does record, and the
          // invariant it relies on (no slash in a chatMessageId) holds today.
        }
      }

      writes.push({
        entityType,
        entityId,
        aspect,
        ts: token.ts,
        deviceId: token.deviceId,
        tombstonedAt,
      });
    }

    await db.setSyncVersions(writes);
  }

  function chatIdFromEntityId(entityId: string): ChatIdObj | undefined {
    if (entityId.startsWith('g/')) {
      return { isGroupChat: true, chatId: entityId.substring(2) };
    }
    if (entityId.startsWith('s/')) {
      return { isGroupChat: false, chatId: entityId.substring(2) };
    }
    return undefined;
  }

  async function restoreBackupArchive({
    recordFiles,
    storedAttachments,
    mode,
    snapshotTs: snapshotTsFromMetadata,
  }: {
    recordFiles: BackupRecordFiles;
    storedAttachments: Record<string, string>;
    mode: RestoreMode;
    snapshotTs?: number;
  }): Promise<RestoreOutcome> {
    return backupProc.startOrChain(async () => {
      // A restore is deliberately NOT cancellable: it writes records and their
      // tokens one at a time, a half-applied one has nothing to roll back to,
      // and the user's other devices would receive the chunks of an abandoned
      // restore.
      beginBulkReplay();
      try {
        const { chats, msgs, tombstones } = parseRecordFiles(recordFiles);
        const snapshotTs = snapshotTsFromMetadata ?? snapshotTsOfRecords(chats, msgs);

        emitRestoreProgress({
          stage: 'listing-inbox', totalItems: 0, processedItems: 0, percent: 0,
        });
        const inbox = await listInboxMsgIds();

        await restoreTombstones(tombstones, chats, msgs);

        // Computed BEFORE the archive is applied, while the local state is
        // still untouched, and stamped with a FRESH token: the deletion has to
        // win on the neighbours over everything this same snapshot restores.
        const surplus = (mode === 'replace') ? computeSurplus(chats, msgs, snapshotTs) : undefined;
        // Minted BEFORE the deletion token, and therefore strictly older than
        // it: a `replace` brings records back over a clearing marker under this
        // one, and the invariant above - a deletion wins over everything the
        // same snapshot restores - has to survive that. Only a `replace` has
        // one; `merge` resurrects nothing a tombstone forbids.
        const restoreToken = (mode === 'replace')
          ? { ts: await nextSyncStamp(), deviceId: getAppDeviceId() }
          : undefined;
        const deletionToken = surplus && (surplus.chatIds.length || surplus.msgIds.length)
          ? { ts: await nextSyncStamp(), deviceId: getAppDeviceId() }
          : undefined;

        const snapshotChats = snapshotChatsOf(chats);
        const snapshotMsgs = snapshotMsgsOf(msgs, storedAttachments);
        const total = snapshotChats.length + snapshotMsgs.length;

        const ctx: RestoreSnapshotCtx = {
          db,
          emit,
          filesStore,
          ownAddr,
          sourceDeviceId: getAppDeviceId(),
          hasLocalAttachmentBytes: true,
          inboxMsgIds: inbox.ids,
          inboxListingAvailable: inbox.available,
          drainOrphanedForChat,
          onProgress: (processed, itemsTotal, currentItem) =>
            emitRestoreProgress({
              stage: 'restoring',
              totalItems: itemsTotal,
              processedItems: processed,
              currentItem,
              percent: itemsTotal > 0 ? Math.floor((processed / itemsTotal) * 100) : 0,
            }),
        };

        emitRestoreProgress({
          stage: 'restoring', totalItems: total, processedItems: 0, percent: 0,
        });

        const applied = await applyRestoreSnapshot(
          {
            mode,
            snapshotTs,
            chats: snapshotChats,
            msgs: snapshotMsgs,
            ...(restoreToken && { restoreToken }),
            ...(deletionToken && surplus && {
              deleted: {
                ...(surplus.chatIds.length && { chatIds: surplus.chatIds }),
                ...(surplus.msgIds.length && { msgIds: surplus.msgIds }),
                token: deletionToken,
              },
            }),
          },
          ctx,
        );

        // The chunk must not go out ahead of the change it speaks about.
        await db.flush();

        emitRestoreProgress({
          stage: 'announcing', totalItems: total, processedItems: total, percent: 100,
        });
        await announceRestore({
          mode,
          snapshotTs,
          restoreToken,
          chats: snapshotChats,
          msgs: snapshotMsgs,
          deleted: deletionToken && surplus
            ? {
                ...(surplus.chatIds.length && { chatIds: surplus.chatIds }),
                ...(surplus.msgIds.length && { msgIds: surplus.msgIds }),
                token: deletionToken,
              }
            : undefined,
        });

        emitRestoreProgress({
          stage: 'completed', totalItems: total, processedItems: total, percent: 100,
        });

        log.info(
          `Restore (${mode}) done: chats +${applied.chatsCreated}/~${applied.chatsUpdated}, `
            + `messages +${applied.messagesCreated}/~${applied.messagesUpdated}, `
            + `deleted ${applied.chatsDeleted} chat(s) and ${applied.messagesDeleted} message(s), `
            + `${applied.skipped} skipped, ${applied.skippedExpired} expired`,
        );

        return {
          restored: true,
          chatsCreated: applied.chatsCreated,
          chatsUpdated: applied.chatsUpdated,
          messagesCreated: applied.messagesCreated,
          messagesUpdated: applied.messagesUpdated,
          skipped: applied.skipped,
          skippedExpired: applied.skippedExpired,
          chatsDeleted: applied.chatsDeleted,
          messagesDeleted: applied.messagesDeleted,
          unusedAttachmentIds: applied.unusedAttachmentIds,
          inboxListingFailed: !inbox.available,
        };
      } catch (err) {
        emitRestoreProgress({
          stage: 'error', totalItems: 0, processedItems: 0, percent: 0,
        });
        throw err;
      } finally {
        endBulkReplay();
      }
    });
  }

  /**
   * Tells the user's other devices what was restored, as a chain of ordinary
   * `synchronization` phantoms carrying a new `system` event.
   *
   * The records travel with the SAME per-aspect tokens the archive holds, and
   * the receiving side applies them with the same function this device just
   * used - which is what makes `merge` on a neighbour mean what it meant here.
   *
   * Attachment bytes never travel. Nothing is invented for that: the phantom's
   * attachment list is the one attachmentsForPhantom() builds for any record,
   * and `incomingMsgId` in the record is what lets a neighbour reach the bytes
   * of a received message through the shared inbox.
   *
   * Done regardless of hasSeenOtherDevice(): that flag answers "has a
   * neighbour ever spoken here", not "is there a neighbour", and a device that
   * has been switched off since it was installed would otherwise be left behind
   * for good.
   */
  async function announceRestore({
    mode,
    snapshotTs,
    restoreToken,
    chats,
    msgs,
    deleted,
  }: {
    mode: RestoreMode;
    snapshotTs: number;
    /** Only a `replace` has one; it must reach every device unchanged. */
    restoreToken?: { ts: number; deviceId: string };
    chats: SnapshotChatEntry[];
    msgs: SnapshotMsgEntry[];
    deleted?: {
      chatIds?: ChatIdObj[];
      msgIds?: { chatId: ChatIdObj; chatMessageId: string }[];
      token: { ts: number; deviceId: string };
    };
  }): Promise<void> {
    const sourceDeviceId = getAppDeviceId();
    const restoreId = generateFastRandomString(10);

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
      return;
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
            restoreId,
            part: index + 1,
            of: chunks.length,
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

    log.info(`Announcing restore ${restoreId} to other devices in ${phantoms.length} chunk(s)`);
    await queueSnapshotChunks({ db, ownAddr, restoreId, chunks: phantoms });
  }

  return { createBackupPlan, cancelBackupPlan, previewRestore, restoreBackupArchive };
}

export { CANCELLED_MESSAGE };

/**
 * Re-exported so that the entity ids of the chats and messages an archive
 * carries are built by the same functions the LWW code uses.
 */
export { chatEntityId, msgEntityId };
export type { MsgDbEntry };
