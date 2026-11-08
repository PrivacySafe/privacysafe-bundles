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
 * How long the compose form waits after a change before it saves the draft.
 *
 * Every field goes through it, so that a burst of typing costs one write rather
 * than one per keystroke. What a change does at once - taking out a blocked
 * address, and telling the mobile page what the form now holds - is not delayed
 * by it; only the write is. A form that closes flushes whatever is pending.
 */
export const DRAFT_SAVE_DELAY_MS = 1000;
