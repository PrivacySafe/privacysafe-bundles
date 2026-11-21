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

// @deno-types="../../shared-libs/sqlite-on-3nstorage/index.d.ts"
import { SQLiteOn3NStorage } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import { SingleProc } from '../../shared-libs/processes/single.ts';
import {
  DB_FLUSH_DELAY_MS,
  DB_FLUSH_MAX_PENDING,
  DB_WRITE_STALL_RETRY_MS,
  DB_WRITE_TIMEOUT_MS,
  DB_WRITE_WARN_MS,
} from '../../shared-libs/constants/index.ts';
import { wrapWithTimeout } from '../../shared-libs/processes/timeouts.ts';
import { addHeartbeatDetail } from '../utils/component-heartbeat.ts';

/**
 * Batches writes of a database file.
 *
 * SQLiteOn3NStorage.saveToFile() serializes the *whole* database and rewrites
 * the file, and its internal queue runs such calls one after another without
 * collapsing them. Writing on every mutation therefore costs O(db size) per
 * mutation, and one logical operation (say, receiving a message: add the
 * record, schedule its inbox removal, stamp a sync version) paid that cost
 * several times over.
 *
 * So mutations mark the database dirty instead of writing, and the actual write
 * happens once per batch. Reads are unaffected: they all go to the in-memory
 * sql.js database, never to the file.
 *
 * The trade-off is durability, and it is handled by the callers: anything that
 * makes a change observable outside this device (sending a phantom to the
 * user's other devices, queueing a message for delivery, advancing the inbox
 * watermark) calls flush() first. See DB.flush() users.
 */
export interface DbWriter {
  /**
   * Marks the database as having unwritten changes. Returns without waiting for
   * the file to be written - that is the point.
   */
  scheduleSave(): void;

  /**
   * Resolves once all changes marked so far are in the file.
   */
  flush(): Promise<void>;
}

export function makeDbWriter(sqlite: SQLiteOn3NStorage, label: string): DbWriter {
  const proc = new SingleProc();
  let dirty = false;
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  /**
   * Writes that timed out in a row. Read by the heartbeat, so that a file
   * system going quiet is visible in the log before anything visibly breaks,
   * and used to space out further attempts.
   */
  let consecutiveTimeouts = 0;

  addHeartbeatDetail(
    `db-writes(${label})`,
    () => ((consecutiveTimeouts > 0) ? `stalled x${consecutiveTimeouts}` : ''),
  );

  function cancelTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  async function flush(): Promise<void> {
    cancelTimer();
    if (!dirty) {
      return;
    }
    await proc.startOrChain(async () => {
      // Checked again inside the queue: calls that chained up behind a write
      // that already covered their changes must not write a second time.
      if (!dirty) {
        return;
      }
      // Cleared before the write, so that a mutation made while it is in
      // flight marks the database dirty again and gets its own write.
      dirty = false;
      pending = 0;
      const warnTimer = setTimeout(() => w3n.log(
        'warning',
        `Writing ${label} database file is taking over ${DB_WRITE_WARN_MS / 1000}s`,
      ).catch(() => {}), DB_WRITE_WARN_MS);
      try {
        // Timed out rather than awaited outright: a write that never returns
        // holds this SingleProc forever, and behind it every flush() caller -
        // the inbox dispatcher and the watermark commit among them. The
        // timeout does not stop the write, it lets the queue go.
        await wrapWithTimeout(
          sqlite.saveToFile({ skipUpload: true }),
          DB_WRITE_TIMEOUT_MS,
          () => Object.assign(
            Error(`Writing ${label} database file did not finish in ${DB_WRITE_TIMEOUT_MS}ms`),
            { dbWriteTimeout: true },
          ),
        );
        consecutiveTimeouts = 0;
      } catch (err) {
        // Otherwise the change is dropped silently and never reaches the file.
        // The in-memory database stays the source of truth either way; what a
        // failed write costs is the file lagging behind until the next one.
        dirty = true;
        if ((err as { dbWriteTimeout?: boolean })?.dbWriteTimeout) {
          consecutiveTimeouts += 1;
        }
        throw err;
      } finally {
        clearTimeout(warnTimer);
      }
    });
  }

  function scheduleSave(): void {
    dirty = true;
    pending += 1;
    // After a write that never came back, attempts are spaced out instead of
    // following every mutation: a file system that has stopped answering
    // should collect one abandoned write per half-minute, not hundreds.
    const delay = (consecutiveTimeouts > 0) ? DB_WRITE_STALL_RETRY_MS : DB_FLUSH_DELAY_MS;
    if ((pending >= DB_FLUSH_MAX_PENDING) && (consecutiveTimeouts === 0)) {
      flushInBackground();
      return;
    }
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        flushInBackground();
      }, delay);
    }
  }

  function flushInBackground(): void {
    flush().catch(err => {
      w3n.log('error', `Failed to write ${label} database file`, err).catch(() => {});
    });
  }

  return { scheduleSave, flush };
}
