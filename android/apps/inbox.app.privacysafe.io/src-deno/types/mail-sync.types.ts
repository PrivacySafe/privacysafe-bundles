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
import type {
  AttachmentInfo,
  MailFolder,
  MessageJsonBody,
} from '../../src/common/types/mail.types.ts';
import type {
  MsgDeliveryState,
  MsgPlacement,
  RestoreMode,
  SyncAspect,
  SyncToken,
} from './sync-types.ts';

/**
 * The ASMail message type phantoms travel under.
 *
 * `app:<app domain>` is the platform's convention for messages of an
 * application rather than of a user (@types/core-defs/asmail.d.ts). The core
 * routes nothing by msgType, and builds that predate this feature filter on
 * `msgType !== 'mail'` and hence ignore such a message rather than showing it to
 * the user.
 */
export const MAIL_SYNC_MSG_TYPE = 'app:inbox.app.privacysafe.io';

/**
 * An attachment record as it travels in a phantom.
 *
 * `id` is always cut out: it points into another device's file store, and an id
 * from there can *collide* with a local one and hand the user someone else's
 * file. `external` is cut out with it, since a symlink to a file on the author's
 * disk would otherwise promise a resolvable file that is not here.
 */
export type SyncedAttachmentInfo = Omit<AttachmentInfo, 'id' | 'external'> & {
  hasNoLocalSource?: true;
  originDeviceId?: string;
};

/**
 * A whole message record, carried only for *outgoing* mail and drafts.
 *
 * The content of an incoming message is never carried: its msgId is issued by
 * the ASMail server and the inbox is shared between the user's devices, so every
 * device derives the same record from the same message on its own. Carrying it
 * would duplicate bytes and risk two derivations of one record drifting apart.
 * An outgoing message and a draft exist only on the device that wrote them;
 * there is no other carrier for those.
 *
 * INVARIANT, and the one superseding of 'content' rests on (see
 * planJournalRelease): a record is built from the *stored* record at the moment
 * the phantom is queued, never from a partial diff. Only then is a newer
 * 'content' row a superset of an older one.
 */
export interface SyncedMsgRecord {
  threadId: string;
  cTime?: number;
  subject?: string;
  plainTxtBody?: string;
  htmlTxtBody?: string;
  jsonBody: Partial<MessageJsonBody>;
  recipients?: string[];
  attachmentsInfo?: SyncedAttachmentInfo[];
  /** Snapshots of the aspects as of when the phantom was built. */
  delivery: MsgDeliveryState;
  placement: MsgPlacement;
  /** Filled only for a record of an incoming message - reserved for a future resync answer. */
  sender?: string;
  read?: boolean;
}

/**
 * What a phantom announces.
 *
 * `read`, `placement` and `deleted` carry a *list* of ids: a bulk action is one
 * thing the user did, and it costs one delivery rather than N. `delivery` is
 * single - the outcome of sending is always about one message.
 *
 * `incoming` on a placement event, and the very existence of a `read` event,
 * tell the receiver that a record it does not have can be fetched from the
 * shared inbox (see §7.5). Without that it would have to either always try
 * getMsg or always buffer.
 */
export type MailSyncEvent =
  | { kind: 'msg-record'; msgId: string; record: SyncedMsgRecord }
  | { kind: 'msg-read'; msgIds: string[]; read: boolean }
  | { kind: 'msg-placement'; msgIds: string[]; placement: MsgPlacement; incoming: string[] }
  | { kind: 'msg-delivery'; msgId: string; delivery: MsgDeliveryState }
  | { kind: 'msg-deleted'; msgIds: string[] }
  | { kind: 'folder-record'; folder: MailFolder }
  | { kind: 'folder-deleted'; folderId: string };

export interface MailSyncMsgV1 {
  v: 1;
  /** The device that made the change. A device knows its own echo by this. */
  sourceDeviceId: string;
  /** The hybrid logical clock stamp; with sourceDeviceId this is the LWW token. */
  timestamp: number;
  event: MailSyncEvent;
}

// =============================================================================
// v2: a bulk snapshot of a restore
// =============================================================================

/**
 * One message in a restore snapshot.
 *
 * The rule for `record` is about the CARRIER of the record, not about the
 * direction of the message:
 *
 * > A record travels in a snapshot when, and only when, the receiver has no
 * > other way of getting it.
 *
 * An ordinary `msg-record` phantom never carries an incoming record, and that is
 * right: its carrier is the message itself, in the SHARED inbox, which the
 * receiving device reads with one `getMsg`. For a snapshot that stops being true
 * in one case - the user took the archive, then deleted an incoming message off
 * the server. On the restored device the message is back (the archive had it);
 * on a neighbour there is nothing to read it from, `ensureRecordFor()` would
 * buffer the entry as an orphan, and ORPHAN_TTL_MS later the collector would
 * throw it away. The devices would then differ for good.
 */
export interface SnapshotMsgEntry {
  msgId: string;
  incoming: boolean;
  /**
   * For outgoing mail and drafts - always. For an incoming message - only when
   * the message is no longer in the shared inbox, i.e. when the archive is its
   * only carrier.
   */
  record?: SyncedMsgRecord;
  /**
   * The message is not in the shared inbox. The receiver then spends no `getMsg`
   * and does not buffer the entry, but builds the record out of `record`.
   */
  noServerCopy?: true;
  /**
   * What the SERVER does not know about an incoming message: whether the user
   * has read it, and where they put it.
   *
   * Carried instead of the record when the message is still in the shared inbox.
   * A token without a value would be useless - the receiver would know that the
   * archive has an opinion about the read state and not what that opinion is.
   */
  read?: boolean;
  placement?: MsgPlacement;
  /** The archived per-aspect tokens; the receiver applies them with applyIfNewer. */
  versions: Partial<Record<SyncAspect, SyncToken>>;
}

export interface SnapshotFolderEntry {
  folder: MailFolder;
  versions: Partial<Record<SyncAspect, SyncToken>>;
}

export type MailSyncEventV2 = {
  kind: 'restore-snapshot';
  /** The mode the user picked. The receiver applies the same rule. */
  mode: RestoreMode;
  snapshotTs: number;
  restoreId: string;
  part: number;
  of: number;
  msgs?: SnapshotMsgEntry[];
  folders?: SnapshotFolderEntry[];
  /**
   * Only in `replace`, and only in the last chunk. The token is a FRESH one, not
   * an archived one: a deletion has to win on the receiving devices.
   */
  deleted?: { msgIds?: string[]; folderIds?: string[]; token: SyncToken };
};

/**
 * The second version of a phantom's body.
 *
 * `v: 2` is chosen deliberately: a build that predates it does not recognize the
 * body, and the branch for that is already written - such a message is left
 * alone and only scheduled for a DEFERRED removal (15 days), which is precisely
 * the case the comment in handle-incoming-sync.ts describes.
 */
export interface MailSyncMsgV2 {
  v: 2;
  sourceDeviceId: string;
  timestamp: number;
  event: MailSyncEventV2;
}

export type MailSyncMsg = MailSyncMsgV1 | MailSyncMsgV2;

/** Local metadata of a phantom's delivery, by which its progress is routed. */
export interface MailSyncLocalMeta {
  mailSync: true;
  kind: MailSyncEvent['kind'] | MailSyncEventV2['kind'];
  /**
   * Diagnostics only. The decision to clear a journal row always comes from the
   * flight registry - a row id from a previous process would point at a row that
   * has since been released again.
   */
  syncJournalRowId: number;
}

/**
 * Whether an inbox message's body is a phantom this build can read.
 *
 * Both versions go through one predicate rather than one per version: the
 * receiving tract has exactly one place where an unreadable body turns into a
 * deferred removal, and a second predicate would inevitably be forgotten at
 * the next version.
 */
export function isMailSyncMsg(body: unknown): body is MailSyncMsg {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const candidate = body as Partial<MailSyncMsg>;
  if ((candidate.v !== 1) && (candidate.v !== 2)) {
    return false;
  }
  if (typeof candidate.sourceDeviceId !== 'string' || !candidate.sourceDeviceId) {
    return false;
  }
  if (typeof candidate.timestamp !== 'number' || !Number.isFinite(candidate.timestamp)) {
    return false;
  }
  const kind = (candidate.event as { kind?: unknown } | undefined)?.kind;
  return typeof kind === 'string' && !!kind;
}

export function isMailSyncMsgV2(msg: MailSyncMsg): msg is MailSyncMsgV2 {
  return msg.v === 2;
}
