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
 * The lowest `fromTS` a listing of the shared inbox may be asked for.
 *
 * Zero - the natural "from the beginning" - is not usable: on a falsy fromTS
 * the platform's inbox index goes into shard files whose names it then parses
 * wrongly, and throws ENOENT instead of listing anything. A caller that swallows
 * the failure sees "nothing to list" and silently does no work, which is exactly
 * what a device with a zero watermark (a fresh install - the very case a restore
 * is for) used to do on every start.
 *
 * The value is a wall-clock millisecond stamp far below any real deliveryTS, yet
 * not falsy: listing from it is listing everything.
 *
 * Two independent places need it - the catch-up scan over the shared inbox
 * (inbox-dispatcher.ts) and the single listing a restore makes to decide whether
 * an archived `incomingMsgId` still points at anything.
 */
export const INBOX_SCAN_FLOOR_MS = 10_000_000;
