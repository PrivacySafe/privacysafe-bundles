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
 * How far back synchronization between the user's devices reaches: phantoms of
 * changes, tombstones, the buffer of orphaned phantoms, deferred removals.
 *
 * A device offline for longer than this cannot announce its change usefully any
 * more - the receiving devices have collected by the same age what the change
 * would have to be applied against.
 */
export const SYNC_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * How long a handled phantom stays in the (shared) inbox before it is removed.
 * The inbox belongs to the user, not to a device, so a phantom this device is
 * done with may be the only copy another device has not seen yet.
 */
export const INBOX_REMOVAL_DELAY_MS = SYNC_WINDOW_MS;

/**
 * A day longer than the removal delay, and that gap is the point: a tombstone
 * is the only thing keeping a catch-up scan from resurrecting deleted mail, so
 * it has to outlive everything that could still bring the message back. With
 * equal windows there is a gap where the tombstone is already collected while
 * removeMsg has not gone through (the server refused, the device was off), and
 * the message comes back from the dead.
 */
export const TOMBSTONE_TTL_MS = SYNC_WINDOW_MS + 24 * 60 * 60 * 1000;

export const ORPHAN_TTL_MS = SYNC_WINDOW_MS;

/**
 * How far before the watermark a catch-up scan starts listing. The watermark is
 * committed per batch and takes the *greatest* processed deliveryTS, so a
 * message with a smaller one that was not processed - for any reason - would
 * otherwise be jumped over.
 */
export const CATCH_UP_REWIND_MS = 60_000;

/**
 * The floor under a catch-up scan's fromTS. Zero is not allowed through, and the
 * reason is a defect in the platform's inbox index: with a falsy fromTS its
 * listing walks into shard files whose names it parsed wrong, and throws ENOENT
 * instead of listing anything. Any fromTS above a shard's misparsed timestamp -
 * the first 7 digits of a 13-digit one, so at most 9 999 999 - makes that
 * listing stop before the broken lookup.
 *
 * 10_000_000 ms is 1970-01-01 02:46:40 UTC: below every message that can exist
 * here, so the floor filters nothing out, and harmless once the platform is
 * fixed.
 */
export const INBOX_SCAN_FLOOR_MS = 10_000_000;

/**
 * How many messages a catch-up scan fetches at once.
 *
 * A scan over a backlog is almost entirely waiting for the fetches, and the
 * measurement says so plainly: over 240 messages it waited 107 s on them and
 * spent 2.5 s applying what came back. So the fetches overlap, while messages
 * are still APPLIED one by one, in the order the listing gives.
 *
 * The window is small because the platform serves inbox calls all but serially:
 * one at a time a message cost 0.69 s, six at a time 0.45 s - about 1.5x, not
 * 6x. Past that the gain is noise while every fetch in flight is another message
 * body held in memory. A backlog this size is a fault to be fixed where it comes
 * from, not to be out-fetched.
 */
export const CATCH_UP_FETCH_WINDOW = 6;

/** Spacing between phantoms of one release pass over the journal. */
export const PHANTOM_SEND_SPACING_MS = 200;

/**
 * The one net under a phantom handed to delivery whose outcome never arrives.
 * Unlike chat.app there is no delivery-reconcile sweep here, so this is the
 * first backstop rather than the second - hence 5 minutes rather than 7.
 */
export const PHANTOM_FLIGHT_GRACE_MS = 5 * 60_000;

/**
 * Backoff of the retry that re-arms a release pass which left work behind. A
 * server that is failing is not helped by insistence.
 */
export const RELEASE_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];

/**
 * How long synchronization work must hold before the GUI says anything. An
 * ordinary action journals a phantom and hands it to delivery within tens of
 * milliseconds, and a flash of "Synchronizing…" over that is noise.
 */
export const SYNC_SHOW_DELAY_MS = 600;
/** How long quiet must hold before the indicator goes away again. */
export const SYNC_HIDE_DELAY_MS = 500;
/** Once shown, how long it stays no matter what - long enough to be read. */
export const SYNC_MIN_VISIBLE_MS = 1200;
