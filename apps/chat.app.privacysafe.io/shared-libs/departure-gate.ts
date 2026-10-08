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
 * Deduplication of a peer's 'disconnect', by a monotonic per-peer watermark.
 *
 * A departure rides ASMail as up to four copies: the original plus the blind
 * repeats of TEARDOWN_REPEAT_DELAYS_MILLIS (4/20/60s, _common.ts), and further
 * reactive resends when the platform reports a delivery failure. Every copy is
 * built from the SAME `msg` object, so all of them carry one `WebRTCMsg.id` —
 * whereas a genuinely new departure is stamped with a fresh `Date.now()` (see
 * `disconnectMsg` in call.ts). That is what makes a watermark work where a TTL
 * cache would not: "left → came back → left again" passes on the strength of
 * the new stamp alone, with no window to tune.
 *
 * Handling the copies is not merely a matter of log noise. Each one used to run
 * the host's whole departure path again — ghost-client removal, a
 * 'participant-left' broadcast, an out-of-cycle heartbeat — and a
 * 'participant-left' that lands after the peer has re-joined takes its tile off
 * every other participant's screen.
 *
 * Pure: no `w3n`, no timers, no clock of its own. Both sides of the app use it
 * (the deno background process and the call window), hence its place here.
 *
 * Named after its first application, of which there are now two: the host also
 * gates a returning client's re-join notice with an instance of this (see
 * `arrivals` in call.ts), which reaches it as the same kind of ASMail repeat.
 * The module keeps the name - renaming it would drag the specs and the
 * documentation along for nothing - but what it implements is a general
 * monotonic per-address watermark, not something specific to departures.
 *
 * Deliberately NOT `createSdpFreshnessGate` (webrtc-utils.ts): that one compares
 * strictly (`msgTs < newest`), because two SDP with one stamp are two distinct
 * signals worth applying. Here equality IS the duplicate case, which is the
 * whole point.
 */

import { toCanonicalAddress } from './address-utils.ts';

export interface DepartureGate {
  /**
   * Whether this 'disconnect' is a copy of one already handled for that peer.
   *
   * `sentAt === undefined` — a peer on a build that sends no stamp — always
   * passes, keeping the previous behaviour for it. A fresh stamp both passes and
   * raises the watermark, so the next copy of it is recognized.
   */
  isRepeat(peerAddr: string, sentAt: number | undefined): boolean;
  /** Watermark of that peer, or 0 if none was ever set. For diagnostics. */
  watermarkOf(peerAddr: string): number;
  /** Forgets every peer. For the end of a call, not for a single departure. */
  clear(): void;
}

export function createDepartureGate(): DepartureGate {
  // Keyed canonically: the same peer reaches this from an ASMail envelope, from
  // a chat member list and from a view model, and those differ in case.
  const watermarks = new Map<string, number>();

  return {
    isRepeat(peerAddr, sentAt) {
      if (sentAt === undefined) {
        return false;
      }
      const key = toCanonicalAddress(peerAddr);
      const watermark = watermarks.get(key);
      // Non-strict: all copies of one departure share its stamp, so an equal
      // one is precisely a duplicate.
      if ((watermark !== undefined) && (sentAt <= watermark)) {
        return true;
      }
      watermarks.set(key, sentAt);
      return false;
    },

    watermarkOf: peerAddr => watermarks.get(toCanonicalAddress(peerAddr)) ?? 0,

    clear: () => watermarks.clear(),
  };
}
