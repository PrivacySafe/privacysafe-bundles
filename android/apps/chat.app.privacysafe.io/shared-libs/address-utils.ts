/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

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

export function areAddressesEqual(a: string, b: string): boolean {
  const canonicalA = toCanonicalAddress(a);
  if (!canonicalA) {
    return false;
  }

  const canonicalB = toCanonicalAddress(b);
  if (!canonicalB) {
    return false;
  }

  return canonicalA === canonicalB;
}

const whiteSpace = /\s/g;

export function ensureIsAddressString(address: string): void {
  if (!address || !address.includes('@')) {
    throw new Error(`Value is not an address`);
  }

  // ToDo We need to add other checks
}

export function toCanonicalAddress(address: string): string {
  ensureIsAddressString(address);

  const indOfAt = address.indexOf('@');
  let user: string;
  let domain: string;

  if (indOfAt < 0) {
    domain = address;
    user = '';
  } else {
    domain = address.substring(indOfAt + 1);
    user = address.substring(0, indOfAt).replace(whiteSpace, '');
  }

  return `${user}@${domain}`.toLowerCase().trim();
}

export function includesAddress(arr: string[], address: string): boolean {
  const canonAddr = toCanonicalAddress(address);
  return arr.map(toCanonicalAddress).includes(canonAddr);
}

/**
 * areAddressesEqual() for values that came off the wire.
 *
 * The difference is that this one cannot throw. `areAddressesEqual` canonicalizes
 * through `ensureIsAddressString`, which throws on anything without an '@' - so
 * its own `if (!canonicalA)` guards are unreachable, and an empty string, a
 * `screen:x:y` pseudo-address or a non-string all raise instead of answering.
 *
 * That matters wherever the compared value is chosen by whoever sent the
 * message: for a signal handler on the host, "this is not an address" is an
 * answer (no, it does not match), not an exceptional condition. On the
 * DataChannel path the throw would be swallowed by the JSON parse's catch and
 * read as a malformed message; on the ASMail path it would escape as an
 * unhandled rejection.
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
