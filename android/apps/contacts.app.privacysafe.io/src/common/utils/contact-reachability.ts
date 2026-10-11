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
// What to do with the answer of an ASMail address check, before handing a
// contact over to the chat or the inbox app. A separate decision from the check
// itself, so it can be read and tested as a table.
import type { AddressCheckResult } from '@main/types';

export interface ReachabilityVerdict {
  /** Whether the other app should be started at all. */
  proceed: boolean;
  /** i18n key of the notice to show, when there is something to say. */
  noticeKey?: string;
  /** Severity of that notice. */
  noticeType?: 'error' | 'warning';
}

/**
 * The check is a HINT, not a gate on our own ability to run it:
 *
 *  - a definite "this address cannot receive" stops the handover and says why.
 *    Starting the chat app for an address that cannot be reached would produce a
 *    conversation whose messages silently never arrive;
 *  - an address that exists but restricts senders DOES proceed. Whether this
 *    user is allowed is the recipient's decision, and it can differ per app;
 *  - `undefined` means the check could not be made — offline, or the check
 *    itself failed. That is our problem, not the address's, so the handover
 *    proceeds. Being unable to verify must not become a refusal to act.
 */
export function verdictForAddressCheck(
  result: AddressCheckResult | undefined,
): ReachabilityVerdict {
  switch (result) {

    case 'not-present-at-domain':
      return {
        proceed: false,
        noticeKey: 'reachability.not-present-at-domain',
        noticeType: 'error',
      };

    case 'no-service-for-domain':
      return {
        proceed: false,
        noticeKey: 'reachability.no-service-for-domain',
        noticeType: 'error',
      };

    case 'found-but-access-restricted':
      return {
        proceed: true,
        noticeKey: 'reachability.access-restricted',
        noticeType: 'warning',
      };

    case 'found':
    default:
      return { proceed: true };

  }
}
