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
  IncomingMessageView,
  OutgoingMessageView,
} from '../../../src/common/types/mail.types.ts';
import type {
  MsgDeliveryState,
  MsgHomeFolder,
  MsgPlacement,
} from '../../types/sync-types.ts';

export type MsgView = IncomingMessageView | OutgoingMessageView;

/** Which aspects of a message record a change touched. */
export type MsgAspect = 'content' | 'read' | 'placement' | 'delivery';

const SYSTEM_HOME_FOLDERS: ReadonlySet<string> = new Set([
  SYSTEM_FOLDERS.inbox,
  SYSTEM_FOLDERS.draft,
  SYSTEM_FOLDERS.outbox,
  SYSTEM_FOLDERS.sent,
]);

export function isIncomingMsg(msg: MsgView): boolean {
  return !!(msg as IncomingMessageView).sender;
}

/**
 * The folder a message sits in when the user has not put it anywhere.
 *
 * A generalization of the former restoreFolderOf() in inbox-service.ts, which
 * already worked this out locally - only without the outbox branch. Both the
 * restore from trash and the application of a placement phantom have to call
 * THIS function: two copies of the rule diverge on the first message whose
 * sending failed.
 *
 * Note the behaviour this fixes: restoreFolderOf() used to answer `sent` for
 * anything that was not a draft, including a message with status 'error' that
 * had been sitting in `outbox`. Such a message now goes back to `outbox`.
 */
export function homeFolderOf(msg: MsgView): string {
  if (isIncomingMsg(msg)) {
    return SYSTEM_FOLDERS.inbox;
  }
  switch (msg.status) {
    case 'draft':
      return SYSTEM_FOLDERS.draft;
    case 'sending':
    case 'error':
    case 'canceled':
      return SYSTEM_FOLDERS.outbox;
    default:
      return SYSTEM_FOLDERS.sent;
  }
}

/**
 * Where the user has put the message - and nothing about where its own state
 * says it belongs.
 *
 * Any of the four system folders reads as 'home', including one that
 * homeFolderOf() would not have picked: a message whose sending partly failed
 * is left in `sent` by handleDeliveryProgress, which knows about recipients what
 * the record alone does not. That knowledge belongs to the `delivery` aspect,
 * not to this one.
 */
export function placementOf(msg: MsgView): MsgPlacement {
  if (msg.mailFolder === SYSTEM_FOLDERS.trash) {
    return { at: 'trash' };
  }
  if (SYSTEM_HOME_FOLDERS.has(msg.mailFolder)) {
    return { at: 'home' };
  }
  return { at: 'folder', folderId: msg.mailFolder };
}

export function applyPlacement<T extends MsgView>(msg: T, p: MsgPlacement): T {
  switch (p.at) {
    case 'trash':
      return { ...msg, mailFolder: SYSTEM_FOLDERS.trash };
    case 'folder':
      return { ...msg, mailFolder: p.folderId };
    default:
      return { ...msg, mailFolder: homeFolderOf(msg) };
  }
}

export function isMsgRead(msg: MsgView): boolean {
  return msg.status === 'read';
}

export function applyRead<T extends MsgView>(msg: T, read: boolean): T {
  return { ...msg, status: read ? 'read' : 'received' };
}

/**
 * The delivery aspect of an outgoing record as this device has it.
 *
 * `home` is taken from where the record actually is whenever it is at home,
 * rather than recomputed: that is the folder handleDeliveryProgress() has just
 * decided on, and its rule ("every recipient refused -> outbox, else sent")
 * cannot be reconstructed from the record alone.
 */
export function deliveryStateOf(msg: MsgView): MsgDeliveryState {
  const atHome = placementOf(msg).at === 'home';
  const home = (atHome ? msg.mailFolder : homeFolderOf(msg)) as MsgHomeFolder;
  return {
    status: msg.status as MsgDeliveryState['status'],
    ...(msg.statusDescription && { statusDescription: msg.statusDescription }),
    ...(msg.deliveryTS && { deliveryTS: msg.deliveryTS }),
    home,
  };
}

export function applyDelivery<T extends MsgView>(msg: T, d: MsgDeliveryState): T {
  const wasAt = placementOf(msg);
  const next = {
    ...msg,
    status: d.status,
    statusDescription: d.statusDescription,
    deliveryTS: d.deliveryTS ?? msg.deliveryTS,
  };
  // The folder moves only if the message is at home. One in the trash or in a
  // folder of the user's stays there: an outcome of sending is not an order to
  // move anything.
  return (wasAt.at === 'home') ? { ...next, mailFolder: d.home } : next;
}

/**
 * The stored record's `cTime`, `deliveryTS` and `originDeviceId`, kept over
 * whatever a save carries.
 *
 * Both are stamps of EVENTS - the record coming into being, and its delivery -
 * and a later save is neither of those events. The GUI cannot make this
 * distinction itself: `preparedMsgDataToOutgoingMsgView` stamps both with
 * `Date.now()` every time it turns a form into a record, and it does not know
 * whether the record already exists. The write point does.
 *
 * Without this, a draft merely LOOKED AT produced a change: the form saves as it
 * opens, the fresh `cTime` read as a content diff and the fresh `deliveryTS` as
 * a delivery diff, so every open cost a phantom and a delivery. Worse than the
 * waste was what that phantom carried - the attachment list in its marked form,
 * which is how a device came to lose the id of a file it was holding (see
 * mergeAttachmentAvailability).
 *
 * The delivery's own stamp still lands: handleDeliveryProgress writes through
 * `db.updateMessage`, not through the GUI's write point.
 *
 * A stamp the stored record does not have is not invented here - a record from
 * before either column carried a value takes the incoming one.
 *
 * `originDeviceId` travels with them for the same reason, though it is no stamp:
 * it says which device a record arrived from, the form never sets it, and the
 * row is rewritten whole - so a save would silently drop it. diffMsgAspects()
 * leaves it out of the diff deliberately, which means nothing downstream would
 * have noticed the loss either.
 */
export function preserveEventStamps<T extends MsgView>(stored: MsgView, next: T): T {
  return {
    ...next,
    ...(stored.cTime !== undefined && { cTime: stored.cTime }),
    ...(stored.deliveryTS !== undefined && { deliveryTS: stored.deliveryTS }),
    ...(stored.originDeviceId !== undefined && { originDeviceId: stored.originDeviceId }),
  };
}

/**
 * Empty and absent are the same value here, because they are the same value in
 * the table: msgValueToSqlInsertParams() writes NULL for an empty list or an
 * empty description, and the read back omits the field. So a record straight
 * from the form, whose `recipients` is `[]`, and the stored one it was saved
 * as, which has no `recipients` at all, describe the same message - and telling
 * them apart made every save of a draft with no recipients yet, the ordinary
 * state of one being composed, look like a change of content.
 */
function emptyAsAbsent(value: unknown): unknown {
  if ((value === undefined) || (value === null)) {
    return null;
  }
  if (Array.isArray(value)) {
    return (value.length === 0) ? null : value;
  }
  // The same for an empty statusDescription, which the mapper nulls too. An
  // empty jsonBody is not affected: its column is NOT NULL, so both sides of
  // any comparison are the object that was stored.
  if ((typeof value === 'object') && (Object.keys(value).length === 0)) {
    return null;
  }
  return value;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(emptyAsAbsent(a)) === JSON.stringify(emptyAsAbsent(b));
}

function samePlacement(a: MsgPlacement, b: MsgPlacement): boolean {
  if (a.at !== b.at) {
    return false;
  }
  return (a.at !== 'folder') || (a.folderId === (b as { folderId: string }).folderId);
}

/**
 * Which aspects of a record changed.
 *
 * The whole GUI writes through one upsertMessage(): saving a draft, marking as
 * read, cancelling a send, restoring from trash, recording a delivery error. The
 * aspect therefore cannot be picked by who is calling - it has to be worked out
 * from the records. This is the single place where a user's action turns into a
 * set of aspects; anything else would let a new caller of upsertMessage()
 * silently fail to synchronize its change.
 *
 * `originDeviceId` is deliberately not part of the diff: it is a local fact
 * about origin, not a change to announce.
 */
export function diffMsgAspects(before: MsgView | undefined, after: MsgView): Set<MsgAspect> {
  const aspects = new Set<MsgAspect>();
  const incoming = isIncomingMsg(after);

  if (!before) {
    // A new incoming record is derived from the shared inbox by every device on
    // its own, so there is nothing to announce about it.
    if (!incoming) {
      aspects.add('content');
    }
    return aspects;
  }

  if (incoming && (isMsgRead(before) !== isMsgRead(after))) {
    aspects.add('read');
  }

  if (!incoming) {
    const wasDelivery = deliveryStateOf(before);
    const isDelivery = deliveryStateOf(after);
    if (
      (wasDelivery.status !== isDelivery.status)
      || !sameJson(wasDelivery.statusDescription, isDelivery.statusDescription)
      || (wasDelivery.deliveryTS !== isDelivery.deliveryTS)
      || (wasDelivery.home !== isDelivery.home)
    ) {
      aspects.add('delivery');
    }
  }

  if (!samePlacement(placementOf(before), placementOf(after))) {
    aspects.add('placement');
  }

  // Content is an outgoing-only aspect. The content of an incoming message is
  // never announced: its msgId comes from the server, the inbox is shared, and
  // every device derives the same record from the same message on its own -
  // carrying it would duplicate bytes and risk two derivations drifting apart.
  if (
    !incoming
    && ((before.threadId !== after.threadId)
      || (before.cTime !== after.cTime)
      || (before.subject !== after.subject)
      || (before.plainTxtBody !== after.plainTxtBody)
      || (before.htmlTxtBody !== after.htmlTxtBody)
      || !sameJson(before.jsonBody, after.jsonBody)
      || !sameJson(before.recipients, after.recipients)
      || !sameJson(before.attachmentsInfo, after.attachmentsInfo))
  ) {
    aspects.add('content');
  }

  return aspects;
}
