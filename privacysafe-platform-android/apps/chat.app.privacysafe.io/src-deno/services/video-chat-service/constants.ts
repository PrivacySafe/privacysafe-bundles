/*
  Copyright (C) 2026 3NSoft Inc.

  This program is free software: you can redistribute it and/or modify it under
  the terms of the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful, but
  WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
  See the GNU General Public License for more details.

  You should have received a copy of the GNU General Public License along with
  this program. If not, see <http://www.gnu.org/licenses/>.
*/

// =============================================================================
// General Constants
// =============================================================================

export const MSG_REMOVAL_DELAY_MILLIS = 10 * 1000;

/**
 * How long a "the call was handled on another device" notification is left in
 * the inbox before the devices that saw it take it out (see
 * sendCallHandledElsewhere in utils/_common.ts).
 *
 * An ASMail inbox belongs to the user, so this one message is addressed to
 * however many devices happen to be online, and no device knows how many that
 * is. Hence neither extreme works:
 *
 * - Removing it as soon as it is read takes it away from the very devices it
 *   was sent for - including one that is still starting up and will only find
 *   it in its catch-up scan of the inbox.
 * - Leaving it for the regular incoming-message lifetime (15 days) leaves a
 *   long trail of notifications about calls that are long over.
 *
 * Minutes is the right order: a device that was offline while the call was
 * ringing has nothing to silence when it comes back, so the notification is of
 * no use to it - what protects such a device is that it has no ringing call to
 * act on (see handleCallHandledElsewhere), not this window.
 */
export const HANDLED_ELSEWHERE_RETENTION_MILLIS = 3 * 60 * 1000;

/**
 * How old a "handled elsewhere" notification may be and still be acted upon,
 * for notifications that carry no `callSessionId` (builds that predate the
 * field). With a session id, belonging is decided by comparing ids instead -
 * exactly as MAX_SIGNAL_AGE_MILLIS is used for call signals.
 *
 * Deliberately larger than MAX_SIGNAL_AGE_MILLIS (45s): that window bounds how
 * old a *signal of a live call* may be, whereas a call may well have been
 * ringing here for longer than that before someone answered it elsewhere.
 */
export const HANDLED_ELSEWHERE_MAX_AGE_MILLIS = 2 * 60 * 1000;

/**
 * How long a heartbeat is left in the inbox after the device that read it is
 * done with it.
 *
 * A heartbeat says "a call is on in this chat, you may join" - which is a
 * statement to the *user*, not to a device, and the inbox is the user's. Every
 * device of an address has its own use for the same beat: one that already left
 * the call keeps its "Join Call" record alive with it, one that is in the call
 * feeds its host-silence watchdog, and one that has neither gets its button from
 * it. Removing the message the moment the first of them reads it takes it from
 * all the others, and the beat that matters most is the one nobody else can
 * replace: in the live run of 2026-08-16 the device that had left the call ate
 * every beat for two and a half minutes, and its neighbour never saw a "Join
 * Call" button at all.
 *
 * A little over HEARTBEAT_INTERVAL (15s), so at most a beat or two is ever in
 * the inbox at once, and nothing accumulates. Holding one longer would be
 * pointless: a beat older than HEARTBEAT_MAX_AGE_MILLIS is dropped on arrival,
 * so a copy that outlives its window can no longer resurrect anything.
 */
export const HEARTBEAT_RETENTION_MILLIS = 20 * 1000;

// =============================================================================
// WebRTC / Star Architecture Constants
// =============================================================================
// Re-exported from shared-libs to ensure the Deno backend and Vue frontend use
// the exact same values. Previously these were duplicated and desynchronized
// (Deno had MAX_CALL_PARTICIPANTS=10, frontend had =8).

export {
  MAX_CALL_PARTICIPANTS,
  getVideoQualityConfig,
  buildMediaConstraints,
} from '../../../shared-libs/constants/video-call.ts';

export type { VideoQualityConfig } from '../../../shared-libs/constants/video-call.ts';
