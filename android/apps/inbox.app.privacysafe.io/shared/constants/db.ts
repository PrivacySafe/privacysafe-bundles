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
 * How long a batch of database mutations is collected before the file is
 * written. Short enough that a crash loses at most this much work, long enough
 * that one logical operation pays for a single write.
 */
export const DB_FLUSH_DELAY_MS = 250;

/**
 * Mutations that force a write without waiting out the delay, so that a bulk
 * operation does not grow an unbounded amount of unwritten work.
 */
export const DB_FLUSH_MAX_PENDING = 64;

/**
 * How many processed inbox messages one watermark commit covers.
 *
 * A commit flushes the database, which rewrites the whole file, so committing
 * per message would put back exactly the writes batching removes. With sync
 * phantoms the message rate goes up by a multiple, which is what makes the
 * batch worth having.
 */
export const INBOX_COMMIT_BATCH = 32;

/**
 * How far behind the newest processed message the watermark may be held by a
 * message that keeps failing.
 *
 * Without a limit, one permanently broken message pins the watermark for good,
 * and every start's catch-up scan grows into a re-fetch of an unbounded stretch
 * of the inbox. Within the window the failed message is retried by every scan;
 * past it, it is given up on.
 */
export const MAX_WATERMARK_LAG = 24 * 60 * 60 * 1000;
