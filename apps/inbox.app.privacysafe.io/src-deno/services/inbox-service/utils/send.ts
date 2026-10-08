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
import { SYSTEM_FOLDERS } from '../../../../src/common/constants/mail-folders-default.ts';
import type {
  IncomingMessageView,
  OutgoingMessageView,
} from '../../../../src/common/types/mail.types.ts';
import type { DBProvider } from '../../../dataset/index.ts';
import type { LabelledFileStore } from '../../file-store/labelled-file-store.ts';
import type { InboxEmit } from '../events.ts';
import type { MailSyncLocalMeta } from '../../../types/mail-sync.types.ts';
import type { MsgDeliveryState } from '../../../types/sync-types.ts';
import { applyDelivery } from '../../sync/msg-aspects.ts';
import type { SyncOutbox } from '../../sync/sync-outbox.ts';
import { outgoingMsgViewToOutgoingMsg } from './transform-message.ts';
import { handleSendingError } from './handle-sending-error.ts';
import { makeLogger } from '../../../../shared/utils/logger.ts';

const log = makeLogger('InboxSend');

export async function sendOutgoingMessage(
  db: DBProvider,
  fileStore: LabelledFileStore,
  msgData: OutgoingMessageView,
): Promise<void> {
  const outgoingMessage = await outgoingMsgViewToOutgoingMsg(msgData, fileStore);
  const { msgId, recipients = [] } = outgoingMessage;
  if ('plainTxtBody' in outgoingMessage) {
    delete outgoingMessage.plainTxtBody;
  }
  // Once handed to delivery, the message is on its way whatever happens here;
  // the record of it has to be in the file by then, or a crash leaves a message
  // sent that this app has no idea about.
  await db.flush();
  await w3n.mail?.delivery.addMsg(recipients, outgoingMessage, msgId!);
}

export async function cancelOutgoingMessage(msgId: string): Promise<void> {
  await w3n.mail?.delivery.rmMsg(msgId, true);
}

/**
 * Whether a delivery is carrying a synchronization phantom rather than mail.
 *
 * Routing on this happens in mail-service, the one place deliveries are
 * subscribed to; the check is exported because the early exit below has to make
 * the same call, and two spellings of it would drift.
 */
export function isMailSyncDelivery(progress?: web3n.asmail.DeliveryProgress): boolean {
  return !!(progress?.localMeta as MailSyncLocalMeta | undefined)?.mailSync;
}

/**
 * @param sync where the outcome of the sending is announced to the user's other
 *        devices. Without it a device that has seen the `sending` phantom of
 *        this message never learns how the sending ended: the change is applied
 *        here without a token ever being spent on it, so nothing is left to
 *        announce afterwards, and the message sits in that device's Outbox
 *        for good.
 */
export async function handleDeliveryProgress(
  db: DBProvider,
  emit: InboxEmit,
  id: string,
  progress: web3n.asmail.DeliveryProgress,
  sync: SyncOutbox,
): Promise<void> {
  if (!progress || progress.localMeta?.chatId) {
    return;
  }
  // A guard against a new caller, not the routing itself: the previous filter
  // let a phantom's delivery through, db.getMessageById('sync_…') answered null,
  // and the code below cancelled this device's own phantom with
  // delivery.rmMsg(). It also emitted a 'sending' progress event per phantom,
  // which put every one of them into the GUI's list of messages being sent.
  if (isMailSyncDelivery(progress)) {
    return;
  }

  emit({ entity: 'sending', event: 'progress', id, progress });

  if (!progress.allDone) {
    return;
  }

  const message = db.getMessageById(id);
  if (!message) {
    await w3n.mail?.delivery.rmMsg(id, true);
    return;
  }

  // The outcome as one value, and the authoritative one: `home` is named here
  // rather than left to be recomputed, because the rule below - every recipient
  // refused -> outbox, otherwise sent - knows something about recipients that
  // the record alone does not.
  const outcome = outcomeOf(progress, message);

  // Applied through applyDelivery, the same function the receiving side uses.
  // One rule for both paths: it moves the folder only when the message is at
  // home, so one dropped into the trash mid-sending stays in the trash here as
  // well - where before it jumped out into `sent` on this device only, and the
  // two devices parted ways over it.
  const next = outcome ? applyDelivery(message, outcome) : message;

  await db.updateMessage(next);
  emit({ entity: 'message', event: 'updated', msg: next, msgId: id });

  if (next.mailFolder !== SYSTEM_FOLDERS.outbox) {
    emit({
      entity: 'sending',
      event: 'complete',
      id,
      status: next.status === 'sent' ? 'ok' : 'error',
    });
  }

  if (outcome) {
    // After the local write, and with no flush() of its own: announce() ->
    // releasePending() flushes before the first handover, so the phantom cannot
    // go out ahead of the change it announces.
    await sync.announce({
      event: { kind: 'msg-delivery', msgId: id, delivery: outcome },
      aspects: [{ entityType: 'msg', entityId: id, aspect: 'delivery' }],
    });
  }

  try {
    await w3n.mail?.delivery.rmMsg(id);
  } catch (err) {
    log.error(`Failed to remove delivery ${id}`, err);
  }
}

/**
 * The delivery aspect a terminal progress amounts to, or undefined when the
 * platform reports a terminal state this app has no verdict for.
 *
 * Undefined leaves the record untouched and announces nothing: a phantom of a
 * change that was not made would only spend a token and travel for nothing.
 */
function outcomeOf(
  progress: web3n.asmail.DeliveryProgress,
  message: OutgoingMessageView | IncomingMessageView,
): MsgDeliveryState | undefined {
  if (progress.allDone === 'all-ok') {
    return { status: 'sent', deliveryTS: Date.now(), home: SYSTEM_FOLDERS.sent };
  }

  if (progress.allDone !== 'with-errors') {
    return undefined;
  }

  const recipients = progress.recipients || {};
  const statusDescription = Object.keys(recipients).reduce(
    (res, address) => {
      const recipientInfo = recipients[address];
      if (recipientInfo?.err) {
        const errorFlag = handleSendingError(recipientInfo);
        if (errorFlag !== null) {
          res[address] = errorFlag || '';
        }
      }
      return res;
    },
    {} as Record<string, string>,
  );

  const recipientCount = (message.recipients || []).length;
  const failedCount = Object.keys(statusDescription).length;
  return {
    status: 'error',
    statusDescription,
    home: failedCount === recipientCount ? SYSTEM_FOLDERS.outbox : SYSTEM_FOLDERS.sent,
  };
}
