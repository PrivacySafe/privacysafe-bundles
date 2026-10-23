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
import { SQLiteOn3NStorage } from '../../shared/libs/sqlite-on-3nstorage/index.js';
import { SingleProc } from '../../shared/utils/processes/single.ts';
import { DB_FLUSH_DELAY_MS, DB_FLUSH_MAX_PENDING } from '../../shared/constants/db.ts';

/**
 * Batches writes of a database file.
 *
 * SQLiteOn3NStorage.saveToFile() serializes the *whole* database and rewrites
 * the file, and its internal queue runs such calls one after another without
 * collapsing them. Writing on every mutation therefore costs O(db size) per
 * mutation, and one logical operation (say, receiving a message: add the
 * record, then stamp the receiving watermark) paid that cost several times over.
 *
 * So mutations mark the database dirty instead of writing, and the actual write
 * happens once per batch. Reads are unaffected: they all go to the in-memory
 * sql.js database, never to the file.
 *
 * The trade-off is durability, and it is handled by the callers: anything that
 * makes a change observable outside this device (queueing a message for
 * delivery, advancing the receiving watermark, removing a message from the
 * server) calls flush() first. See DBProvider.flush() users.
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
      try {
        await sqlite.saveToFile({ skipUpload: true });
      } catch (err) {
        // Otherwise the change is dropped silently and never reaches the file.
        dirty = true;
        throw err;
      }
    });
  }

  function scheduleSave(): void {
    dirty = true;
    pending += 1;
    if (pending >= DB_FLUSH_MAX_PENDING) {
      flushInBackground();
      return;
    }
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        flushInBackground();
      }, DB_FLUSH_DELAY_MS);
    }
  }

  function flushInBackground(): void {
    flush().catch(err => w3n.log('error', `Failed to write ${label} database file`, err));
  }

  return { scheduleSave, flush };
}
