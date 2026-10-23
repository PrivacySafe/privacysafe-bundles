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
import type { IncomingMessage } from '../../../../src/common/types/mail.types.ts';
import type { DBProvider } from '../../../dataset/index.ts';
import type { InboxEmit } from '../events.ts';
import { incomingMsgToIncomingMsgView } from './transform-message.ts';
import { notifyNewIncomingMail } from './notifications.ts';
import { makeLogger } from '../../../../shared/utils/logger.ts';

const log = makeLogger('InboxReceive');

/**
 * Stores an incoming mail message.
 *
 * The watermark is deliberately not touched here: it is committed per batch by
 * the mail service, which is the only place that can see a batch at all (see
 * watermark.ts).
 */
export async function persistIncomingMail(
  db: DBProvider,
  emit: InboxEmit,
  msg: IncomingMessage,
  opts?: {
    notify?: boolean;
    /** Called after a record was newly added - the drain of the orphan buffer. */
    onAdded?: (msgId: string) => Promise<void>;
  },
): Promise<void> {
  if (msg.msgType !== 'mail') {
    return;
  }

  // A message deleted for good on another device may still be listed by this
  // device's scan - it enumerated the inbox before removeMsg went through. The
  // tombstone is the only thing keeping it from coming back from the dead.
  //
  // No token comparison here, and on purpose: an incoming msgId is issued by the
  // server once, so there is no such thing as a newer arrival of the same
  // message. The tombstone's presence is the whole answer.
  if (db.getSyncVersion('msg', msg.msgId, 'deleted')) {
    log.debug(`Not storing ${msg.msgId}: it has a tombstone. Finishing its removal instead.`);
    // Nobody has taken it off the server yet, or this scan would not have seen
    // it. noDiskWrite: the caller's batch commit covers this.
    await db.scheduleInboxMsgRemoval(msg.msgId, true);
    return;
  }

  const existing = db.getMessageById(msg.msgId);
  const msgData = await incomingMsgToIncomingMsgView(msg);

  if (existing) {
    // `status` and `mailFolder` carry the two aspects that belong to the USER
    // rather than to the server - whether the message has been read, and where
    // they put it (see doc/multi-device-sync.md). Everything else here is the
    // message's content, for which the server is the source of truth.
    //
    // A re-derivation is therefore not entitled to speak for those two, and it
    // would: incomingMsgToIncomingMsgView() always answers 'received' and
    // Inbox, and UPSERT_MESSAGE_QUERY writes every column. The catch-up scan
    // lists the inbox from CATCH_UP_REWIND_MS before the watermark, and the
    // watermark is the GREATEST processed deliveryTS - so the newest message is
    // always in that window, and without this it would come back unread, and
    // out of the trash, on every start of this component.
    msgData.status = existing.status;
    msgData.mailFolder = existing.mailFolder;
    await db.updateMessage(msgData);
    emit({ entity: 'message', event: 'updated', msg: msgData, msgId: msgData.msgId });
  } else {
    await db.addMessage(msgData);
    emit({ entity: 'message', event: 'added', msg: msgData, msgId: msgData.msgId });
    // Phantoms about this message may have arrived before the message itself.
    await opts?.onAdded?.(msgData.msgId);
  }

  if (opts?.notify !== false && !existing) {
    await notifyNewIncomingMail(msgData.sender, msgData.subject || '', msgData.msgId);
  }
}
