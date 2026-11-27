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
  const canonicalA = checkAndTransformAddress(a);
  if (!canonicalA) {
    return false;
  }
  const canonicalB = checkAndTransformAddress(b);
  if (!canonicalB) {
    return false;
  }
  return (canonicalA === canonicalB);
}

const whiteSpace = /\s/g;
const invalidInAsciiDomain = /[^a-z0-9\-.]/;
// Characters that make a URL parser read the rest as something else than a host.
const notInDomain = /[\s/?#@:\\%]/;

/**
 * The ASCII form of a domain, an internationalized one included (the URL
 * parser does the IDNA mapping, in the GUI and in Deno alike), or undefined
 * for a string that is not a domain.
 */
function asciiDomain(domain: string): string | undefined {
  if (!domain || notInDomain.test(domain) || domain.startsWith('xn--')) {
    return undefined;
  }
  let host: string;
  try {
    host = new URL(`http://${domain}/`).hostname;
  } catch {
    return undefined;
  }
  return (host && !invalidInAsciiDomain.test(host)) ? host : undefined;
}

/**
 * The canonical form of a 3NWeb address: the user part without whitespace,
 * lower-cased, at a valid domain. Throws for anything that is not an address.
 *
 * It used to take nearly any string ("x" came out as "@x"), so addresses from
 * shared-contacts files and from other apps went into the book unchecked (audit
 * of 2026-11-26). The display form of the domain is kept: only its validity is
 * judged by its ASCII form.
 */
export function toCanonicalAddress(address: string): string {
  if (!address || (typeof address !== 'string')) {
    throw new Error(`Value is not an address`);
  }
  const indOfAt = address.indexOf('@');
  if (indOfAt < 0) {
    throw new Error(`Value is not an address`);
  }
  let domain = address.substring(indOfAt + 1).trim();
  const user = address.substring(0, indOfAt).replace(whiteSpace, '');
  if (domain.endsWith('.')) {
    domain = domain.substring(0, domain.length - 1);
  }
  if (!user || !asciiDomain(domain)) {
    throw new Error(`Value is not an address`);
  }
  return (user + '@' + domain).toLowerCase();
}

/** toCanonicalAddress() that answers undefined instead of throwing. */
export function checkAndTransformAddress(address: unknown): string | undefined {
  try {
    return toCanonicalAddress(address as string);
  } catch {
    return undefined;
  }
}

export function includesAddress(arr: string[], address: string): boolean {
  const canonAddr = checkAndTransformAddress(address);
  return !!canonAddr && arr.map(checkAndTransformAddress).includes(canonAddr);
}
