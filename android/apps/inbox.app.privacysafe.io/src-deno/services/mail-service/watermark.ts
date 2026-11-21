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
 * How far the inbox has been read, and the two rules that keep that number
 * honest. It used to live inside persistIncomingMail, which could only ever see
 * one message at a time.
 */

import { INBOX_COMMIT_BATCH, MAX_WATERMARK_LAG } from '../../../shared/constants/db.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';
import type { DBProvider } from '../../dataset/index.ts';
import type { InboxEmit } from '../inbox-service/events.ts';

const log = makeLogger('InboxWatermark');

export interface FailureFloor {
  recordFailure(deliveryTS: number): void;
  capFor(ts: number): number;
}

/**
 * The oldest deliveryTS this session failed to fetch or process. The watermark
 * must not be committed past it: everything the next start's catch-up scan
 * returns is at or after the watermark, so a message that was jumped over would
 * never be listed again - failing once would lose it for good, while
 * re-processing is merely idempotent work.
 *
 * The hold is bounded by MAX_WATERMARK_LAG behind the newest processed message:
 * a message that fails at every attempt would otherwise pin the watermark
 * forever, and every start's catch-up scan would grow into a re-fetch of an
 * unbounded stretch of the inbox. Within the window the failed message is
 * retried by every scan; past it, it is given up on.
 */
export function makeFailureFloor(): FailureFloor {
  let oldestFailedTS = Infinity;
  return {
    recordFailure(deliveryTS: number): void {
      oldestFailedTS = Math.min(oldestFailedTS, deliveryTS || Infinity);
    },
    capFor: (ts: number): number =>
      Math.min(ts, Math.max(oldestFailedTS, ts - MAX_WATERMARK_LAG)),
  };
}

export interface WatermarkCommitter {
  recordProcessed(deliveryTS: number): void;
  isBatchFull(): boolean;
  commit(): Promise<void>;
}

/**
 * Makes processed messages durable and only then advances the watermark.
 *
 * The order is what matters, and it is the order persistIncomingMail already
 * had: database writes are batched, so if the watermark went first, a crash
 * would leave messages that the next start's catch-up scan no longer returns and
 * that are in no database - lost for good. This way the worst case is
 * re-processing a batch, and processing is idempotent.
 *
 * Committing per batch rather than per message is what makes the batched writes
 * worth anything: a flush() rewrites the whole database file, and with phantoms
 * the message rate goes up by a multiple.
 */
export function makeWatermarkCommitter(
  db: DBProvider,
  emit: InboxEmit,
  failureFloor: FailureFloor,
): WatermarkCommitter {
  let processedTS = 0;
  let sinceCommit = 0;

  return {
    recordProcessed(deliveryTS: number): void {
      processedTS = Math.max(processedTS, deliveryTS);
      sinceCommit += 1;
    },

    isBatchFull: () => sinceCommit >= INBOX_COMMIT_BATCH,

    async commit(): Promise<void> {
      if (processedTS === 0) {
        return;
      }
      const tsToCommit = processedTS;
      const countToCommit = sinceCommit;
      const ts = failureFloor.capFor(tsToCommit);
      if (ts < tsToCommit) {
        log.info(
          `Watermark held at ${ts} instead of ${tsToCommit}: an older message failed this `
            + `session and must be seen by the next catch-up scan.`,
        );
      }

      const stored = db.getAppState().lastReceivingTimestamp || 0;
      const next = Math.max(stored, ts);

      await db.flush();
      await db.updateAppState({ lastReceivingTimestamp: next });
      // The watermark and the records it accounts for have to reach the file
      // together; the flush above covers the records, this one the watermark.
      await db.flush();
      emit({ entity: 'app-state', event: 'updated', state: { lastReceivingTimestamp: next } });

      if (processedTS === tsToCommit) {
        processedTS = 0;
        sinceCommit = 0;
      } else {
        sinceCommit = Math.max(0, sinceCommit - countToCommit);
      }
      log.debug(`Committed the inbox watermark: ${next}`);
    },
  };
}
