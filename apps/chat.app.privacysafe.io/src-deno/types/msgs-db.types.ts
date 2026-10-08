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
import type { ChatIdObj, ChatMessageId, RelatedMessage } from '../../types/asmail-msgs.types.ts';
import type {
  ChatMessageAttachmentsInfo,
  ChatMessageHistory,
  ChatMessageReaction,
  MessageStatus,
  MsgPageCursor,
} from '../../types/chat.types.ts';
import type { ChatSettings, GroupChatDbEntry, OTOChatDbEntry } from './chat-db.types.ts';

export interface MsgDbEntry {
  groupChatId: GroupChatDbEntry['chatId'] | null;
  otoPeerCAddr: OTOChatDbEntry['peerCAddr'] | null;
  chatMessageId: string;
  isIncomingMsg: boolean;
  incomingMsgId: string | null;
  groupSender: string | null;
  body: string | null;
  attachments: ChatMessageAttachmentsInfo[] | null;
  chatMessageType: 'regular' | 'system' | 'invitation';
  relatedMessage: RelatedMessage | null;
  status: MessageStatus | null;
  timestamp: number;
  history: ChatMessageHistory | null;
  reactions: Record<string, ChatMessageReaction> | null;
  settings?: ChatSettings | null;
  removeAfter: number;
}

export interface RefsToMsgsDataNoInDB {
  inboxMsgs: string[];
  outgoingMsgs: {
    chatMsgId: string;
    attachments: ChatMessageAttachmentsInfo[];
  }[];
}

export interface OrphanedMsgDbEntry {
  groupChatId: GroupChatDbEntry['chatId'] | null;
  otoPeerCAddr: OTOChatDbEntry['peerCAddr'] | null;
  incomingMsgId: string | null;
  targetMessageId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawPayload: any;
  bufferedAt: number;
}

/**
 * Entity kinds that carry per-aspect synchronization versions.
 */
export type SyncEntityType = 'chat' | 'msg';

/**
 * Parts of an entity that are synchronized (and therefore ordered)
 * independently of each other. A single version per record would let an
 * unrelated change (e.g. of a chat's members) make a newer change of another
 * part (e.g. its name) look stale.
 */
export type SyncAspect =
  | 'name'
  | 'settings'
  | 'members'
  | 'admins'
  | 'status'
  | 'body'
  | 'reactions'
  /** Tombstone of the entity itself. */
  | 'deleted'
  /**
   * Tombstone of a chat's whole history. Distinct from 'deleted': the chat
   * lives on, so this must not block updates of its other aspects - it only
   * keeps phantoms of messages predating the clearing from recreating them.
   */
  | 'historyCleared';

export interface SyncVersionDbEntry {
  ts: number;
  deviceId: string;
  tombstonedAt: number | null;
}

/**
 * A whole row of sync_versions, i.e. a version together with what it is a
 * version OF. Read only in bulk (getAllSyncVersions), where the key cannot be
 * implied by the query.
 */
export interface SyncVersionRow extends SyncVersionDbEntry {
  entityType: SyncEntityType;
  entityId: string;
  aspect: SyncAspect;
}

/**
 * A single version to record, as part of queueSyncPhantom().
 */
export interface SyncVersionWrite {
  entityType: SyncEntityType;
  entityId: string;
  aspect: SyncAspect;
  ts: number;
  deviceId: string;
  /**
   * When the entity was buried. Set on tombstones ('deleted') and on a
   * chat's 'historyCleared' marker - those rows outlive what they describe and
   * are the only ones collected by age.
   */
  tombstonedAt?: number;
  /**
   * Drops the entity's other aspect versions, as recordDeletion() does. Only
   * for the entity's own tombstone: a chat whose history was cleared lives on,
   * and its name, members and settings keep their versions.
   */
  dropOtherAspects?: boolean;
}

/**
 * What a queued phantom describes. Mirrors the aspect of the sync version it
 * comes with, plus 'record' for a phantom that carries an entity itself (a
 * message or an invitation) rather than a change of one of its aspects - those
 * are guarded by tombstones and have no version of their own.
 */
export type SyncPhantomAspect =
  | SyncAspect
  | 'record'
  /**
   * One chunk of a restore snapshot. Only SyncPhantomAspect is widened for it
   * and not SyncEntityType: the latter types sync_versions as well, and a value
   * added there would leak into every piece of the last-write-wins code. This
   * path writes no sync version at all - the restore has already written the
   * archived tokens.
   */
  | 'snapshot';

/**
 * An outgoing phantom, as written into the journal.
 *
 * payload is the JSON body of the phantom (a ChatSyncMsgV1), complete enough to
 * be handed to delivery as it is - which is what lets the releasing pass work
 * without knowing anything about what the phantom means. The descriptive
 * columns are for diagnostics ("which change hasn't been announced yet") and
 * are not read by the sending path.
 */
export interface PendingSyncMsgEntry {
  entityType: SyncEntityType;
  entityId: string;
  aspect: SyncPhantomAspect;
  ts: number;
  payload: string;
}

export interface PendingSyncMsgDbEntry extends PendingSyncMsgEntry {
  id: number;
  /** Failed releases so far - diagnostics only; a row is never dropped for it. */
  attempts: number;
}

export interface MsgsDb {
  /**
   * Resolves once all mutations made so far are in the database files. Writes
   * are batched (see dataset/db-writer.ts), so this is what callers use before
   * making a change observable outside this device.
   */
  flush(): Promise<void>;
  addMessage(msg: MsgDbEntry): Promise<void>;
  getMessage(id: ChatMessageId): Promise<MsgDbEntry | undefined>;
  /**
   * Whether a message row still points at this inbox message.
   *
   * True only for a message with attachments: those keep `incomingMsgId`, and
   * their inbox message stays on the server as the one carrier of the file
   * bytes. Asked before removing anything that was received earlier.
   */
  isMsgKeptForInboxMsg(incomingMsgId: string): boolean;
  /** Every row there is, oldest first. Read by a backup, and by nothing else. */
  getAllMessages(): MsgDbEntry[];
  countMessages(): number;
  countMessagesInChat(chatIdObj: ChatIdObj): number;
  getExpiredMessages(now: number): Promise<MsgDbEntry[]>;
  getMessagesByChat(chatIdObj: ChatIdObj): Promise<MsgDbEntry[]>;
  /**
   * Newest `limit` messages of the chat, or the ones directly preceding the
   * cursor, in ascending order.
   */
  getMessagesPageInChat(chatIdObj: ChatIdObj, limit: number, before?: MsgPageCursor): MsgDbEntry[];
  getNotRegularMessagesByChat(chatId: ChatIdObj): MsgDbEntry[];
  getMessagesWithSyncingSelfStatus(): MsgDbEntry[];
  getLatestIncomingMsgTimestamp(): number | undefined;
  getLatestIncomingMsgTimestampInChat(chatIdObj: ChatIdObj): number | undefined;
  getLatestMsgInChat(chatIdObj: ChatIdObj): MsgDbEntry | null;
  getUnreadMsgsCountIn(chatIdObj: ChatIdObj): number;
  getRecentReactions(quantity: number): Promise<string[]>;
  deleteMessage(chatMessageId: ChatMessageId): Promise<void>;
  deleteMessagesInChat(chatIdObj: ChatIdObj): Promise<RefsToMsgsDataNoInDB | undefined>;
  updateMessageRecord(
    chatMessageId: ChatMessageId,
    toUpdate: Partial<MsgDbEntry>,
  ): Promise<MsgDbEntry | undefined>;
  updateMessageStatus(chatMessageId: ChatMessageId, status: MessageStatus): Promise<MsgDbEntry | undefined>;

  addOrphanedMessage(data: OrphanedMsgDbEntry): Promise<void>;
  getStuckMessagesForTargetMessageId(targetMessageId: string): (OrphanedMsgDbEntry & { id: number })[];
  getStuckMessagesWithoutTarget(chatId: ChatIdObj): (OrphanedMsgDbEntry & { id: number })[];
  /**
   * Distinct (chat, message) targets of buffered phantoms - the records this
   * device is missing, i.e. the work-list of the start-up resync pass.
   */
  getStuckOrphanTargets(): { chatId: ChatIdObj; targetMessageId: string }[];
  /** How many phantoms wait in the buffer for a chat or a record to appear. */
  countOrphanedSyncs(): number;
  deleteOrphanedMessage(id: number): Promise<void>;
  collectGarbageInAuxiliaryDB(): Promise<void>;

  scheduleInboxMsgRemoval(msgId: string): Promise<void>;
  getDueInboxMsgRemovals(now: number): string[];
  clearInboxMsgRemovals(msgIds: string[]): Promise<void>;

  /**
   * Previews of this message's attachments that have already been made, by file
   * name. Making one needs the whole file, which for an attachment of an
   * incoming message means pulling it from the server, so they are kept rather
   * than remade.
   */
  getThumbnails(id: ChatMessageId): Record<string, string>;
  upsertThumbnail(id: ChatMessageId, fileName: string, dataUrl: string): Promise<void>;
  deleteThumbnails(id: ChatMessageId): Promise<void>;

  getSyncVersion(
    entityType: SyncEntityType,
    entityId: string,
    aspect: SyncAspect,
  ): SyncVersionDbEntry | undefined;
  setSyncVersion(
    entityType: SyncEntityType,
    entityId: string,
    aspect: SyncAspect,
    version: { ts: number; deviceId: string; tombstonedAt?: number },
  ): Promise<void>;
  /** Every row, tombstones included. Read by a backup, and by nothing else. */
  getAllSyncVersions(): SyncVersionRow[];
  /**
   * A batch of version writes, with one file write for the lot - what keeps a
   * restore from costing a write of the whole database per token.
   */
  setSyncVersions(writes: SyncVersionWrite[]): Promise<void>;
  deleteSyncVersionsOf(entityType: SyncEntityType, entityId: string): Promise<void>;
  collectGarbageInSyncVersions(now: number): Promise<void>;

  /**
   * Records an outgoing phantom together with the sync versions of the change
   * it announces, in one step.
   *
   * One step is the whole point: a stamped change whose phantom never went out
   * is invisible to the user's other devices forever, because the ordering
   * token is already spent and nothing re-sends. Both rows go into the same
   * database file with no await in between, so no file write can catch one
   * without the other, and the phantom is sent from the journal afterwards.
   */
  queueSyncPhantom(entry: PendingSyncMsgEntry, versions?: SyncVersionWrite[]): Promise<void>;
  /** Queued phantoms that are yet to be handed to delivery, oldest first. */
  getPendingSyncPhantoms(): PendingSyncMsgDbEntry[];
  /** Same count without reading payloads - this one is polled. */
  countPendingSyncPhantoms(): number;
  deletePendingSyncPhantom(id: number): Promise<void>;
  /**
   * Counts a failed release attempt, returning the new count. A row is never
   * dropped for failing - see the implementation for why.
   */
  recordPendingSyncPhantomFailure(id: number): Promise<number>;
  /** Drops phantoms of changes older than the synchronization window. */
  dropExpiredSyncPhantoms(now: number): Promise<number>;
}
