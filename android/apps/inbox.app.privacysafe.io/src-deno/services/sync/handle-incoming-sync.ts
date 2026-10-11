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

/**
 * The receiving half of synchronization: what a phantom from another device of
 * this user does to local state.
 */

import type {
  IncomingMessage,
  IncomingMessageView,
  MailFolder,
  OutgoingMessageView,
} from '../../../src/common/types/mail.types.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';
import type { DBProvider } from '../../dataset/index.ts';
import type { InboxEmit } from '../inbox-service/events.ts';
import {
  isMailSyncMsg,
  isMailSyncMsgV2,
  type MailSyncEvent,
  type MailSyncEventV2,
  type MailSyncMsg,
  type MailSyncMsgV2,
  type SnapshotMsgEntry,
} from '../../types/mail-sync.types.ts';
import type { SyncToken } from '../../types/sync-types.ts';
import {
  applyDelivery,
  applyPlacement,
  applyRead,
  isIncomingMsg,
  type MsgView,
} from './msg-aspects.ts';
import { applyRecordContent, msgFromSyncedRecord } from './record-mapping.ts';
import { bufferOrphanedSync, drainOrphansFor } from './orphan-buffer.ts';
import { applyRestoreSnapshot } from './restore-snapshot.ts';
import { applyIfNewer, isDeletedLaterThan, recordDeletion } from './sync-versions.ts';

const log = makeLogger('SyncIncoming');

export interface IncomingSyncCtx {
  db: DBProvider;
  /** This user's own address; a phantom from anybody else is not a phantom. */
  ownAddr: string;
  /**
   * Folder changes are reported through this. Message changes go through
   * applyMsgChanges instead, which emits their events itself.
   */
  emit: InboxEmit;
  /**
   * Writes records and emits their events - the same helper a local change goes
   * through, so that the GUI cannot tell the two paths apart.
   */
  applyMsgChanges(changes: MsgView[]): Promise<void>;
  /**
   * Deletes messages with the file GC, under the token of the deletion that came
   * in the phantom. Queues no phantom of its own.
   */
  deleteMessages(msgIds: string[], token: SyncToken): Promise<void>;
  /** Stores a message pulled out of the shared inbox; checks the tombstone itself. */
  persistIncoming(msg: IncomingMessage): Promise<void>;
  /**
   * msgIds this session has already tried to pull out of the inbox. One attempt
   * per id: a message that is not there will not appear because it was asked for
   * twice.
   */
  pulledMsgIds: Set<string>;
  /**
   * The window in which per-record changes are not reported one by one.
   *
   * Only a restore snapshot uses it: one chunk carries up to
   * RESTORE_SNAPSHOT_CHUNK_BYTES of records, and reporting each of them walks a
   * row through its history in front of the user. An ordinary phantom is one
   * change and is reported as one.
   */
  beginBulkReplay?(): void;
  endBulkReplay?(): void;
}

/**
 * The whole path of an inbox message claiming to be a phantom, with the checks
 * in the order that matters.
 *
 * @returns true when the message was handled, i.e. its deliveryTS may be
 *          counted into the watermark.
 */
export async function handleIncomingSyncEnvelope(
  msg: web3n.asmail.IncomingMessage,
  ctx: IncomingSyncCtx,
): Promise<boolean> {
  const { db, ownAddr } = ctx;

  // First, because it is cheap and because it is the only check standing between
  // this database and somebody else's input. A message of this type from another
  // address is not a phantom but a forged one: nothing is applied, and nothing
  // is removed either - it is not ours to remove.
  if (msg.sender !== ownAddr) {
    log.warn(
      `An inbox message ${msg.msgId} of the synchronization type came from ${msg.sender}, `
        + `not from this user; ignoring it.`,
    );
    return true;
  }

  const body = (msg as { jsonBody?: unknown }).jsonBody;
  if (!isMailSyncMsg(body)) {
    // Deferred removal rather than immediate, and here this deliberately
    // diverges from chat.app. The format is new, and its first extension (v2)
    // gives the situation "an older build on device A did not understand device
    // B's phantom and took it away from device C". Fifteen days of inbox space
    // for an unread phantom is cheap; a lost change is not.
    log.warn(`Cannot read the body of a synchronization message ${msg.msgId}; ignoring it.`);
    await db.scheduleInboxMsgRemoval(msg.msgId);
    return true;
  }

  const syncMsg = body;

  if (syncMsg.sourceDeviceId === db.getAppDeviceId()) {
    // This device's own echo: the change was applied locally when the phantom
    // was queued. Not applied again - and not removed either, since the inbox is
    // shared and the other devices still need it.
    //
    // The device id is printed rather than implied by the branch: two copies of
    // the app on one data folder share it, every phantom then looks "own" on
    // both, and from the outside that is indistinguishable from broken
    // synchronization.
    log.debug(
      `Own echo of a ${syncMsg.event.kind} phantom (device ${syncMsg.sourceDeviceId}, `
        + `stamp ${syncMsg.timestamp}); scheduling removal of ${msg.msgId} from the inbox.`,
    );
    await db.scheduleInboxMsgRemoval(msg.msgId);
    return true;
  }

  // Before anything is applied: the fact of receiving this is itself the proof
  // that the user has another device.
  await db.noteOtherDeviceSeen(syncMsg.sourceDeviceId);
  // Only on a first receipt, never on a drain of the buffer - hence the split
  // between this function and dispatchSync().
  db.observeSyncStamp(syncMsg.timestamp);

  await dispatchSync(syncMsg, ctx);

  log.info(
    `Applied a ${syncMsg.event.kind} phantom from device ${syncMsg.sourceDeviceId} `
      + `(stamp ${syncMsg.timestamp}); scheduling removal of ${msg.msgId} from the inbox.`,
  );
  await db.scheduleInboxMsgRemoval(msg.msgId);
  return true;
}

/**
 * Applies a phantom's event, and nothing else.
 *
 * Separate from handleIncomingSyncEnvelope on purpose: a drain of the orphan
 * buffer calls this one, and a replay must not observe the clock stamp a second
 * time nor schedule the inbox removal again.
 */
export async function dispatchSync(syncMsg: MailSyncMsg, ctx: IncomingSyncCtx): Promise<void> {
  const token: SyncToken = { ts: syncMsg.timestamp, deviceId: syncMsg.sourceDeviceId };

  if (isMailSyncMsgV2(syncMsg)) {
    await dispatchSyncV2(syncMsg, ctx);
    return;
  }

  const { event } = syncMsg;

  switch (event.kind) {
    case 'msg-record':
      await applyMsgRecord(event, token, ctx);
      return;
    case 'msg-read':
      await applyMsgRead(event, token, syncMsg, ctx);
      return;
    case 'msg-placement':
      await applyMsgPlacement(event, token, syncMsg, ctx);
      return;
    case 'msg-delivery':
      await applyMsgDelivery(event, token, syncMsg, ctx);
      return;
    case 'msg-deleted':
      await applyMsgDeleted(event, token, ctx);
      return;
    case 'folder-record':
      await applyFolderRecord(event, token, ctx);
      return;
    case 'folder-deleted':
      await applyFolderDeleted(event, token, ctx);
      return;
    default:
      log.warn(`A synchronization phantom of an unknown kind: ${JSON.stringify(event)}`);
  }
}

/**
 * The v2 events - today, one chunk of a restore snapshot.
 *
 * Applied by applyRestoreSnapshot(), the SAME function the restoring device
 * runs. One function on both ends is the only real guarantee that `merge` here
 * means what `merge` meant there; two implementations of one rule would part
 * ways on the first case nobody thought of.
 */
async function dispatchSyncV2(syncMsg: MailSyncMsgV2, ctx: IncomingSyncCtx): Promise<void> {
  const { event } = syncMsg;
  if (event.kind !== 'restore-snapshot') {
    log.warn(`A v2 synchronization phantom of an unknown kind: ${JSON.stringify(event)}`);
    return;
  }

  ctx.beginBulkReplay?.();
  try {
    await applySnapshotChunk(syncMsg, event, ctx);
  } finally {
    ctx.endBulkReplay?.();
  }
}

async function applySnapshotChunk(
  syncMsg: MailSyncMsgV2,
  event: Extract<MailSyncEventV2, { kind: 'restore-snapshot' }>,
  ctx: IncomingSyncCtx,
): Promise<void> {
  const { db } = ctx;
  const res = await applyRestoreSnapshot(
    {
      mode: event.mode,
      snapshotTs: event.snapshotTs,
      sourceDeviceId: syncMsg.sourceDeviceId,
      msgs: event.msgs,
      folders: event.folders,
      deleted: event.deleted,
    },
    {
      db,
      emit: ctx.emit,
      applyMsgChanges: changes => ctx.applyMsgChanges(changes),
      deleteMessages: (msgIds, token) => ctx.deleteMessages(msgIds, token),
      // A receiving device does not list the inbox for a snapshot: the sender
      // already did, and what it found is in the entries themselves.
      serverMsgIds: new Set<string>(),
      serverListingAvailable: false,
      ensureIncomingRecord: (msgId, entry) =>
        ensureSnapshotRecordFor(msgId, entry, syncMsg, event, ctx),
    },
  );

  log.info(
    `Applied part ${event.part}/${event.of} of restore ${event.restoreId} (${event.mode}) from `
      + `device ${syncMsg.sourceDeviceId}: ${res.created} created, ${res.updated} updated, `
      + `${res.skipped} skipped, ${res.deletedMsgs} message(s) and ${res.deletedFolders} `
      + `folder(s) deleted, ${res.onlyInArchive} kept only by the archive.`,
  );
}

/**
 * The record of an incoming message a snapshot entry did not carry.
 *
 * The entry says the message is in the shared inbox, so one `getMsg` is all it
 * takes - the same reasoning as ensureRecordFor(). What differs is the failure:
 * buffering the WHOLE chunk once per unreadable entry would put up to 192 KB in
 * the orphan table per message, so what is buffered is a one-entry snapshot of
 * the same restore. It drains when the message shows up, and it carries the same
 * tokens, so it applies to exactly the same effect.
 */
async function ensureSnapshotRecordFor(
  msgId: string,
  entry: SnapshotMsgEntry,
  syncMsg: MailSyncMsgV2,
  event: Extract<MailSyncEventV2, { kind: 'restore-snapshot' }>,
  ctx: IncomingSyncCtx,
): Promise<MsgView | undefined> {
  const { db } = ctx;
  const existing = db.getMessageById(msgId);
  if (existing) {
    return existing;
  }

  if (!ctx.pulledMsgIds.has(msgId)) {
    ctx.pulledMsgIds.add(msgId);
    const raw = await w3n.mail?.inbox.getMsg(msgId).catch(err => {
      log.warn(`Could not pull message ${msgId} out of the inbox for a restore snapshot`, err);
      return undefined;
    });
    if (raw) {
      await ctx.persistIncoming(raw as IncomingMessage);
      const pulled = db.getMessageById(msgId);
      if (pulled) {
        return pulled;
      }
    }
  }

  const oneEntry: MailSyncMsgV2 = {
    v: 2,
    sourceDeviceId: syncMsg.sourceDeviceId,
    timestamp: syncMsg.timestamp,
    event: {
      kind: 'restore-snapshot',
      mode: event.mode,
      snapshotTs: event.snapshotTs,
      restoreId: event.restoreId,
      part: event.part,
      of: event.of,
      msgs: [entry],
    },
  };
  await bufferOrphanedSync(db, msgId, oneEntry);
  return undefined;
}

// =============================================================================
// Messages
// =============================================================================

async function applyMsgRecord(
  event: Extract<MailSyncEvent, { kind: 'msg-record' }>,
  token: SyncToken,
  ctx: IncomingSyncCtx,
): Promise<void> {
  const { db } = ctx;
  const { msgId, record } = event;

  if (isDeletedLaterThan(db, 'msg', msgId, token)) {
    log.debug(`Not applying a record of ${msgId}: it was deleted later than this change.`);
    return;
  }

  const existing = db.getMessageById(msgId);

  if (!existing) {
    const created = msgFromSyncedRecord(msgId, record, token.deviceId);
    await ctx.applyMsgChanges([created]);
    // One token for every aspect the snapshot carries. Nothing else can hold a
    // version of this entity: without a record, an aspect phantom is buffered
    // rather than applied, and a deletion drops the versions it does not keep.
    for (const aspect of ['content', 'delivery', 'placement'] as const) {
      await db.setSyncVersion('msg', msgId, aspect, token);
    }
    if (record.read !== undefined) {
      await db.setSyncVersion('msg', msgId, 'read', token);
    }
    await drainOrphansFor(db, msgId, sync => dispatchSync(sync, ctx));
    return;
  }

  // Each aspect through its own applyIfNewer, so that a later pointed change of
  // one of them does not lose to this snapshot. Unlike chat.app, an existing
  // record IS overwritten: a draft is edited many times, and 'content' has to be
  // a rewritable aspect under LWW - otherwise an edit made on a phone never
  // reaches a desktop that once saw the draft's first version.
  let next: MsgView = existing;
  let changed = false;
  const step = (updated: MsgView) => {
    next = updated;
    changed = true;
  };
  const incoming = isIncomingMsg(existing);

  await applyIfNewer({ db, entityType: 'msg', entityId: msgId, aspect: 'content', token },
    async () => step(applyRecordContent(next, record)));

  // Delivery before placement: placement's 'home' is worked out from the
  // record's status, which delivery is what sets.
  if (!incoming) {
    await applyIfNewer({ db, entityType: 'msg', entityId: msgId, aspect: 'delivery', token },
      async () => step(applyDelivery(next, record.delivery)));
  }

  await applyIfNewer({ db, entityType: 'msg', entityId: msgId, aspect: 'placement', token },
    async () => step(applyPlacement(next, record.placement)));

  if (incoming && (record.read !== undefined)) {
    await applyIfNewer({ db, entityType: 'msg', entityId: msgId, aspect: 'read', token },
      async () => step(applyRead(next, record.read!)));
  }

  if (changed) {
    await ctx.applyMsgChanges([next]);
  }
}

/**
 * Makes sure a record for this message is here, pulling the message out of the
 * shared inbox if it is not.
 *
 * This is what stands in for chat.app's `resync:msg-record`, and it is a better
 * fit because the carrier of an incoming record cannot be lost here: it is the
 * message itself, in an inbox this device has direct access to. Instead of "ask a
 * neighbour, if it is awake and has budget left, and wait for an answer" - one
 * getMsg. No ASMail traffic, no request/response protocol, works with every
 * other device switched off. The one case it cannot cover is a message already
 * removed from the server, where a resync would not have helped either.
 *
 * @returns the record, or undefined - in which case the phantom was buffered.
 */
async function ensureRecordFor(
  msgId: string,
  isIncomingMessage: boolean,
  syncMsg: MailSyncMsg,
  ctx: IncomingSyncCtx,
): Promise<IncomingMessageView | OutgoingMessageView | undefined> {
  const { db } = ctx;
  const existing = db.getMessageById(msgId);
  if (existing) {
    return existing;
  }

  if (isIncomingMessage && !ctx.pulledMsgIds.has(msgId)) {
    ctx.pulledMsgIds.add(msgId);
    const raw = await w3n.mail?.inbox.getMsg(msgId).catch(err => {
      log.warn(`Could not pull message ${msgId} out of the inbox`, err);
      return undefined;
    });
    if (raw) {
      await ctx.persistIncoming(raw as IncomingMessage);
      const pulled = db.getMessageById(msgId);
      if (pulled) {
        return pulled;
      }
    }
  }

  await bufferOrphanedSync(db, msgId, syncMsg);
  return undefined;
}

async function applyMsgRead(
  event: Extract<MailSyncEvent, { kind: 'msg-read' }>,
  token: SyncToken,
  syncMsg: MailSyncMsg,
  ctx: IncomingSyncCtx,
): Promise<void> {
  const { db } = ctx;
  const changes: MsgView[] = [];

  for (const msgId of event.msgIds) {
    if (isDeletedLaterThan(db, 'msg', msgId, token)) {
      continue;
    }
    // Every id in a read event is of an incoming message by definition.
    const existing = await ensureRecordFor(msgId, true, syncMsg, ctx);
    if (!existing) {
      continue;
    }
    await applyIfNewer({ db, entityType: 'msg', entityId: msgId, aspect: 'read', token },
      async () => {
        changes.push(applyRead(existing, event.read));
      });
  }

  if (changes.length > 0) {
    await ctx.applyMsgChanges(changes);
  }
}

async function applyMsgPlacement(
  event: Extract<MailSyncEvent, { kind: 'msg-placement' }>,
  token: SyncToken,
  syncMsg: MailSyncMsg,
  ctx: IncomingSyncCtx,
): Promise<void> {
  const { db } = ctx;
  const incomingIds = new Set(event.incoming ?? []);
  const changes: MsgView[] = [];

  for (const msgId of event.msgIds) {
    if (isDeletedLaterThan(db, 'msg', msgId, token)) {
      continue;
    }
    const existing = await ensureRecordFor(msgId, incomingIds.has(msgId), syncMsg, ctx);
    if (!existing) {
      continue;
    }
    await applyIfNewer({ db, entityType: 'msg', entityId: msgId, aspect: 'placement', token },
      async () => {
        changes.push(applyPlacement(existing, event.placement));
      });
  }

  if (changes.length > 0) {
    await ctx.applyMsgChanges(changes);
  }
}

async function applyMsgDelivery(
  event: Extract<MailSyncEvent, { kind: 'msg-delivery' }>,
  token: SyncToken,
  syncMsg: MailSyncMsg,
  ctx: IncomingSyncCtx,
): Promise<void> {
  const { db } = ctx;
  const { msgId } = event;

  if (isDeletedLaterThan(db, 'msg', msgId, token)) {
    return;
  }

  // An outcome of sending is always about an outgoing message, whose only
  // carrier is its own `msg-record` phantom: there is nothing to pull out of the
  // inbox, so a missing record means waiting.
  const existing = await ensureRecordFor(msgId, false, syncMsg, ctx);
  if (!existing) {
    return;
  }

  await applyIfNewer({ db, entityType: 'msg', entityId: msgId, aspect: 'delivery', token },
    async () => ctx.applyMsgChanges([applyDelivery(existing, event.delivery)]));
}

async function applyMsgDeleted(
  event: Extract<MailSyncEvent, { kind: 'msg-deleted' }>,
  token: SyncToken,
  ctx: IncomingSyncCtx,
): Promise<void> {
  const { db } = ctx;

  // No buffering here, and none needed: a tombstone is recorded whether or not
  // there is a record to delete, so a deletion that outran its message is
  // remembered all the same.
  for (const msgId of event.msgIds) {
    await recordDeletion(db, 'msg', msgId, token);
  }
  await ctx.deleteMessages(event.msgIds, token);
}

// =============================================================================
// Folders
// =============================================================================

async function applyFolderRecord(
  event: Extract<MailSyncEvent, { kind: 'folder-record' }>,
  token: SyncToken,
  ctx: IncomingSyncCtx,
): Promise<void> {
  const { db } = ctx;
  const folder: MailFolder = event.folder;

  if (isDeletedLaterThan(db, 'folder', folder.id, token)) {
    return;
  }

  await applyIfNewer({ db, entityType: 'folder', entityId: folder.id, aspect: 'folderProps', token },
    async () => {
      await db.upsertFolder(folder);
      ctx.emit({ entity: 'folder', event: 'updated', folder });
    });
}

async function applyFolderDeleted(
  event: Extract<MailSyncEvent, { kind: 'folder-deleted' }>,
  token: SyncToken,
  ctx: IncomingSyncCtx,
): Promise<void> {
  const { db } = ctx;
  await recordDeletion(db, 'folder', event.folderId, token);
  const folder = db.getFolderById(event.folderId);
  if (folder) {
    await db.deleteFolder(folder);
    ctx.emit({ entity: 'folder', event: 'removed', folderId: event.folderId });
  }
}
