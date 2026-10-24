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
// ONE function for both ends of a restore: the device the archive is restored
// on, and every other device of the user, which receives the same snapshot as
// phantoms and applies it here too.
//
// That is the only real guarantee that `merge` on a neighbour means what
// `merge` meant at the source. A second implementation of the rules - one for
// the archive, one for the wire - is how the two would come to disagree, and
// disagreement between a user's own devices is exactly what the whole
// synchronization design exists to prevent.
//
// It lives next to sync-versions.ts because it is expressed ENTIRELY in the
// rules that already live there: applyIfNewer, isDeletedLaterThan,
// isRecordDeletedLater, recordDeletion. A restore invents no merge rule of its
// own.
import type { ChatIdObj, ChatMessageId } from '../../../../types/asmail-msgs.types.ts';
import type {
  ChatMessageAttachmentsInfo,
  GroupChatStatus,
  MessageStatus,
  SingleChatStatus,
} from '../../../../types/chat.types.ts';
import type {
  BackedUpSyncToken,
  RestoreMode,
  SnapshotChatEntry,
  SnapshotDeletions,
  SnapshotMsgEntry,
} from '../../../../types/backup.types.ts';
import type {
  ChatSrvEmit,
  DB,
  FileStoreService,
  MsgDbEntry,
  SyncAspect,
} from '../../../types/index.ts';
import { isExpiredRecord, msgRowFromArchive } from '../../backup-service/backup-records.ts';
import {
  isTerminalStatus,
  removeMsgBytes,
  removeMsgDataNotInDB,
  statusForSyncedOutgoingMsg,
} from './_msgs-related-methods.ts';
import { isUniqueViolation } from '../../../dataset/utils.ts';
import {
  applyIfNewer,
  chatEntityId,
  isDeletedLaterThan,
  isHistoryClearedLater,
  isNewerToken,
  msgEntityId,
  recordDeletion,
  type SyncToken,
  type SyncVersionStore,
} from './sync-versions.ts';

export interface RestoreSnapshotInput {
  mode: RestoreMode;
  /**
   * HLC stamp the archive was taken at. Only used to stamp the deletions a
   * `replace` makes when the caller did not compute a fresher token; the merge
   * decisions themselves go by the per-aspect tokens carried with the records.
   */
  snapshotTs: number;
  chats: SnapshotChatEntry[];
  msgs: SnapshotMsgEntry[];
  /**
   * Only in `replace`: a fresh token, minted once for the whole restore, under
   * which a record forbidden by a `historyCleared` marker is brought back.
   *
   * It is minted by the restoring device and travels in the snapshot, because
   * every device applying that snapshot has to stamp the resurrected record
   * with the same token - see RestoreSnapshotSysMsgData.value.restoreToken.
   * Absent in `merge`, which resurrects nothing a tombstone forbids.
   */
  restoreToken?: BackedUpSyncToken;
  /** Only in `replace`, and under a token FRESHER than anything restored. */
  deleted?: SnapshotDeletions;
}

export interface RestoreSnapshotCtx {
  db: DB;
  emit: ChatSrvEmit;
  filesStore: FileStoreService;
  ownAddr: string;
  /**
   * The device a restored record is attributed to. At the source that is this
   * device (so the record is NOT marked as living elsewhere); on a neighbour it
   * is the device the snapshot came from, exactly as handleRegularSync does.
   */
  sourceDeviceId: string;
  /** Whether this end holds the attachment bytes, i.e. is the restoring device. */
  hasLocalAttachmentBytes: boolean;
  /**
   * Message ids present in the shared inbox, as ONE listing made by the caller.
   * An archived `incomingMsgId` is written only when it is in here: a dead one
   * makes the GUI draw an attachment as openable (the components look at the
   * field's presence alone) rather than as "the file is not here".
   */
  inboxMsgIds: Set<string>;
  /** false means "not in the set" says nothing at all. */
  inboxListingAvailable: boolean;
  /** Injected by the specs; Date.now() otherwise. */
  now?: number;
  /**
   * Drains phantoms that buffered before a chat existed. Passed in rather than
   * imported: handle-incoming-sync.ts imports this module, and importing its
   * drain back would make a cycle of the two.
   */
  drainOrphanedForChat?: (chatId: ChatIdObj) => Promise<void>;
  onProgress?: (processed: number, total: number, currentItem?: string) => void;
}

export interface RestoreSnapshotResult {
  chatsCreated: number;
  chatsUpdated: number;
  messagesCreated: number;
  messagesUpdated: number;
  skipped: number;
  skippedExpired: number;
  chatsDeleted: number;
  messagesDeleted: number;
  /** Ids of stored attachments the rules found no use for; the caller drops them. */
  unusedAttachmentIds: string[];
}

const CHAT_ASPECTS: SyncAspect[] = ['name', 'settings', 'members', 'admins', 'status'];

export interface RestoreTombstoneVerdict {
  /** The record must not be (re)created, in this mode. */
  blocked: boolean;
  /**
   * A `historyCleared` marker is newer than the record. In `merge` that is the
   * whole reason it is blocked; in `replace` it does not block, but the record
   * then has to be stamped above the marker to stay.
   */
  overClearing: boolean;
}

/**
 * What the tombstones say about (re)creating one archived record.
 *
 * Exported, and the only place this is decided, because TWO callers need the
 * same verdict: the restore itself and `previewRestore`. The preview feeds the
 * numbers of the dialog shown before the most destructive action in the whole
 * feature, and one that counted records the restore then refuses would be a
 * promise broken every time a chat's history had ever been cleared - which is
 * exactly what it did before this was pulled out.
 */
export function tombstoneVerdictForRestore(
  db: SyncVersionStore,
  mode: RestoreMode,
  entry: Pick<SnapshotMsgEntry, 'chatId' | 'chatMessageId' | 'record' | 'versions'>,
): RestoreTombstoneVerdict {
  const { chatId, chatMessageId, record, versions } = entry;
  const newest = newestToken(versions, record.timestamp);

  // A tombstone of the record ITSELF is final in both modes: the user deleted
  // that one message, and no archive of an earlier state overrides a later,
  // narrower decision about it.
  if (isDeletedLaterThan(db, 'msg', msgEntityId(chatId, chatMessageId), newest)) {
    return { blocked: true, overClearing: false };
  }

  // The chat's `historyCleared` marker is where the two modes part.
  //
  // In `merge` it blocks records older than itself, and lets through those
  // newer - which is what keeps merge useful in a chat cleared long ago and
  // used since; treating the marker's mere presence as "skip everything" would
  // make merge restore nothing at all into such a chat.
  //
  // In `replace` it does not block. The mode's promise is that the state comes
  // to match the archive, and a user who clears a history and then
  // deliberately restores an archive that predates the clearing is asking for
  // exactly that. The asymmetry was anticipated where the rule itself lives
  // (see isRecordDeletedLater) and belongs here, in the restore.
  const overClearing = isHistoryClearedLater(db, chatId, newest);
  return { blocked: overClearing && (mode === 'merge'), overClearing };
}

function tokenOf(token: BackedUpSyncToken): SyncToken {
  return { ts: token.ts, deviceId: token.deviceId };
}

/**
 * Applies a whole snapshot - or one chunk of one - by the rules that already
 * govern a phantom.
 */
export async function applyRestoreSnapshot(
  input: RestoreSnapshotInput,
  ctx: RestoreSnapshotCtx,
): Promise<RestoreSnapshotResult> {
  const res: RestoreSnapshotResult = {
    chatsCreated: 0,
    chatsUpdated: 0,
    messagesCreated: 0,
    messagesUpdated: 0,
    skipped: 0,
    skippedExpired: 0,
    chatsDeleted: 0,
    messagesDeleted: 0,
    unusedAttachmentIds: [],
  };
  const now = ctx.now ?? Date.now();
  const total = input.chats.length + input.msgs.length;
  let processed = 0;

  for (const chat of input.chats) {
    await applyChat(chat, input.mode, ctx, res);
    processed += 1;
    ctx.onProgress?.(processed, total, chat.record.name);
  }

  for (const msg of input.msgs) {
    await applyMsg(msg, input.mode, now, input.restoreToken, ctx, res);
    processed += 1;
    ctx.onProgress?.(processed, total, msg.chatMessageId);
  }

  if (input.deleted) {
    await applyDeletions(input.deleted, ctx, res);
  }

  return res;
}

async function applyChat(
  entry: SnapshotChatEntry,
  mode: RestoreMode,
  ctx: RestoreSnapshotCtx,
  res: RestoreSnapshotResult,
): Promise<void> {
  const { db, emit } = ctx;
  const { chatId, record, versions } = entry;
  const entityId = chatEntityId(chatId);
  const existing = db.findChat(chatId);

  if (!existing) {
    // The chat's own creation carries no version - there is no `record` aspect
    // for a chat either - so a tombstone is the whole of the guard. The token
    // compared against it is the newest thing the archive says about the chat:
    // an old rename must not be able to resurrect a chat deleted since.
    const newest = newestToken(versions, record.createdAt, record.lastUpdatedAt);
    if (isDeletedLaterThan(db, 'chat', entityId, newest)) {
      res.skipped += 1;
      return;
    }

    // createdAt / lastUpdatedAt / settings are written HERE and only here.
    // They are not aspects - nothing in the app records a sync version for
    // them - and at creation they carry meaning an archive is the only source
    // of: how old the chat is, and where it sorts in the list.
    const created = record.isGroupChat
      ? await db.addGroupChatRecord({
          chatId: record.chatId,
          name: record.name,
          members: record.members,
          admins: record.admins,
          status: record.status,
          createdAt: record.createdAt,
          lastUpdatedAt: record.lastUpdatedAt,
          settings: record.settings,
        }).catch(async err => {
          // A malformed members/admins column costs ONE chat, not the archive.
          await w3n.log('error', `Restore skips chat ${record.chatId}: its record cannot be inserted`, err);
          return undefined;
        })
      : await db.addOTOChatRecord({
          peerCAddr: record.peerCAddr,
          peerAddr: record.peerAddr,
          name: record.name,
          status: record.status,
          createdAt: record.createdAt,
          lastUpdatedAt: record.lastUpdatedAt,
          settings: record.settings,
        }).catch(async err => {
          await w3n.log('error', `Restore skips chat ${record.peerCAddr}: its record cannot be inserted`, err);
          return undefined;
        });

    if (!created) {
      res.skipped += 1;
      return;
    }

    // The tokens travel with the record, so that a later phantom of a change
    // the archive already holds is recognized as stale rather than applied
    // twice.
    await writeAspectTokens(ctx, 'chat', entityId, versions);
    emit.chat.added(created);
    res.chatsCreated += 1;
    // A chat that has just come back may unblock phantoms that buffered while
    // it did not exist.
    await ctx.drainOrphanedForChat?.(chatId);
    return;
  }

  // `merge` never touches what is here. Not even an aspect whose archived token
  // is newer: the mode's promise is that it can destroy nothing, and a newer
  // token is still a statement about a state the user may have changed since.
  if (mode === 'merge') {
    res.skipped += 1;
    return;
  }

  let touched = false;
  for (const aspect of CHAT_ASPECTS) {
    const token = versions[aspect];
    if (!token) {
      continue;
    }
    const applied = await applyChatAspect(ctx, chatId, record, aspect, tokenOf(token));
    touched = touched || applied;
  }
  if (touched) {
    res.chatsUpdated += 1;
  } else {
    res.skipped += 1;
  }
}

async function applyChatAspect(
  ctx: RestoreSnapshotCtx,
  chatId: ChatIdObj,
  record: SnapshotChatEntry['record'],
  aspect: SyncAspect,
  token: SyncToken,
): Promise<boolean> {
  const { db, emit } = ctx;
  const entityId = chatEntityId(chatId);
  const isGroup = record.isGroupChat;

  // Exactly the methods handle-incoming-sync calls for the same aspect, so a
  // restored change and a synchronized one are indistinguishable afterwards.
  const update = async (): Promise<void> => {
    let updated;
    switch (aspect) {
      case 'name':
        updated = isGroup
          ? await db.updateGroupChatRecord(chatId.chatId, { name: record.name })
          : await db.updateOTOChatRecord(chatId.chatId, { name: record.name });
        break;
      case 'settings':
        updated = isGroup
          ? await db.updateGroupChatRecord(chatId.chatId, { settings: record.settings })
          : await db.updateOTOChatRecord(chatId.chatId, { settings: record.settings });
        break;
      case 'members':
        if (!isGroup) {
          return;
        }
        updated = await db.updateGroupChatRecord(chatId.chatId, { members: record.members });
        break;
      case 'admins':
        if (!isGroup) {
          return;
        }
        updated = await db.updateGroupChatRecord(chatId.chatId, { admins: record.admins });
        break;
      case 'status':
        updated = isGroup
          ? await db.updateGroupChatRecord(chatId.chatId, { status: record.status as GroupChatStatus })
          : await db.updateOTOChatRecord(chatId.chatId, { status: record.status as SingleChatStatus });
        break;
      default:
        return;
    }
    if (updated) {
      emit.chat.updated(updated);
    }
  };

  if (((aspect === 'members') || (aspect === 'admins')) && !isGroup) {
    return false;
  }

  return applyIfNewer({ db, entityType: 'chat', entityId, aspect, token }, update);
}

async function applyMsg(
  entry: SnapshotMsgEntry,
  mode: RestoreMode,
  now: number,
  /** Only a `replace` has one; see RestoreSnapshotInput.restoreToken. */
  restoreToken: BackedUpSyncToken | undefined,
  ctx: RestoreSnapshotCtx,
  res: RestoreSnapshotResult,
): Promise<void> {
  const { db, emit } = ctx;
  const { chatId, chatMessageId, record, versions, attachments } = entry;
  const entityId = msgEntityId(chatId, chatMessageId);
  const id: ChatMessageId = { chatId, chatMessageId };
  const existing = await db.getMessage(id);

  if (!existing) {
    // The chat has to exist first: a row of the messages table names its chat
    // in the primary key, and a record whose chat is not here would be
    // unreachable. Nothing is buffered - the chats of an archive are applied
    // before its messages, and a snapshot chunk that outruns its chat is
    // buffered by the incoming-sync path itself.
    if (!db.findChat(chatId)) {
      res.skipped += 1;
      return;
    }

    // The one place this is decided, shared with previewRestore so that the
    // dialog's numbers and what actually happens cannot drift apart.
    const { blocked, overClearing } = tombstoneVerdictForRestore(db, mode, entry);
    if (blocked) {
      res.skipped += 1;
      return;
    }

    if (isExpiredRecord(record, now)) {
      // Restoring one is work with a negative result: the next start's
      // deleteExpiredMessages removes it without a word, auto-deletion not
      // being synchronized. Counted, so that "the restore did nothing" has an
      // explanation.
      res.skippedExpired += 1;
      return;
    }

    const { resolved, usedLocalBytes, unused } = resolveAttachments(attachments, undefined, ctx);
    res.unusedAttachmentIds.push(...unused);

    const row = msgRowFromArchive(chatId, {
      ...record,
      incomingMsgId: incomingMsgIdToWrite(record, ctx),
      settings: settingsForRestoredRecord(record, usedLocalBytes, ctx),
    }, resolved);

    try {
      await db.addMessage(row);
    } catch (err) {
      // The inbox dispatcher can insert the very same record in parallel; that
      // is a race won by whoever got there first, not a failure.
      if (!isUniqueViolation(err as Error, 'chatMessageId')) {
        throw err;
      }
      res.skipped += 1;
      return;
    }

    // A record brought back OVER a clearing marker is stamped with the
    // restore's own fresh token, and this is not decoration: the marker stays
    // where it is, so without a token newer than it the resurrection lasts only
    // until the clearing phantom is replayed - and it is replayed, by every
    // catch-up scan for as long as it sits in the shared inbox. The token comes
    // from the snapshot rather than from this device's clock so that every
    // device applying the same snapshot writes the same version.
    await writeAspectTokens(
      ctx,
      'msg',
      entityId,
      (overClearing && restoreToken) ? tokensAtLeast(versions, restoreToken) : versions,
    );
    emit.message.added(row);
    res.messagesCreated += 1;
    return;
  }

  // Bytes and reachability are decided in BOTH modes, and without a token:
  // availability is not an aspect. An aspect is something two devices can
  // disagree about, and no other device is in a position to claim that the
  // bytes are not on THIS one. It matters more here than anywhere else,
  // because a phantom never carries bytes at all - so under the aspect rules a
  // restore would fail to bring back precisely the one thing synchronization
  // cannot.
  const bytesTouched = await reconcileAvailability(existing, entry, ctx, res);

  if (mode === 'merge') {
    if (bytesTouched) {
      res.messagesUpdated += 1;
    } else {
      res.skipped += 1;
    }
    return;
  }

  let touched = bytesTouched;

  const bodyToken = versions.body;
  if (bodyToken) {
    const applied = await applyIfNewer(
      { db, entityType: 'msg', entityId, aspect: 'body', token: tokenOf(bodyToken) },
      async () => {
        const updated = await db.updateMessageRecord(id, {
          body: record.body,
          // The edit journal belongs with the body it describes.
          ...(record.history && { history: record.history }),
        });
        if (updated) {
          emit.message.updated(updated);
        }
      },
    );
    touched = touched || applied;
  }

  const reactionsToken = versions.reactions;
  if (reactionsToken) {
    const applied = await applyIfNewer(
      { db, entityType: 'msg', entityId, aspect: 'reactions', token: tokenOf(reactionsToken) },
      async () => {
        const updated = await db.updateMessageRecord(id, { reactions: record.reactions });
        if (updated) {
          emit.message.updated(updated);
        }
      },
    );
    touched = touched || applied;
  }

  const statusToken = versions.status;
  if (statusToken && record.status) {
    const archived = statusForRestoredRecord(record.status, ctx);
    // A terminal status is never pulled back to a non-terminal one, on top of
    // the ordering the token already gives: sending is over, and no archive is
    // a source for what happened afterwards.
    if (!(isTerminalStatus(existing.status) && !isTerminalStatus(archived))) {
      const applied = await applyIfNewer(
        { db, entityType: 'msg', entityId, aspect: 'status', token: tokenOf(statusToken) },
        async () => {
          const updated = await db.updateMessageStatus(id, archived);
          if (updated) {
            emit.message.updated(updated);
          }
        },
      );
      touched = touched || applied;
    }
  }

  // `timestamp`, `removeAfter`, `relatedMessage`, `isIncomingMsg` and
  // `groupSender` are deliberately left alone on an existing record: they are
  // not aspects, and this is the same boundary handle-incoming-sync holds.

  if (touched) {
    res.messagesUpdated += 1;
  } else {
    res.skipped += 1;
  }
}

/**
 * Fills in what an existing record is missing and nothing else: the ids of
 * attachment bytes that are now in the local store, and a reachable
 * `incomingMsgId`.
 */
async function reconcileAvailability(
  existing: MsgDbEntry,
  entry: SnapshotMsgEntry,
  ctx: RestoreSnapshotCtx,
  res: RestoreSnapshotResult,
): Promise<boolean> {
  const { db, emit } = ctx;
  const id: ChatMessageId = { chatId: entry.chatId, chatMessageId: entry.chatMessageId };
  const toUpdate: Partial<MsgDbEntry> = {};

  const { resolved, usedLocalBytes, unused, changed } = resolveAttachments(
    entry.attachments,
    existing.attachments,
    ctx,
  );
  res.unusedAttachmentIds.push(...unused);
  if (changed) {
    toUpdate.attachments = resolved;
  }

  if (usedLocalBytes && existing.settings?.msgOwnersDeviceId) {
    // The record no longer lives only elsewhere: its bytes are here now, and
    // the marking is what keeps deletion from clearing them (see removeMsgBytes).
    const { msgOwnersDeviceId: _dropped, ...rest } = existing.settings;
    toUpdate.settings = rest;
  }

  const incomingMsgId = incomingMsgIdToWrite(entry.record, ctx);
  if (existing.isIncomingMsg && !existing.incomingMsgId && incomingMsgId) {
    toUpdate.incomingMsgId = incomingMsgId;
  }

  if (Object.keys(toUpdate).length === 0) {
    return false;
  }

  const updated = await db.updateMessageRecord(id, toUpdate);
  if (updated) {
    emit.message.updated(updated);
  }
  return true;
}

/**
 * Merges what the snapshot says about attachments with what is here.
 *
 * The archived `id` is NEVER reused: it points into the file store of the
 * device the archive was taken on and can collide with a local one. What is
 * used is the id the window created when it wrote the bytes back - which the
 * caller has already put into the incoming list.
 */
function resolveAttachments(
  incoming: ChatMessageAttachmentsInfo[] | undefined,
  local: ChatMessageAttachmentsInfo[] | null | undefined,
  ctx: RestoreSnapshotCtx,
): {
  resolved: ChatMessageAttachmentsInfo[] | null;
  usedLocalBytes: boolean;
  unused: string[];
  changed: boolean;
} {
  const unused: string[] = [];

  if (!incoming?.length) {
    return { resolved: local?.length ? local : null, usedLocalBytes: false, unused, changed: false };
  }

  // A brand-new record takes the list as it came: an id is present only when
  // this end wrote those bytes (hasLocalAttachmentBytes), and a neighbour's
  // copy carries none by construction.
  if (!local?.length) {
    const usedLocalBytes = ctx.hasLocalAttachmentBytes && incoming.some(item => !!item.id);
    return { resolved: incoming, usedLocalBytes, unused, changed: true };
  }

  let usedLocalBytes = false;
  let changed = false;
  const resolved = local.map((localItem, index) => {
    const incomingItem = incoming[index];
    if (!incomingItem?.id) {
      return localItem;
    }
    if (localItem.id) {
      // There are bytes here already; the ones just written are an orphan.
      unused.push(incomingItem.id);
      return localItem;
    }
    changed = true;
    usedLocalBytes = true;
    const { hasNoLocalSource: _h, originDeviceId: _o, ...rest } = localItem;
    return { ...rest, id: incomingItem.id };
  });

  // Ids beyond the local list's length have nothing to attach to: the record
  // here says it has fewer files than the archive does, and rewriting the list
  // would be changing the record rather than filling in its availability.
  for (let i = local.length; i < incoming.length; i += 1) {
    const id = incoming[i]?.id;
    if (id) {
      unused.push(id);
    }
  }

  return { resolved, usedLocalBytes, unused, changed };
}

/**
 * An archived `incomingMsgId`, but only when the shared inbox still holds it.
 *
 * A dead one is worse than none: the message components go by the presence of
 * the field alone, so the attachments would be drawn as openable and fail on a
 * click. When the listing itself failed, "not in the set" says nothing, and the
 * field is kept - the same choice as trusting the archive.
 */
function incomingMsgIdToWrite(
  record: SnapshotMsgEntry['record'],
  ctx: RestoreSnapshotCtx,
): string | null {
  if (!record.isIncomingMsg || !record.incomingMsgId) {
    return null;
  }
  if (!ctx.inboxListingAvailable) {
    return record.incomingMsgId;
  }
  return ctx.inboxMsgIds.has(record.incomingMsgId) ? record.incomingMsgId : null;
}

/**
 * `settings` of a record being materialized.
 *
 * `msgOwnersDeviceId` says "the bytes of this record's files are on another
 * device", which is what stops a local deletion from trying to remove them. So
 * it is cleared when at least one file did land in this store, and set to the
 * announcing device on a neighbour - exactly as handleRegularSync does.
 */
function settingsForRestoredRecord(
  record: SnapshotMsgEntry['record'],
  usedLocalBytes: boolean,
  ctx: RestoreSnapshotCtx,
): MsgDbEntry['settings'] {
  const settings = { ...(record.settings ?? {}) };
  if (ctx.hasLocalAttachmentBytes && usedLocalBytes) {
    delete settings.msgOwnersDeviceId;
  } else if (!ctx.hasLocalAttachmentBytes) {
    settings.msgOwnersDeviceId = ctx.sourceDeviceId;
  }
  return Object.keys(settings).length > 0 ? settings : null;
}

/**
 * A restored status. On a neighbour a non-terminal one becomes 'syncing_self',
 * as it does for any synchronized outgoing record: no device but the sender's
 * takes part in sending, so it cannot show a status it could not influence.
 */
function statusForRestoredRecord(
  status: MessageStatus,
  ctx: RestoreSnapshotCtx,
): MessageStatus {
  return ctx.hasLocalAttachmentBytes ? status : statusForSyncedOutgoingMsg(status);
}

async function applyDeletions(
  deleted: SnapshotDeletions,
  ctx: RestoreSnapshotCtx,
  res: RestoreSnapshotResult,
): Promise<void> {
  const { db, emit, filesStore } = ctx;
  const token = tokenOf(deleted.token);

  for (const id of deleted.msgIds ?? []) {
    await recordDeletion(db, 'msg', msgEntityId(id.chatId, id.chatMessageId), token);
    const msg = await db.getMessage(id);
    if (msg) {
      // The same removal a local deletion makes: the row, the inbox message an
      // incoming record was built from, and the bytes of an outgoing one.
      await removeMsgBytes(db, filesStore, id, msg);
      emit.message.removed(id);
      res.messagesDeleted += 1;
    }
  }

  for (const chatId of deleted.chatIds ?? []) {
    await recordDeletion(db, 'chat', chatEntityId(chatId), token);
    if (!db.findChat(chatId)) {
      continue;
    }
    const refs = await db.deleteChat(chatId);
    if (refs) {
      await removeMsgDataNotInDB(refs, filesStore);
    }
    emit.chat.removed(chatId);
    res.chatsDeleted += 1;
  }
}

/**
 * The archived tokens, with every aspect raised to at least `floor`.
 *
 * Used by a `replace` that brings a record back over a clearing marker: the
 * record has to end up newer than that marker, and the archive's own tokens
 * are by definition older than it. An archive with no versions at all - a
 * record written straight into a database, which is what the specs seed - gets
 * `body`, the aspect a record's content belongs to, so that there is something
 * for the marker to be compared against at all.
 */
function tokensAtLeast(
  versions: Partial<Record<SyncAspect, BackedUpSyncToken>>,
  floor: BackedUpSyncToken,
): Partial<Record<SyncAspect, BackedUpSyncToken>> {
  const entries = Object.entries(versions) as [SyncAspect, BackedUpSyncToken][];
  if (entries.length === 0) {
    return { body: floor };
  }
  return Object.fromEntries(
    entries.map(([aspect, token]) => [aspect, (token.ts >= floor.ts) ? token : floor]),
  ) as Partial<Record<SyncAspect, BackedUpSyncToken>>;
}

/**
 * Records the tokens a restored entity came with, in one batched write.
 *
 * Recorded even for a creation, which itself has no version: without them the
 * next phantom of a change the archive already holds would look newer than
 * anything stored and be applied a second time.
 */
async function writeAspectTokens(
  ctx: RestoreSnapshotCtx,
  entityType: 'chat' | 'msg',
  entityId: string,
  versions: Partial<Record<SyncAspect, BackedUpSyncToken>>,
): Promise<void> {
  const writes = Object.entries(versions)
    .filter(([, token]) => !!token)
    .map(([aspect, token]) => ({
      entityType,
      entityId,
      aspect: aspect as SyncAspect,
      ts: token!.ts,
      deviceId: token!.deviceId,
    }));
  await ctx.db.setSyncVersions(writes);
}

/**
 * The newest thing the snapshot says about an entity, used against a tombstone.
 *
 * Creation of a chat and of a record writes no version at all in this app, so
 * the tokens alone would understate the age of everything an archive holds -
 * and a tombstone older than the archive would win over it.
 */
function newestToken(
  versions: Partial<Record<SyncAspect, BackedUpSyncToken>>,
  ...wallClockStamps: number[]
): SyncToken {
  let newest: SyncToken | undefined;
  for (const token of Object.values(versions)) {
    if (token && isNewerToken(tokenOf(token), newest)) {
      newest = tokenOf(token);
    }
  }
  const stamp = Math.max(0, ...wallClockStamps);
  if (!newest || (stamp > newest.ts)) {
    // No device id to speak of - the stamp is a wall-clock one and belongs to
    // no particular change - so an empty one, which loses every tie. Losing a
    // tie means the tombstone wins, which is the safe way round.
    return { ts: stamp, deviceId: newest?.deviceId ?? '' };
  }
  return newest;
}
