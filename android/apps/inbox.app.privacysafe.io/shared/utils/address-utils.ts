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
// Comparing ASMail addresses, in the one form both halves of the app can use.
//
// One address has many spellings - case in the domain, case and whitespace in
// the local part - and comparing two of them with === answers wrongly often
// enough to matter: the blacklist is keyed by address, and a sender whose
// spelling differs from the one in the address book would slip straight past it.

const whiteSpace = /\s/g;

export function ensureIsAddressString(address: string): void {
  if (!address || !address.includes('@')) {
    throw new Error(`Value is not an address`);
  }
}

export function parseAddress(address: string): { user: string; domain: string } {
  const parsedData = address.split('@');
  if (parsedData.length === 1) {
    return { user: '', domain: address };
  }

  return { user: parsedData[0].replaceAll(whiteSpace, ''), domain: parsedData[1] };
}

/**
 * The one spelling of an address that this app compares and stores.
 *
 * Throws for a value that is not an address at all - see sameAddress() for the
 * places where that is an answer rather than a fault.
 */
export function toCanonicalAddress(address: string): string {
  ensureIsAddressString(address);
  const { user, domain } = parseAddress(address);
  return `${user}@${domain}`.toLowerCase().trim();
}

export function areAddressesEqual(a: string, b: string): boolean {
  return toCanonicalAddress(a) === toCanonicalAddress(b);
}

export function includesAddress(arr: string[], address: string): boolean {
  const canonAddr = toCanonicalAddress(address);
  return arr.map(toCanonicalAddress).includes(canonAddr);
}

/**
 * areAddressesEqual() for values that came off the wire.
 *
 * The difference is that this one cannot throw. Wherever the compared value is
 * chosen by whoever sent the message - `msg.sender` above all - "this is not an
 * address" is an answer (no, it does not match), not an exceptional condition,
 * and a throw there would escape as an unhandled rejection in the receiving
 * tract.
 */
export function sameAddress(a: unknown, b: unknown): boolean {
  if (!a || !b || (typeof a !== 'string') || (typeof b !== 'string')) {
    return false;
  }
  try {
    return areAddressesEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * toCanonicalAddress() for the same kind of value, answering undefined instead
 * of throwing.
 */
export function canonicalAddressOrUndefined(address: unknown): string | undefined {
  if (!address || (typeof address !== 'string')) {
    return undefined;
  }
  try {
    return toCanonicalAddress(address);
  } catch {
    return undefined;
  }
}
