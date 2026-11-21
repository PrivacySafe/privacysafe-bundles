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

export const CHATS_DB_FNAME = 'chats-db';

export const MSGS_DBS_DIR_NAME = 'msgs-dbs';

export const ORPHANED_MSGS_DBS_DIR_NAME = 'msgs-orphaned-dbs';

export const MSGS_DB_FNAME_PREFIX = 'msgs-db_';

export const DATASET_META_ATTR = 'chat-dataset';

export const MAIN_DB_META_ATTR = 'msgs';

export const AUXILIARY_DB_META_ATTR = 'msgs-orphaned';

export const CHATS_DB_META_ATTR = 'chats';

export const LIFETIME_DAYS_IN_AUXILIARY_DB = 15 * 24 * 60 * 60 * 1000;

/**
 * How long a mutation may sit in memory before the database file is written.
 * Every write serializes the whole database, so mutations of one logical
 * operation must coalesce into a single write; this is the window in which
 * they do.
 */
export const DB_FLUSH_DELAY_MS = 250;

/**
 * Upper bound on mutations buffered before a write is forced, so that a bulk
 * synchronization doesn't defer writing indefinitely.
 */
export const DB_FLUSH_MAX_PENDING = 64;

/**
 * A healthy write of even a large database takes seconds; past this we say so
 * in the log, while still waiting.
 */
export const DB_WRITE_WARN_MS = 10000;

/**
 * How long we are willing to wait for the file system before calling a write
 * stuck and letting the write queue go.
 *
 * Generous on purpose: the point is not to cut a slow write short but to keep
 * one that will never finish from holding the queue forever - and behind that
 * queue sit the inbox dispatcher and the watermark commit, which is how a
 * frozen write turns into a component that has stopped doing anything at all.
 */
export const DB_WRITE_TIMEOUT_MS = 60000;

/**
 * Pause before the next attempt after a write timed out, so that a stuck file
 * system collects one abandoned write per half-minute instead of one per
 * mutation.
 */
export const DB_WRITE_STALL_RETRY_MS = 30000;

/**
 * How many inbox messages are processed before their changes are flushed and
 * the inbox watermark is advanced.
 */
export const INBOX_COMMIT_BATCH = 32;

/**
 * How far behind the newest processed message the inbox watermark may be held
 * by a message that failed to fetch or process (see makeFailureFloor in
 * inbox-dispatcher.ts). Within the window the failed message is retried by
 * every start-up's catch-up scan; past it the watermark moves on - an
 * ever-failing message must not turn every start-up into a re-fetch of an
 * unbounded stretch of the inbox.
 */
export const MAX_WATERMARK_LAG = 24 * 60 * 60 * 1000;

/**
 * Upper bound on record-resync asks sent in one session (see msg-resync.ts).
 * Asks travel the same ASMail delivery as everything else, including call
 * signalling; a device with a long backlog of missing records asks for the
 * rest on its next start instead of bursting them all at once.
 */
export const MAX_RESYNC_ASKS_PER_SESSION = 16;

/**
 * How many messages of a chat's history are read at a time. Opening a chat takes
 * the newest page, and scrolling up takes the preceding ones: the whole history
 * would otherwise cross IPC as one JSON blob on every open.
 */
export const MSGS_PAGE_SIZE = 100;

/**
 * Upper bound on pages pulled while looking for a particular message (a jump to
 * a quoted original). Bounded on purpose - a quote of a very old message must
 * not drag in the whole history, which is what paging is here to avoid.
 */
export const MAX_PAGES_PER_MSG_LOOKUP = 10;

