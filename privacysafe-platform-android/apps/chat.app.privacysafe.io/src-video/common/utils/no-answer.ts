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

import type { ConnectionStatus } from '@video/common/types/peer.types';

/** How long an invited peer may stay silent before it is called not responding. */
export const NO_ANSWER_TIMEOUT_MS = 45_000;

/** How often the roster is re-checked against that deadline. */
export const NO_ANSWER_SWEEP_INTERVAL_MS = 5_000;

/** What the rule below needs to know about a participant. */
export interface PeerAwaitingAnswer {
  addr: string;
  connectionStatus: ConnectionStatus;
  /** Whether anything has arrived from this peer - a stream makes the question moot. */
  hasMedia: boolean;
  /** When the peer entered the roster as 'invited'; absent for anyone never seeded as such. */
  invitedAt?: number;
}

/**
 * Which invited peers have been silent long enough to be called not responding.
 *
 * A rule rather than a timer, and it is deliberately about *the peer's* clock
 * rather than the window's. Both halves of that came from the live run of
 * 2026-08-16:
 *
 * - the deadline used to be one `setTimeout` armed when the call view mounted,
 *   so the host - which mounts it as the invitations go out - reached the verdict
 *   45s in, while a client, whose window opens only after the invitation crossed
 *   ASMail, rang, and was answered by hand, was still 25-70s behind it. The same
 *   absent peer read "is not responding" on one screen and "Calling…" on another;
 * - and being a single pass, a miss was permanent: a window minimised into
 *   Chromium's timer throttling, or a peer that entered the roster later, kept
 *   "Calling…" until the call ended, because nothing looked again.
 *
 * Saying "not responding" is not a verdict on the peer, only on the wait: a peer
 * who shows up later overwrites it with the status of a real signal (see
 * applyPeerStatus), and the tile appears as usual.
 */
export function peersToMarkNoAnswer(
  peers: readonly PeerAwaitingAnswer[],
  now: number,
  timeoutMs: number = NO_ANSWER_TIMEOUT_MS,
): string[] {
  return peers
    .filter(p => (
      (p.connectionStatus === 'invited')
      && !p.hasMedia
      // No timestamp means this peer was never seeded as invited, and there is
      // no honest moment to count from: leave it to the signalling.
      && (typeof p.invitedAt === 'number')
      && ((now - p.invitedAt) >= timeoutMs)
    ))
    .map(p => p.addr);
}
