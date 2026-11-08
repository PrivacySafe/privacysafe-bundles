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
 * Buffer of phantoms that arrived before the message they are about.
 *
 * With "pull the message out of the shared inbox" (see handle-incoming-sync.ts)
 * most orphans resolve on the spot, and this stays a reserve for three cases:
 * getMsg failed on the network; the delivery of a message started and never
 * finished, so it is listed but not readable; and an aspect phantom of an
 * outgoing message arrived ahead of its own `msg-record` - which is ORDINARY,
 * two phantoms of one device travelling as separate deliveries 200 ms apart with
 * no guarantee of order. The third case justifies the table on its own.
 */

import { makeLogger } from '../../../shared/utils/logger.ts';
import type { DBProvider } from '../../dataset/index.ts';
import type { MailSyncMsg } from '../../types/mail-sync.types.ts';
import type { OrphanedSyncDbEntry } from '../../types/sync-types.ts';

const log = makeLogger('SyncOrphans');

/**
 * Orders buffered phantoms by the time of the CHANGE, not of the buffering.
 *
 * With conflicts resolved per aspect, applying them in the order they arrived
 * would leave an OLDER change as the last one written.
 */
export function orderedByChangeTime<T extends { ts: number; id: number }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.ts - b.ts) || (a.id - b.id));
}

export async function bufferOrphanedSync(
  db: DBProvider,
  targetMsgId: string,
  syncMsg: MailSyncMsg,
): Promise<void> {
  // A failure to buffer must not stop the rest of the inbox from being
  // processed: the phantom is lost, and the state stays as it was.
  try {
    await db.addOrphanedSync({
      targetMsgId,
      ts: syncMsg.timestamp,
      rawPayload: JSON.stringify(syncMsg),
      bufferedAt: Date.now(),
    });
    log.debug(
      `Buffered a ${syncMsg.event.kind} phantom from ${syncMsg.sourceDeviceId} waiting for `
        + `message ${targetMsgId}.`,
    );
  } catch (err) {
    log.error(`Failed to buffer a phantom waiting for message ${targetMsgId}`, err);
  }
}

/**
 * Replays every buffered phantom about this message, oldest change first.
 *
 * Called from the two points where a record can come into being:
 * persistIncomingMail after db.addMessage, and the application of a `msg-record`
 * after db.addMessage.
 */
export async function drainOrphansFor(
  db: DBProvider,
  msgId: string,
  apply: (syncMsg: MailSyncMsg) => Promise<void>,
): Promise<number> {
  const buffered = db.getOrphanedSyncsFor(msgId);
  if (buffered.length === 0) {
    return 0;
  }

  let applied = 0;
  for (const entry of orderedByChangeTime<OrphanedSyncDbEntry>(buffered)) {
    try {
      const syncMsg = JSON.parse(entry.rawPayload) as MailSyncMsg;
      await apply(syncMsg);
      applied += 1;
    } catch (err) {
      log.error(`Failed to apply a buffered phantom ${entry.id} for message ${msgId}`, err);
    }
    // Dropped either way: a payload that cannot be read or applied will not
    // become readable on the next drain, and keeping it would replay the failure
    // at every start.
    await db.deleteOrphanedSync(entry.id);
  }

  log.debug(`Drained ${applied} of ${buffered.length} buffered phantom(s) for message ${msgId}.`);
  return applied;
}
