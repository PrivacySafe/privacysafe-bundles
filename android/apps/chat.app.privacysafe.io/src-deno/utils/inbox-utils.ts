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
import { sleep } from '../../shared-libs/processes/sleep.ts';

/**
 * Removes a message from the user's inbox by msgId.
 * @param msgId     Inbox message identifier.
 * @param logInfo   Optional informational text to log before removal.
 * @param delayMs   Optional delay in milliseconds before removal (useful for
 *                  race-condition workarounds). When `true` is passed, a
 *                  default delay of 250 ms is used.
 */
export async function removeMessageFromInbox(
  msgId: string,
  logInfo?: string,
  delayMs?: number | true,
): Promise<void> {
  if (logInfo) {
    await w3n.log('info', logInfo);
  }

  if (delayMs) {
    await sleep(delayMs === true ? 250 : delayMs);
  }

  await w3n.mail!.inbox.removeMsg(msgId).catch(async (e: web3n.asmail.InboxException) => {
    if (!e.msgNotFound) {
      await w3n.log('error', `Error deleting message ${msgId} from INBOX. `, e);
    }
  });
}

/**
 * Removes multiple messages from the user's inbox in parallel (batch).
 * More efficient than calling removeMessageFromInbox() in a loop when many
 * messages need to be removed at once (e.g. orphaned WebRTC signals for a
 * chat that just ended). Silently ignores messages that are no longer in the
 * inbox (already removed / not found).
 *
 * @param msgIds   Array of inbox message identifiers to remove.
 * @param logInfo  Optional informational text to log before removal.
 */
export async function removeMessagesFromInboxBatch(
  msgIds: string[],
  logInfo?: string,
): Promise<void> {
  if (msgIds.length === 0) {
    return;
  }
  if (logInfo) {
    await w3n.log('info', `${logInfo} (${msgIds.length} message(s))`);
  }
  await Promise.all(
    msgIds.map(msgId =>
      w3n.mail!.inbox.removeMsg(msgId).catch(async (e: web3n.asmail.InboxException) => {
        if (!e.msgNotFound) {
          await w3n.log('error', `Error deleting message ${msgId} from INBOX. `, e);
        }
      }),
    ),
  );
}

/**
 * Removes a message from the delivery queue by deliveryId.
 */
export async function removeMsgFromDelivery(id: string): Promise<void> {
  await w3n.mail!.delivery.rmMsg(id).catch(async err => {
    await w3n.log('error', `Error deleting message ${id} from delivery. `, err);
  });
}
