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
import { SYSTEM_FOLDERS } from '../../../src/common/constants/mail-folders-default.ts';
import type {
  AttachmentInfo,
  IncomingMessageView,
  OutgoingMessageView,
} from '../../../src/common/types/mail.types.ts';
import type { SyncedAttachmentInfo, SyncedMsgRecord } from '../../types/mail-sync.types.ts';
import type { MsgPlacement } from '../../types/sync-types.ts';
import {
  deliveryStateOf,
  isIncomingMsg,
  isMsgRead,
  placementOf,
  type MsgView,
} from './msg-aspects.ts';

/**
 * Attachment records as they travel in a phantom - three cases, not one.
 *
 *  1. `type: 'origin'` with an `originMsgId`: an attachment of a forwarded
 *     incoming message that has not been copied into the store yet. The bytes
 *     are in a message in the SHARED inbox, and originMsgId is that inbox
 *     msgId - the same on every device of this user, so ANOTHER DEVICE CAN READ
 *     THEM. Only `id` is cut out; `hasNoLocalSource` is deliberately NOT set.
 *  2. `external: true` - a symlink to a file on the author's disk. `id` and
 *     `external` are both cut out (the latter would otherwise promise a
 *     resolvable file that is not here), and the record is marked.
 *  3. A copy in `mail-app-files` - same as (2).
 *
 * Case (1) has no counterpart in chat.app, which marks every attachment without
 * distinction. Here the shared inbox gives attachments of a forwarded message
 * free availability on every device, and there is no reason to throw that away.
 *
 * `id` is cut out in all three: it points into another device's file store, and
 * an id from there can *collide* with a local one and hand the user someone
 * else's file.
 *
 * An empty list is not sent at all (`undefined`, never `[]`): `[]` is truthy,
 * reaches the column as the string `"[]"`, and reads back on the receiving side
 * as "there are files, but not here".
 */
export function attachmentsForPhantom(
  attachmentsInfo: AttachmentInfo[] | undefined,
  sourceDeviceId: string,
): SyncedAttachmentInfo[] | undefined {
  if (!attachmentsInfo?.length) {
    return undefined;
  }

  return attachmentsInfo.map(item => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, external, ...rest } = item;
    const bytesAreInSharedInbox = (item.type === 'origin') && !!item.originMsgId;
    if (bytesAreInSharedInbox) {
      return rest;
    }
    return { ...rest, hasNoLocalSource: true as const, originDeviceId: sourceDeviceId };
  });
}

/**
 * Builds the record a `msg-record` phantom carries.
 *
 * INVARIANT the superseding of 'content' rests on (see planJournalRelease): this
 * is called with the record as STORED at the moment the phantom is queued, never
 * with a partial diff. Only then is a newer 'content' row a superset of an older
 * one.
 */
export function syncedRecordOf(msg: MsgView, sourceDeviceId: string): SyncedMsgRecord {
  const incoming = isIncomingMsg(msg);
  return {
    threadId: msg.threadId,
    ...(msg.cTime && { cTime: msg.cTime }),
    ...(msg.subject && { subject: msg.subject }),
    ...(msg.plainTxtBody && { plainTxtBody: msg.plainTxtBody }),
    ...(msg.htmlTxtBody && { htmlTxtBody: msg.htmlTxtBody }),
    jsonBody: msg.jsonBody ?? {},
    ...(msg.recipients?.length && { recipients: msg.recipients }),
    ...(() => {
      const attachmentsInfo = attachmentsForPhantom(msg.attachmentsInfo, sourceDeviceId);
      return attachmentsInfo ? { attachmentsInfo } : {};
    })(),
    delivery: deliveryStateOf(msg),
    placement: placementOf(msg),
    // Reserved for a future resync answer; a phantom about an incoming message
    // never carries its record today (every device derives it from the shared
    // inbox itself).
    ...(incoming && { sender: (msg as { sender?: string }).sender, read: isMsgRead(msg) }),
  };
}

/** The folder a record goes into, from its two aspects. */
export function folderFromRecord(record: SyncedMsgRecord): string {
  return folderFor(record.placement, record.delivery.home);
}

function folderFor(placement: MsgPlacement, home: string): string {
  switch (placement.at) {
    case 'trash':
      return SYSTEM_FOLDERS.trash;
    case 'folder':
      return placement.folderId;
    default:
      return home;
  }
}

/**
 * A record made out of a phantom of an outgoing message or a draft.
 *
 * `originDeviceId` is the device the phantom came from, and it is what keeps
 * this device from offering "cancel / retry" over somebody else's sending.
 */
export function msgFromSyncedRecord(
  msgId: string,
  record: SyncedMsgRecord,
  sourceDeviceId: string,
): OutgoingMessageView {
  return {
    msgId,
    threadId: record.threadId,
    msgType: 'mail',
    ...(record.cTime && { cTime: record.cTime }),
    ...(record.subject && { subject: record.subject }),
    ...(record.plainTxtBody && { plainTxtBody: record.plainTxtBody }),
    ...(record.htmlTxtBody && { htmlTxtBody: record.htmlTxtBody }),
    jsonBody: record.jsonBody ?? {},
    recipients: record.recipients ?? [],
    // Normalized here, matching how the sending side omits an empty list.
    ...(record.attachmentsInfo?.length && { attachmentsInfo: record.attachmentsInfo }),
    status: record.delivery.status,
    ...(record.delivery.statusDescription && {
      statusDescription: record.delivery.statusDescription,
    }),
    deliveryTS: record.delivery.deliveryTS ?? 0,
    mailFolder: folderFromRecord(record),
    originDeviceId: sourceDeviceId,
  } as OutgoingMessageView;
}

/**
 * A record of an INCOMING message, made out of a record that carried one.
 *
 * The pair of msgFromSyncedRecord(), and it did not exist until now for a good
 * reason: an incoming record never travelled in a phantom, its carrier - the
 * message in the shared inbox - being readable on every device. Two things
 * changed that, and both are about the archive:
 *
 *  - a backup stores incoming records whole, because the archive may end up
 *    being the ONLY carrier: the user is free to delete the message off the
 *    server the day after taking the backup;
 *  - hence a restore snapshot carries such a record too, marked `noServerCopy`,
 *    and the receiving device builds the record from it instead of spending a
 *    `getMsg` on a message that is not there.
 *
 * `sender` is what makes a record read as incoming everywhere in this app (see
 * isIncomingMsg), so a record without one cannot be turned into an incoming
 * view at all - the caller checks for that and reports it rather than storing a
 * record that would come back as outgoing.
 */
export function incomingMsgFromSyncedRecord(
  msgId: string,
  record: SyncedMsgRecord & { sender: string },
): IncomingMessageView {
  return {
    msgId,
    threadId: record.threadId,
    msgType: 'mail',
    sender: record.sender,
    ...(record.cTime && { cTime: record.cTime }),
    ...(record.subject && { subject: record.subject }),
    ...(record.plainTxtBody && { plainTxtBody: record.plainTxtBody }),
    ...(record.htmlTxtBody && { htmlTxtBody: record.htmlTxtBody }),
    jsonBody: record.jsonBody ?? {},
    recipients: record.recipients ?? [],
    ...(record.attachmentsInfo?.length && { attachmentsInfo: record.attachmentsInfo }),
    // The read state is the one aspect of an incoming message that belongs to
    // the user rather than to the server, so it comes out of the record and not
    // out of a default.
    status: record.read ? 'read' : 'received',
    deliveryTS: record.delivery.deliveryTS ?? 0,
    mailFolder: folderFromRecord(record),
  } as IncomingMessageView;
}

/**
 * Whether a record can be turned into an incoming view.
 *
 * Exported so that both ends check it the same way: an archive or a snapshot
 * entry that claims an incoming message without a sender is malformed, and
 * storing it would put a record into the mailbox that reads as outgoing.
 */
export function isRestorableIncomingRecord(
  record: SyncedMsgRecord,
): record is SyncedMsgRecord & { sender: string } {
  return typeof record.sender === 'string' && !!record.sender;
}

/**
 * Applies the content half of a record onto an existing one, leaving the other
 * aspects alone: they have tokens of their own, and a snapshot must not undo a
 * later change of one of them.
 */
export function applyRecordContent<T extends MsgView>(msg: T, record: SyncedMsgRecord): T {
  return {
    ...msg,
    threadId: record.threadId,
    cTime: record.cTime,
    subject: record.subject,
    plainTxtBody: record.plainTxtBody,
    htmlTxtBody: record.htmlTxtBody,
    jsonBody: record.jsonBody ?? {},
    recipients: record.recipients ?? [],
    attachmentsInfo: mergeAttachmentAvailability(record.attachmentsInfo, msg.attachmentsInfo),
  };
}

/**
 * The attachment list a phantom brought, with WHAT IS HERE kept as it is.
 *
 * The list itself comes from the phantom - the author decides which files the
 * message has - but every entry in it is marked `hasNoLocalSource` and stripped
 * of its `id`, because attachmentsForPhantom cannot know whether the receiver
 * has the bytes. Taking that at face value destroys the very thing it is trying
 * to describe:
 *
 *  1. A saves a draft with a file, so A holds the id of a copy in its store.
 *  2. B gets the record - marked, no id, which is right for B.
 *  3. Anything that changes `content` on B announces the record BACK, still
 *     marked. On a draft this needs no editing at all: the form auto-saves as it
 *     opens, and preparedMsgDataToOutgoingMsgView stamps a fresh `cTime` every
 *     time, which diffMsgAspects reads as a content change.
 *  4. A applies it under a newer token, and A's id is gone. The file A HAS is
 *     now unopenable on A, unsendable, and absent from any backup taken there -
 *     which is how this was found: a live run produced an archive whose small
 *     attachment was simply missing.
 *
 * So availability is not treated as a synchronized property, and it should not
 * be: an aspect is something two devices can disagree about, and no other device
 * can claim that the bytes are not on THIS one. What a phantom is authoritative
 * about is the SET of attachments; what is local truth is whether each one can
 * be read here.
 *
 * Matched on name AND size, not on name alone: the author may have replaced a
 * file with a different one under the same name, and the phantom carries no id
 * to tell the two apart. Equal size makes "the same file" the right reading in
 * practice; a different size takes the phantom's marked entry, which reads as
 * "not here" rather than handing the user stale bytes.
 */
export function mergeAttachmentAvailability(
  fromPhantom: SyncedAttachmentInfo[] | undefined,
  local: AttachmentInfo[] | undefined,
): AttachmentInfo[] | undefined {
  if (!fromPhantom?.length) {
    return undefined;
  }
  if (!local?.length) {
    return fromPhantom as AttachmentInfo[];
  }

  // Each local entry is claimed at most once: two attachments of one message may
  // share a name and a size, and one readable file must not be reported as two.
  const claimed = new Set<number>();

  return fromPhantom.map(item => {
    const index = local.findIndex((candidate, i) =>
      !claimed.has(i)
      && (candidate.fileName === item.fileName)
      && (candidate.size === item.size)
      && !candidate.hasNoLocalSource
      && !!candidate.id);

    if (index < 0) {
      return item as AttachmentInfo;
    }
    claimed.add(index);
    return local[index];
  });
}
