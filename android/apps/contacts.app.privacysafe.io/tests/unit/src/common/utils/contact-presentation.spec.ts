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
import { describe, expect, it } from 'vitest';
import {
  ADD_CONTACT_URL_PREFIX,
  buildAddContactUrl,
  initialsOf,
} from '@main/common/utils/contact-presentation';

describe('initialsOf', () => {

  it('takes the first letters of the first two words', () => {
    expect(initialsOf('Ann Tester')).toBe('AT');
    expect(initialsOf('ann tester')).toBe('AT');
  });

  it('ignores words beyond the second', () => {
    expect(initialsOf('Ann Mary Tester')).toBe('AM');
  });

  it('takes two characters of a single word', () => {
    expect(initialsOf('Ann')).toBe('An');
    expect(initialsOf('ANN')).toBe('An');
  });

  it('takes the only character of a one-character name', () => {
    expect(initialsOf('a')).toBe('A');
  });

  it('returns nothing for a blank or absent name', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
    expect(initialsOf(undefined)).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(initialsOf('  Ann Tester  ')).toBe('AT');
  });

  it('collapses repeated separators between words', () => {
    expect(initialsOf('Ann   Tester')).toBe('AT');
  });

  it('handles non-ASCII names', () => {
    expect(initialsOf('Анна Тестер')).toBe('АТ');
    expect(initialsOf('Анна')).toBe('Ан');
  });

  // Indexing a string by position splits a surrogate pair and yields half a
  // character, which renders as a replacement glyph on the avatar. Array.from
  // iterates code points instead.
  it('keeps an astral character whole', () => {
    expect(initialsOf('😀')).toBe('😀');
    expect(initialsOf('😀 Tester')).toBe('😀T');
  });

  it('falls back to the single word branch when a second word is empty', () => {
    expect(initialsOf('Ann ')).toBe('An');
  });

});

describe('buildAddContactUrl', () => {

  const paramsOf = (url: string) =>
    new URLSearchParams(url.slice(ADD_CONTACT_URL_PREFIX.length));

  it('carries the address', () => {
    expect(paramsOf(buildAddContactUrl({ mail: 'ann@3nweb.com' })).get('a'))
    .toBe('ann@3nweb.com');
  });

  it('carries the name alongside the address', () => {
    const params = paramsOf(buildAddContactUrl({ mail: 'ann@3nweb.com', name: 'Ann' }));

    expect(params.get('a')).toBe('ann@3nweb.com');
    expect(params.get('n')).toBe('Ann');
  });

  // Sharing your own address tells a peer how to reach you; what you call
  // yourself in your own address book is not part of that.
  it('omits the name for the user own address', () => {
    const url = buildAddContactUrl({ mail: 'me@3nweb.com', name: 'Me', isOwnAddress: true });

    expect(paramsOf(url).has('n')).toBe(false);
    expect(paramsOf(url).get('a')).toBe('me@3nweb.com');
  });

  it('omits an absent name', () => {
    expect(paramsOf(buildAddContactUrl({ mail: 'ann@3nweb.com' })).has('n')).toBe(false);
  });

  // A 3NWeb address may contain spaces, and a name may contain & or ? — all of
  // which would otherwise break the query apart when the link is parsed back.
  it('escapes characters that would break the query', () => {
    const url = buildAddContactUrl({
      mail: 'contacts app tester 1@3nweb.com',
      name: 'Ann & Bob?',
    });

    expect(url).not.toContain(' ');
    const params = paramsOf(url);
    expect(params.get('a')).toBe('contacts app tester 1@3nweb.com');
    expect(params.get('n')).toBe('Ann & Bob?');
  });

  it('survives a round trip for a plus sign in the address', () => {
    const url = buildAddContactUrl({ mail: 'ann+tag@3nweb.com' });

    expect(paramsOf(url).get('a')).toBe('ann+tag@3nweb.com');
  });

  it('survives a round trip for a non-ASCII name', () => {
    const url = buildAddContactUrl({ mail: 'ann@3nweb.com', name: 'Анна Тестер' });

    expect(paramsOf(url).get('n')).toBe('Анна Тестер');
  });

  it('starts with the add-contact command prefix', () => {
    expect(buildAddContactUrl({ mail: 'ann@3nweb.com' }))
    .toMatch(/^w3n:\/\/add-contact\/\?/);
  });

  it('produces an empty query when there is nothing to share', () => {
    expect(buildAddContactUrl({})).toBe(ADD_CONTACT_URL_PREFIX);
  });

});
