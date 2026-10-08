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
import { canonicalAddressOrUndefined } from '@shared/utils/address-utils';
import type { IncomingMessageView, OutgoingMessageView } from '@common/types';

/**
 * Every address this mailbox has actually dealt with.
 *
 * The sender of an incoming message, every recipient of an outgoing one, over
 * ALL folders - the trash included, since an address whose mail one threw away
 * is exactly the kind worth blocking.
 *
 * Canonical and deduplicated, with the user's own address left out. Kept apart
 * from the dialog that shows it because "what counts as an address this user has
 * used" is the part worth a test of its own.
 *
 * @returns addresses in the spelling first met, not canonicalized - that is what
 *          the user recognizes; comparison is done on the canonical form.
 */
export function collectUsedAddresses(
  messages: Array<IncomingMessageView | OutgoingMessageView>,
  ownAddr: string,
): string[] {
  const own = canonicalAddressOrUndefined(ownAddr);
  const found = new Map<string, string>();

  function take(address: unknown): void {
    const canonical = canonicalAddressOrUndefined(address);
    if (!canonical || (canonical === own) || found.has(canonical)) {
      return;
    }
    found.set(canonical, address as string);
  }

  for (const msg of messages) {
    if ('sender' in msg) {
      take((msg as IncomingMessageView).sender);
    } else {
      for (const recipient of (msg as OutgoingMessageView).recipients ?? []) {
        take(recipient);
      }
    }
  }

  return [...found.values()];
}
