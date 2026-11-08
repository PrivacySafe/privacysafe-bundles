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
import { makeLogger } from '../../../shared/utils/logger.ts';
import type { DBProvider } from '../../dataset/index.ts';

const log = makeLogger('SyncMaintenance');

export interface SyncMaintenanceResult {
  expiredPhantoms: number;
  collectedTombstones: number;
  collectedOrphans: number;
  removedFromInbox: number;
  removalsLeft: number;
}

/**
 * One pass of everything synchronization ages out, plus the deferred removals
 * from the shared inbox that have come due.
 *
 * Deliberately NOT on the critical path of the start: there can be up to N
 * server calls in here. The first releasePending(), by contrast, goes at once -
 * an unreleased phantom is the whole reason the journal exists.
 */
export async function runSyncMaintenance(db: DBProvider): Promise<SyncMaintenanceResult> {
  const now = Date.now();

  const expiredPhantoms = await db.dropExpiredSyncPhantoms(now);
  const collectedTombstones = await db.collectGarbageInSyncVersions(now);
  const collectedOrphans = await db.collectGarbageInOrphanedSyncs(now);

  const due = db.getExpiredInboxRemovals(now);
  const settled: string[] = [];

  if (due.length > 0) {
    const outcomes = await Promise.allSettled(
      due.map(msgId => w3n.mail!.inbox.removeMsg(msgId)),
    );
    outcomes.forEach((outcome, i) => {
      const msgId = due[i];
      if (outcome.status === 'fulfilled') {
        settled.push(msgId);
        return;
      }
      // Settled on msgNotFound too: somebody has already removed it, and the row
      // has nothing left to do. On any other failure - the server cannot be
      // reached - the row STAYS and is picked up by the next start; otherwise an
      // offline start would lose the obligation to remove.
      const err = outcome.reason as web3n.asmail.InboxException | undefined;
      if (err?.msgNotFound) {
        settled.push(msgId);
      } else {
        log.warn(`Could not remove message ${msgId} from the inbox; its row is kept.`, err);
      }
    });

    await db.dropInboxRemovals(settled, true);
  }

  // One write for the whole pass.
  await db.flush();

  const result: SyncMaintenanceResult = {
    expiredPhantoms,
    collectedTombstones,
    collectedOrphans,
    removedFromInbox: settled.length,
    removalsLeft: db.countPendingInboxRemovals(),
  };

  log.info(
    `Sync maintenance: dropped ${result.expiredPhantoms} expired phantom(s), collected `
      + `${result.collectedTombstones} tombstone(s) and ${result.collectedOrphans} buffered `
      + `phantom(s), removed ${result.removedFromInbox} of ${due.length} due inbox message(s), `
      + `${result.removalsLeft} removal(s) still pending.`,
  );

  return result;
}
