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
// Comparison of 3NWeb mail addresses. Used by the GUI store and by the deno
// service, so that "is this address taken" answers the same in both.
import { toCanonicalAddress } from '@shared/address-utils';

/**
 * Canonical form of an address, or undefined when there is nothing to compare.
 *
 * toCanonicalAddress throws on a falsy address, and contact records can carry a
 * blank mail — upsertContactListItem fills one in. Comparison must not blow up
 * on such a record, so a blank or unusable address becomes undefined here.
 */
export function canonicalMail(mail: string | undefined | null): string | undefined {
  if (!mail) {
    return undefined;
  }
  try {
    return toCanonicalAddress(mail);
  } catch {
    return undefined;
  }
}

/**
 * Whether two addresses denote the same 3NWeb account. Case and whitespace in
 * the user part are not part of the identity — 'Ann Tester@3NWeb.com' and
 * 'anntester@3nweb.com' are one address, and treating them as two is how one
 * person ends up as two contacts.
 */
export function isSameMailAddress(
  a: string | undefined | null, b: string | undefined | null,
): boolean {
  const canonicalA = canonicalMail(a);
  if (!canonicalA) {
    return false;
  }
  return (canonicalA === canonicalMail(b));
}

/** Whether `mail` denotes the same account as any address in the list. */
export function includesMailAddress(
  addresses: (string | undefined | null)[], mail: string | undefined | null,
): boolean {
  const canonical = canonicalMail(mail);
  if (!canonical) {
    return false;
  }
  return addresses.some(a => (canonicalMail(a) === canonical));
}
