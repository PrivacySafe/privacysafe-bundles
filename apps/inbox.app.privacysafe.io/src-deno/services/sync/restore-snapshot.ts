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
*/

/**
 * Applying a restore, and announcing it to the user's other devices.
 *
 * The whole idea of restoring in this app is that it INVENTS NO MERGE RULES OF
 * ITS OWN, but is expressed in the ones that already exist. An archive holds
 * records together with their per-aspect ordering tokens; a restore applies them
 * through `applyIfNewer()`; the other devices are told about it by a bulk
 * phantom that carries the same tokens, and the receiver applies them through
 * the same `applyIfNewer()`.
 *
 * `applyRestoreSnapshot()` is therefore ONE function used by both ends - the
 * device the archive was restored on, and every device the snapshot reaches.
 * That is the only real guarantee that `merge` on a neighbour means what `merge`
 * meant on the source.
 */

import { makeLogger } from '../../../shared/utils/logger.ts';
import { RESTORE_SNAPSHOT_CHUNK_BYTES } from '../../utils/backup-archive.ts';
import type {
  AttachmentInfo,
  MailFolder,
} from '../../../src/common/types/mail.types.ts';
import type { DBProvider } from '../../dataset/index.ts';
import type { BackedUpAttachment } from '../../types/backup.types.ts';
import type {
  MailSyncEventV2,
  SnapshotFolderEntry,
  SnapshotMsgEntry,
  SyncedMsgRecord,
} from '../../types/mail-sync.types.ts';
import type {
  RestoreMode,
  SyncAspect,
  SyncToken,
  SyncVersionWrite,
} from '../../types/sync-types.ts';
import type { InboxEmit } from '../inbox-service/events.ts';
import {
  applyDelivery,
  applyPlacement,
  applyRead,
  isIncomingMsg,
  type MsgView,
} from './msg-aspects.ts';
import {
  applyRecordContent,
  incomingMsgFromSyncedRecord,
  isRestorableIncomingRecord,
  msgFromSyncedRecord,
} from './record-mapping.ts';
import { applyIfNewer, isDeletedLaterThan, isNewerToken, recordDeletion } from './sync-versions.ts';

const log = makeLogger('RestoreSnapshot');

/**
 * A message as a restore sees it: a snapshot entry, plus - on the device the
 * archive is being restored on - the attachments the archive holds for it.
 *
 * The attachments are not part of the snapshot: their bytes never travel between
 * devices, and a phantom carrying them would be an archive sent by mail.
 */
export interface RestorableMsg extends SnapshotMsgEntry {
  attachments?: BackedUpAttachment[];
}

export interface RestoreSnapshotInput {
  mode: RestoreMode;
  /** The barrier of `replace`; also the fallback stamp - see fallbackTokenOf(). */
  snapshotTs: number;
  /**
   * The device the archive was restored on. On that device it is its own id; on
   * a receiving device it is the phantom's `sourceDeviceId` - the same value
   * either way, which is what keeps the fallback token identical on both ends.
   */
  sourceDeviceId: string;
  msgs?: RestorableMsg[];
  folders?: SnapshotFolderEntry[];
  /** Only in `replace`. The token is fresh, so the deletion wins everywhere. */
  deleted?: { msgIds?: string[]; folderIds?: string[]; token: SyncToken };
}

export interface RestoreSnapshotCtx {
  db: DBProvider;
  emit: InboxEmit;
  /** The same helper a local change goes through, so the GUI cannot tell them apart. */
  applyMsgChanges(changes: MsgView[]): Promise<void>;
  /** Deletes with the file GC, under the given token. Queues no phantom. */
  deleteMessages(msgIds: string[], token: SyncToken): Promise<void>;
  /**
   * msgIds actually present in the shared inbox.
   *
   * EMPTY when the listing failed, and that is the safe side of the failure: the
   * snapshot then carries the records of every incoming message (redundant but
   * harmless - an archived token loses to a fresher one on the receiver), and
   * `origin` attachments stay marked as reachable, which is exactly how the app
   * behaves today.
   */
  serverMsgIds: ReadonlySet<string>;
  /**
   * Whether `serverMsgIds` is an answer at all. False on a receiving device,
   * which never lists the inbox for a snapshot, and false on the restoring
   * device when the listing failed - in both cases "not in the set" says
   * nothing.
   */
  serverListingAvailable: boolean;
  /**
   * Reads an incoming message out of the shared inbox and stores it. The
   * receiving side of an entry that carries no record; absent on the restoring
   * device, where the archive carries every record.
   */
  ensureIncomingRecord?(msgId: string, entry: SnapshotMsgEntry): Promise<MsgView | undefined>;
  /**
   * Turns the archive's attachment list into local `attachmentsInfo`, writing the
   * bytes into this device's file store and giving each of them a NEW local id.
   * Absent on a receiving device, which has no bytes to write.
   */
  restoreAttachments?(
    msgId: string,
    attachments: BackedUpAttachment[] | undefined,
    incoming: boolean,
  ): Promise<AttachmentInfo[] | undefined>;
  /**
   * Puts the bytes of attachments the LOCAL record has none for into the store,
   * and answers the new `attachmentsInfo` - or undefined when nothing was
   * missing. Only on the restoring device; a receiving one has no bytes.
   *
   * See fillInAttachmentBytes() for why this stands outside the aspect rules.
   */
  fillAttachmentBytes?(
    msgId: string,
    archived: BackedUpAttachment[] | undefined,
    local: AttachmentInfo[] | undefined,
  ): Promise<AttachmentInfo[] | undefined>;
  onProgress?(done: number, total: number, current?: string): void;
}

export interface RestoreSnapshotResult {
  created: number;
  updated: number;
  skipped: number;
  deletedMsgs: number;
  deletedFolders: number;
  foldersApplied: number;
  /** Restored incoming messages the shared inbox no longer holds. */
  onlyInArchive: number;
  /** Records whose attachments got their bytes back - see fillInAttachmentBytes. */
  attachmentsFilled: number;
}

function emptyResult(): RestoreSnapshotResult {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    deletedMsgs: 0,
    deletedFolders: 0,
    foldersApplied: 0,
    onlyInArchive: 0,
    attachmentsFilled: 0,
  };
}

/**
 * The stamp an aspect the archive holds no token for is applied under.
 *
 * Incoming messages normally have no tokens at all - their records are never
 * announced - so without a fallback the archive would have nothing to say about
 * where the user had put such a message. `snapshotTs` is the honest answer: the
 * archive states the mailbox as of that stamp.
 *
 * It has to be the SAME token on every device, or two devices would record
 * different tokens for one restored aspect and drift apart at the next change.
 * That holds because both `snapshotTs` and the restoring device's id travel in
 * the snapshot.
 */
export function fallbackTokenOf(input: Pick<RestoreSnapshotInput, 'snapshotTs' | 'sourceDeviceId'>): SyncToken {
  return { ts: input.snapshotTs, deviceId: input.sourceDeviceId };
}

function tokenFor(
  entry: Pick<RestorableMsg, 'versions'>,
  aspect: SyncAspect,
  fallback: SyncToken,
): SyncToken {
  return entry.versions?.[aspect] ?? fallback;
}

/** The greatest token an entry carries, or the fallback when it carries none. */
function greatestTokenOf(
  versions: Partial<Record<SyncAspect, SyncToken>> | undefined,
  fallback: SyncToken,
): SyncToken {
  let greatest = fallback;
  for (const token of Object.values(versions ?? {})) {
    if (token && isNewerToken(token, greatest)) {
      greatest = token;
    }
  }
  return greatest;
}

function versionWritesOf(
  entityType: 'msg' | 'folder',
  entityId: string,
  versions: Partial<Record<SyncAspect, SyncToken>> | undefined,
  /** Aspects to write even though the archive named no token for them. */
  alsoUnderFallback?: { aspects: readonly SyncAspect[]; fallback: SyncToken },
): SyncVersionWrite[] {
  const tokens = new Map<SyncAspect, SyncToken>();

  for (const aspect of alsoUnderFallback?.aspects ?? []) {
    tokens.set(aspect, alsoUnderFallback!.fallback);
  }
  for (const [aspect, token] of Object.entries(versions ?? {})) {
    // A tombstone is never restored as an aspect version of a live entity: the
    // archive's tombstones are applied on their own, and a 'deleted' row here
    // would make the record it belongs to unresurrectable.
    if (!token || (aspect === 'deleted')) {
      continue;
    }
    tokens.set(aspect as SyncAspect, token);
  }

  return [...tokens.entries()].map(([aspect, token]) => ({
    entityType,
    entityId,
    aspect,
    ...token,
  }));
}

/**
 * Aspects a record written straight out of the archive is entitled to speak for.
 *
 * Written even where the archive named no token, under the fallback stamp, and
 * that is not tidiness: without them the very next `replace` pass would find no
 * stored version for `delivery` and `placement`, apply the archive's values
 * again and report a change - a restore that is not idempotent, over values that
 * are identical.
 *
 * `content` is left out for an incoming record on purpose: an incoming message's
 * content belongs to the server, applyAspectsOnto() never applies it over a
 * record that is here, and a row nothing ever consults is dead data.
 */
function aspectsOfCreatedRecord(entry: RestorableMsg): readonly SyncAspect[] {
  if (entry.incoming) {
    return (entry.record?.read !== undefined) ? ['placement', 'read'] : ['placement'];
  }
  return ['content', 'delivery', 'placement'];
}

// =============================================================================
// Applying a snapshot - the code both ends run
// =============================================================================

export async function applyRestoreSnapshot(
  input: RestoreSnapshotInput,
  ctx: RestoreSnapshotCtx,
): Promise<RestoreSnapshotResult> {
  const res = emptyResult();
  const fallback = fallbackTokenOf(input);

  const folders = input.folders ?? [];
  const msgs = input.msgs ?? [];
  const total = folders.length + msgs.length;
  let done = 0;

  // Folders first: a message's placement may name one of them, and a record
  // pointing at a folder that is not there yet renders in nothing.
  for (const entry of folders) {
    if (await applyFolderEntry(entry, input, fallback, ctx)) {
      res.foldersApplied += 1;
    }
    done += 1;
    ctx.onProgress?.(done, total);
  }

  for (const entry of msgs) {
    try {
      if (await fillInAttachmentBytes(entry, ctx)) {
        res.attachmentsFilled += 1;
      }
      const outcome = await applyMsgEntry(entry, input, fallback, ctx);
      if (outcome === 'created') {
        res.created += 1;
      } else if (outcome === 'updated') {
        res.updated += 1;
      } else {
        res.skipped += 1;
      }
      const isOnlyInArchive = entry.noServerCopy
        || (ctx.serverListingAvailable && entry.incoming && !ctx.serverMsgIds.has(entry.msgId));
      if ((outcome !== 'skipped') && isOnlyInArchive) {
        res.onlyInArchive += 1;
      }
    } catch (err) {
      // One unreadable entry must not cost the user the rest of the archive.
      res.skipped += 1;
      log.error(`Failed to restore message ${entry.msgId}`, err);
    }
    done += 1;
    ctx.onProgress?.(done, total, entry.msgId);
  }

  // Deletions last, and under a FRESH token: they have to win on every device,
  // whichever order the chunks arrive in.
  if (input.deleted) {
    const { msgIds = [], folderIds = [], token } = input.deleted;
    for (const msgId of msgIds) {
      await recordDeletion(ctx.db, 'msg', msgId, token);
    }
    if (msgIds.length > 0) {
      await ctx.deleteMessages(msgIds, token);
      res.deletedMsgs = msgIds.length;
    }
    for (const folderId of folderIds) {
      await recordDeletion(ctx.db, 'folder', folderId, token);
      const folder = ctx.db.getFolderById(folderId);
      if (folder) {
        await ctx.db.deleteFolder(folder);
        ctx.emit({ entity: 'folder', event: 'removed', folderId });
        res.deletedFolders += 1;
      }
    }
  }

  return res;
}

async function applyFolderEntry(
  entry: SnapshotFolderEntry,
  input: RestoreSnapshotInput,
  fallback: SyncToken,
  ctx: RestoreSnapshotCtx,
): Promise<boolean> {
  const { db } = ctx;
  const folder: MailFolder = entry.folder;
  if (!folder?.id) {
    return false;
  }

  const token = tokenFor(entry, 'folderProps', fallback);

  if (input.mode === 'merge') {
    // Present, or deliberately gone: either way it is not this archive's to
    // touch. A tombstone is respected, so a deleted folder does not come back.
    if (db.getFolderById(folder.id) || db.getSyncVersion('folder', folder.id, 'deleted')) {
      return false;
    }
    await db.upsertFolder(folder);
    ctx.emit({ entity: 'folder', event: 'updated', folder });
    // `folderProps` under the fallback when the archive named no token, for the
    // reason aspectsOfCreatedRecord() spells out: without a stored version the
    // next `replace` pass would apply the same folder again and report a change.
    await db.setSyncVersions(versionWritesOf('folder', folder.id, entry.versions, {
      aspects: ['folderProps'],
      fallback,
    }));
    return true;
  }

  if (isDeletedLaterThan(db, 'folder', folder.id, token)) {
    return false;
  }

  return applyIfNewer(
    { db, entityType: 'folder', entityId: folder.id, aspect: 'folderProps', token },
    async () => {
      await db.upsertFolder(folder);
      ctx.emit({ entity: 'folder', event: 'updated', folder });
    },
  );
}

/**
 * Gives a record that is already here the bytes of the attachments it has none
 * for - in BOTH modes, and under NO token at all.
 *
 * This looks like a hole in the rules and is the opposite: it exists because the
 * rules, applied to attachment bytes, produce a restore that cannot restore
 * anything in the commonest disaster there is.
 *
 * A device that lost its database and came back gets every record out of the
 * shared inbox: the phantoms of the user's own changes sit there for
 * INBOX_REMOVAL_DELAY_MS, and to a device with a new `appDeviceId` they are
 * another device's phantoms, so they apply. What that CANNOT bring back is the
 * bytes: a phantom carries the record marked `hasNoLocalSource` and nothing else
 * (see attachmentsForPhantom). Restoring the archive over such a record then
 * does nothing at all - `merge` skips a record that is present, and `replace`
 * finds the archive's `content` token EQUAL to the stored one, because one stamp
 * was written into `sync_versions` and into the phantom alike (see announce()),
 * so the archived token loses in isNewerToken(). The one thing the archive has
 * that synchronization does not would never arrive.
 *
 * So availability is not treated as an aspect, and it should not be: an aspect
 * is something two devices can disagree about, and no other device can claim
 * that the bytes are not on THIS one. Filling them in only ever adds - a file
 * the user could not open becomes one they can - so there is nothing for
 * last-write-wins to arbitrate and no token to write.
 *
 * @returns whether anything was filled in.
 */
async function fillInAttachmentBytes(
  entry: RestorableMsg,
  ctx: RestoreSnapshotCtx,
): Promise<boolean> {
  if (!ctx.fillAttachmentBytes || !entry.attachments?.length) {
    return false;
  }
  const existing = ctx.db.getMessageById(entry.msgId);
  if (!existing?.attachmentsInfo?.length) {
    return false;
  }

  const filled = await ctx.fillAttachmentBytes(
    entry.msgId,
    entry.attachments,
    existing.attachmentsInfo,
  );
  if (!filled) {
    return false;
  }

  await ctx.applyMsgChanges([{ ...existing, attachmentsInfo: filled }]);
  log.info(`Put the bytes of ${filled.length} attachment(s) of ${entry.msgId} back in place.`);
  return true;
}

async function applyMsgEntry(
  entry: RestorableMsg,
  input: RestoreSnapshotInput,
  fallback: SyncToken,
  ctx: RestoreSnapshotCtx,
): Promise<'created' | 'updated' | 'skipped'> {
  const { db } = ctx;
  const { msgId } = entry;

  let existing = db.getMessageById(msgId) ?? undefined;

  if (input.mode === 'merge') {
    // The two rules of `merge`, and the whole of it: an entity that is here is
    // not touched in any aspect, and a tombstone is respected - a message the
    // user deleted after taking the backup does not come back to life.
    if (existing) {
      return 'skipped';
    }
    if (db.getSyncVersion('msg', msgId, 'deleted')) {
      return 'skipped';
    }
  } else if (!existing) {
    // `replace` over a record that is not here: the usual tombstone guard, since
    // a deletion younger than the archive still has to win.
    if (isDeletedLaterThan(db, 'msg', msgId, greatestTokenOf(entry.versions, fallback))) {
      return 'skipped';
    }
  }

  if (!existing) {
    const created = await materializeNewRecord(entry, input, fallback, ctx);
    if (created === 'pulled') {
      // The record came out of the shared inbox; the aspects the snapshot
      // carries still have to be put on top of it.
      existing = db.getMessageById(msgId) ?? undefined;
      if (!existing) {
        return 'skipped';
      }
      await applyAspectsOnto(entry, existing, input, fallback, ctx);
      return 'created';
    }
    return created ? 'created' : 'skipped';
  }

  // `replace` over an existing record - aspect by aspect, each under its own
  // token, so that a later local change of one of them survives the restore.
  return (await applyAspectsOnto(entry, existing, input, fallback, ctx)) ? 'updated' : 'skipped';
}

/**
 * Brings a record that is not here into being.
 *
 * @returns 'pulled' when it came out of the shared inbox and its aspects are
 *          still to be applied; true when the snapshot's own record was written
 *          whole; false when there was nothing to build it from.
 */
async function materializeNewRecord(
  entry: RestorableMsg,
  input: RestoreSnapshotInput,
  fallback: SyncToken,
  ctx: RestoreSnapshotCtx,
): Promise<boolean | 'pulled'> {
  const { db } = ctx;
  const { msgId, record } = entry;

  if (!record) {
    // No record in the entry means the receiver is expected to read the message
    // out of the shared inbox - which is where an incoming record's carrier
    // normally is. `noServerCopy` is exactly the case where it is not, and then
    // the entry would have carried a record: spending a getMsg on it, and worse,
    // burying it in the orphan buffer where it would die of old age, is the very
    // thing that flag exists to prevent.
    if (entry.noServerCopy) {
      log.error(
        `Snapshot entry for ${msgId} says the message is not on the server and carries no `
          + `record either; there is nothing to restore it from.`,
      );
      return false;
    }
    if (!entry.incoming || !ctx.ensureIncomingRecord) {
      log.error(
        `Snapshot entry for ${msgId} carries no record and nothing can be read instead; `
          + `skipping it.`,
      );
      return false;
    }
    return (await ctx.ensureIncomingRecord(msgId, entry)) ? 'pulled' : false;
  }

  const attachmentsInfo = ctx.restoreAttachments
    ? await ctx.restoreAttachments(msgId, entry.attachments, entry.incoming)
    : record.attachmentsInfo as AttachmentInfo[] | undefined;

  let view: MsgView;
  if (entry.incoming) {
    if (!isRestorableIncomingRecord(record)) {
      // Without a sender the record reads as OUTGOING everywhere in this app
      // (see isIncomingMsg), so storing it would put a broken row in the
      // mailbox rather than restore a message.
      log.error(`Archived record of incoming ${msgId} carries no sender; skipping it.`);
      return false;
    }
    view = incomingMsgFromSyncedRecord(msgId, record);
  } else {
    view = msgFromSyncedRecord(msgId, record, input.sourceDeviceId);
  }

  view = {
    ...view,
    ...(attachmentsInfo?.length ? { attachmentsInfo } : { attachmentsInfo: undefined }),
  };

  await ctx.applyMsgChanges([view]);
  await db.setSyncVersions(versionWritesOf('msg', msgId, entry.versions, {
    aspects: aspectsOfCreatedRecord(entry),
    fallback,
  }));
  return true;
}

/**
 * Puts the aspects a snapshot carries onto a record that is already here.
 *
 * @returns whether anything changed.
 */
async function applyAspectsOnto(
  entry: RestorableMsg,
  existing: MsgView,
  input: RestoreSnapshotInput,
  fallback: SyncToken,
  ctx: RestoreSnapshotCtx,
): Promise<boolean> {
  const { db } = ctx;
  const { msgId, record } = entry;
  const incoming = isIncomingMsg(existing);

  let next: MsgView = existing;
  let changed = false;
  const step = (updated: MsgView) => {
    next = updated;
    changed = true;
  };

  if (record && !incoming) {
    await applyIfNewer(
      { db, entityType: 'msg', entityId: msgId, aspect: 'content', token: tokenFor(entry, 'content', fallback) },
      async () => {
        const attachmentsInfo = ctx.restoreAttachments
          ? await ctx.restoreAttachments(msgId, entry.attachments, false)
          : (record.attachmentsInfo as AttachmentInfo[] | undefined);
        step({
          ...applyRecordContent(next, record),
          attachmentsInfo: attachmentsInfo?.length ? attachmentsInfo : undefined,
        });
      },
    );

    // Delivery before placement: placement's 'home' is worked out from the
    // record's status, which delivery is what sets.
    await applyIfNewer(
      { db, entityType: 'msg', entityId: msgId, aspect: 'delivery', token: tokenFor(entry, 'delivery', fallback) },
      async () => step(applyDelivery(next, record.delivery)),
    );
  }

  // NOTE what does NOT happen for an incoming record that is already here: its
  // `content` is not touched. The server is the source of truth for the content
  // of an incoming message, and both the archive and the local record derive
  // from the same message - so the archive is entitled to speak only for the two
  // aspects that belong to the USER. That is the same division
  // persistIncomingMail() keeps.

  const placement = record?.placement ?? entry.placement;
  if (placement) {
    await applyIfNewer(
      { db, entityType: 'msg', entityId: msgId, aspect: 'placement', token: tokenFor(entry, 'placement', fallback) },
      async () => step(applyPlacement(next, placement)),
    );
  }

  const read = record ? record.read : entry.read;
  if (incoming && (read !== undefined)) {
    await applyIfNewer(
      { db, entityType: 'msg', entityId: msgId, aspect: 'read', token: tokenFor(entry, 'read', fallback) },
      async () => step(applyRead(next, read)),
    );
  }

  if (changed) {
    await ctx.applyMsgChanges([next]);
  }
  return changed;
}

// =============================================================================
// What a `replace` deletes, and how a snapshot is cut into phantoms
// =============================================================================

export interface SurplusInput {
  /**
   * Local messages with the greatest stamp anything about them carries - the
   * per-aspect tokens, and, for a record that has none, its own time.
   */
  msgs: Array<{ msgId: string; maxTs: number }>;
  folders: Array<{ folderId: string; maxTs: number; isSystem: boolean }>;
  archiveMsgIds: ReadonlySet<string>;
  archiveFolderIds: ReadonlySet<string>;
  snapshotTs: number;
}

/**
 * What `replace` deletes: local entities the archive does not have AND that are
 * older than the archive.
 *
 * Both halves are needed. Without the first there would be nothing to delete;
 * without the second a restore would wipe every message that arrived after the
 * backup was taken, which is the opposite of what the mode promises ("whatever
 * is younger than the archive stays as it is").
 *
 * `maxTs` is not the token stamp alone, and that is the point of the caller
 * passing it in: an incoming message that was never marked read and never moved
 * has NO tokens at all, so by tokens alone every message that arrived after the
 * backup would read as older than it and be deleted. Its own `deliveryTS` (or a
 * draft's `cTime`) is what stands in.
 *
 * System folders are never surplus, whatever their stamps say.
 *
 * Pure, and exported for the spec: it decides what gets destroyed, which is
 * exactly the kind of rule worth pinning down by a table.
 */
export function surplusOfArchive(input: SurplusInput): { msgIds: string[]; folderIds: string[] } {
  const msgIds = input.msgs
    .filter(({ msgId, maxTs }) => !input.archiveMsgIds.has(msgId) && (maxTs < input.snapshotTs))
    .map(({ msgId }) => msgId);

  const folderIds = input.folders
    .filter(({ folderId, maxTs, isSystem }) =>
      !isSystem && !input.archiveFolderIds.has(folderId) && (maxTs < input.snapshotTs))
    .map(({ folderId }) => folderId);

  return { msgIds, folderIds };
}

export interface SnapshotChunkInput {
  mode: RestoreMode;
  snapshotTs: number;
  restoreId: string;
  msgs: SnapshotMsgEntry[];
  folders: SnapshotFolderEntry[];
  deleted?: { msgIds?: string[]; folderIds?: string[]; token: SyncToken };
  /** RESTORE_SNAPSHOT_CHUNK_BYTES unless a spec says otherwise. */
  maxBytes?: number;
}

/**
 * Cuts a snapshot into the phantoms that carry it.
 *
 * The order of the chunks does not matter, and the proof is short: the entries
 * of different chunks do not overlap, and the deletion token is a fresh one -
 * greater than any archived token - so the deletion wins whenever it arrives.
 * A chunk delivered twice is harmless for the general reason: an equal token
 * loses in isNewerToken().
 *
 * At least one chunk always comes out, even for an empty snapshot: in `replace`
 * the deletions ride in the last chunk, and an empty mailbox restored over a
 * full one is precisely the case where they are the whole message.
 */
export function chunkRestoreSnapshot(input: SnapshotChunkInput): MailSyncEventV2[] {
  const maxBytes = input.maxBytes ?? RESTORE_SNAPSHOT_CHUNK_BYTES;
  const chunks: Array<{ msgs: SnapshotMsgEntry[]; folders: SnapshotFolderEntry[] }> = [];

  let current: { msgs: SnapshotMsgEntry[]; folders: SnapshotFolderEntry[] } = { msgs: [], folders: [] };
  let currentBytes = 0;

  const push = () => {
    if ((current.msgs.length > 0) || (current.folders.length > 0)) {
      chunks.push(current);
      current = { msgs: [], folders: [] };
      currentBytes = 0;
    }
  };

  for (const folder of input.folders) {
    const size = JSON.stringify(folder).length;
    // An entry bigger than the budget on its own still goes in: it has to travel
    // somehow, and cutting a record in half is not on the table.
    if ((currentBytes > 0) && ((currentBytes + size) > maxBytes)) {
      push();
    }
    current.folders.push(folder);
    currentBytes += size;
  }

  for (const msg of input.msgs) {
    const size = JSON.stringify(msg).length;
    if ((currentBytes > 0) && ((currentBytes + size) > maxBytes)) {
      push();
    }
    current.msgs.push(msg);
    currentBytes += size;
  }

  push();

  if (chunks.length === 0) {
    chunks.push({ msgs: [], folders: [] });
  }

  return chunks.map((chunk, index) => ({
    kind: 'restore-snapshot' as const,
    mode: input.mode,
    snapshotTs: input.snapshotTs,
    restoreId: input.restoreId,
    part: index + 1,
    of: chunks.length,
    ...(chunk.msgs.length > 0 && { msgs: chunk.msgs }),
    ...(chunk.folders.length > 0 && { folders: chunk.folders }),
    // Only in the LAST chunk, and only in `replace`.
    ...((index === chunks.length - 1) && input.deleted && { deleted: input.deleted }),
  }));
}

/**
 * Turns the archive's messages into the entries a snapshot carries, applying the
 * rule of the CARRIER.
 *
 * > A record travels when, and only when, the receiver has no other way of
 * > getting it.
 *
 * For outgoing mail and drafts there is no other way, ever. For an incoming
 * message there normally is - the message itself, in the shared inbox - and then
 * only the two aspects the server knows nothing about travel: whether the user
 * read it and where they put it. The exception is the message the user has since
 * deleted off the server: nothing can be read for it any more, so the record
 * goes along with `noServerCopy`, which tells the receiver not to spend a
 * `getMsg` on it and, more to the point, not to bury the entry in the orphan
 * buffer where it would die of old age.
 *
 * Pure, so that the rule can be pinned down by a table rather than by a live run.
 */
export function snapshotEntriesOf(
  msgs: RestorableMsg[],
  serverMsgIds: ReadonlySet<string>,
): SnapshotMsgEntry[] {
  return msgs.map(entry => {
    if (!entry.incoming) {
      return {
        msgId: entry.msgId,
        incoming: false,
        record: entry.record,
        versions: entry.versions,
      };
    }

    if (serverMsgIds.has(entry.msgId)) {
      return {
        msgId: entry.msgId,
        incoming: true,
        ...(entry.record?.read !== undefined && { read: entry.record.read }),
        ...(entry.record?.placement && { placement: entry.record.placement }),
        versions: entry.versions,
      };
    }

    return {
      msgId: entry.msgId,
      incoming: true,
      record: entry.record && withUnreachableAttachments(entry.record),
      noServerCopy: true as const,
      versions: entry.versions,
    };
  });
}

/**
 * Marks every attachment of a record whose message is gone from the server as
 * having no local source.
 *
 * Necessary, and not tidiness: an `origin` attachment of an incoming message is
 * the one case attachmentsForPhantom() deliberately leaves UNMARKED, because its
 * bytes live in the shared inbox and are readable on every device. For a message
 * that is no longer in that inbox the premise is gone - the bytes are nowhere -
 * and an unmarked record would promise the receiver a file that can never be
 * opened. Marked, attachment-availability.ts says "the file is not here" instead.
 */
function withUnreachableAttachments(record: SyncedMsgRecord): SyncedMsgRecord {
  if (!record.attachmentsInfo?.length) {
    return record;
  }
  return {
    ...record,
    attachmentsInfo: record.attachmentsInfo.map(item => ({ ...item, hasNoLocalSource: true as const })),
  };
}
