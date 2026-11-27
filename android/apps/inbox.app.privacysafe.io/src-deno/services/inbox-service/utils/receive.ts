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
import { sameAddress } from '../../../../shared/utils/address-utils.ts';

const log = makeLogger('InboxReceive');

/**
 * The thread an incoming message goes into.
 *
 * `threadId` is in the body, so the sender chooses it. A thread id is not a
 * secret - every recipient of a thread has it, and forwarding used to hand it
 * on - and joining a thread placed a stranger's message among the user's own,
 * under the thread's row in the list, where one tick of a checkbox selects
 * the whole thread for deletion (audit of 2026-11-26). So a message joins an
 * existing thread only when its sender is already in that thread, as its
 * sender or one of its recipients; otherwise, and for an id that is not one,
 * it starts a thread of its own. The fallback is derived from the message id,
 * so every device of the user files the message the same way.
 */
export function threadIdForIncoming(
  db: Pick<DBProvider, 'getMessagesByThread'>,
  msg: { msgId: string; sender: string; threadId?: unknown },
): string {
  const ownThread = `in-${msg.msgId}`;
  const claimed = msg.threadId;
  if ((typeof claimed !== 'string') || !claimed || (claimed.length > 200)) {
    return ownThread;
  }
  const threadMsgs = db.getMessagesByThread(claimed);
  if (threadMsgs.length === 0) {
    return claimed;
  }
  const isParticipant = threadMsgs.some(m => {
    const { sender, recipients } = m as { sender?: string; recipients?: string[] };
    return (!!sender && sameAddress(sender, msg.sender))
      || (Array.isArray(recipients) && recipients.some(r => sameAddress(r, msg.sender)));
  });
  return isParticipant ? claimed : ownThread;
}

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
  // A message already filed keeps its thread: the decision is made once, on
  // arrival, against the thread as it was then.
  msgData.threadId = existing?.threadId ?? threadIdForIncoming(db, msgData);

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
