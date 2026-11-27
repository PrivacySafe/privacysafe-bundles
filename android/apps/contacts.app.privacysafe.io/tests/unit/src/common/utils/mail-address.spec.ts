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
  canonicalMail,
  includesMailAddress,
  isSameMailAddress,
} from '@main/common/utils/mail-address';

describe('canonicalMail', () => {

  it('lowercases the address', () => {
    expect(canonicalMail('Ann@3NWeb.COM')).toBe('ann@3nweb.com');
  });

  it('strips whitespace from the user part', () => {
    expect(canonicalMail('Ann Tester@3NWeb.com')).toBe('anntester@3nweb.com');
  });

  // toCanonicalAddress throws on a falsy address, and a contact record can carry
  // a blank mail — upsertContactListItem fills one in. Comparison has to survive
  // such a record rather than take the caller down with it.
  it('answers undefined for a blank or absent address', () => {
    expect(canonicalMail('')).toBeUndefined();
    expect(canonicalMail(undefined)).toBeUndefined();
    expect(canonicalMail(null)).toBeUndefined();
  });

  it('does not throw on a value that is not an address', () => {
    expect(() => canonicalMail('   ')).not.toThrow();
    expect(() => canonicalMail('no-at-here')).not.toThrow();
  });

});

describe('isSameMailAddress', () => {

  it('equates addresses differing only in case', () => {
    expect(isSameMailAddress('Ann@3NWeb.com', 'ann@3nweb.com')).toBe(true);
  });

  it('equates addresses differing only in user-part whitespace', () => {
    expect(isSameMailAddress('ann tester@3nweb.com', 'AnnTester@3nweb.com')).toBe(true);
  });

  it('separates different accounts', () => {
    expect(isSameMailAddress('ann@3nweb.com', 'bob@3nweb.com')).toBe(false);
  });

  // Whitespace is stripped from the user part only, so a stray space in the
  // domain really is a different address as far as the platform is concerned.
  it('keeps domains with differing whitespace apart', () => {
    expect(isSameMailAddress('ann@3nweb.com ', 'ann@3nweb.com')).toBe(false);
  });

  it('never equates a blank address with anything, including another blank', () => {
    expect(isSameMailAddress('', 'ann@3nweb.com')).toBe(false);
    expect(isSameMailAddress('ann@3nweb.com', '')).toBe(false);
    expect(isSameMailAddress('', '')).toBe(false);
    expect(isSameMailAddress(undefined, undefined)).toBe(false);
  });

});

describe('includesMailAddress', () => {

  it('finds an address regardless of case and user-part whitespace', () => {
    const taken = ['Ann Tester@3NWeb.com', 'bob@3nweb.com'];

    expect(includesMailAddress(taken, 'anntester@3nweb.com')).toBe(true);
    expect(includesMailAddress(taken, 'BOB@3nweb.com')).toBe(true);
  });

  it('reports an absent address', () => {
    expect(includesMailAddress(['ann@3nweb.com'], 'cid@3nweb.com')).toBe(false);
  });

  it('reports false for an empty list', () => {
    expect(includesMailAddress([], 'ann@3nweb.com')).toBe(false);
  });

  it('reports false for a blank needle', () => {
    expect(includesMailAddress(['ann@3nweb.com'], '')).toBe(false);
  });

  it('skips blank entries in the list instead of throwing', () => {
    expect(() => includesMailAddress(['', undefined, 'ann@3nweb.com'], 'ann@3nweb.com'))
    .not.toThrow();
    expect(includesMailAddress(['', undefined, 'ann@3nweb.com'], 'ann@3nweb.com')).toBe(true);
  });

});
