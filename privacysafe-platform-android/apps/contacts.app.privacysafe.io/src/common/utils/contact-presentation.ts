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
// Presentation-only derivations shared by the avatar and the sharing dialog.

/** Command the platform routes to this app for an incoming contact link. */
export const ADD_CONTACT_URL_PREFIX = 'w3n://add-contact/?';

/**
 * Initials shown on an avatar that has no photo: first letters of the first two
 * words, or the first two characters of a single word.
 *
 * Uses Array.from rather than indexing, so that a name starting with a
 * character outside the BMP (an emoji, for instance) yields that whole
 * character instead of half of a surrogate pair.
 */
export function initialsOf(name?: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return '';
  }

  const chars = Array.from(trimmed);
  if (chars.length === 1) {
    return chars[0].toLocaleUpperCase();
  }

  const words = trimmed.split(/\s+/).filter(w => !!w);
  if (words.length >= 2) {
    const first = Array.from(words[0])[0];
    const second = Array.from(words[1])[0];
    if (first && second) {
      return `${first.toLocaleUpperCase()}${second.toLocaleUpperCase()}`;
    }
  }

  return `${chars[0].toLocaleUpperCase()}${(chars[1] ?? '').toLocaleLowerCase()}`;
}

/**
 * Builds the link encoded into the sharing QR code. The name is omitted for the
 * user's own address — there is no point telling a peer what the peer should
 * call you.
 */
export function buildAddContactUrl(
  { mail, name, isOwnAddress }: { mail?: string; name?: string; isOwnAddress?: boolean },
): string {
  const query = ([
    ['a', mail],
    ['n', isOwnAddress ? '' : name],
  ] as [string, string | undefined][])
    .filter(([, value]) => !!value)
    .map(([field, value]) => `${field}=${encodeURIComponent(value!)}`)
    .join('&');
  return `${ADD_CONTACT_URL_PREFIX}${query}`;
}
