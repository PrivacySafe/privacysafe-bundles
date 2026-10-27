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
import { areAddressesEqual, includesAddress, toCanonicalAddress } from '@shared/address-utils.ts';

describe('toCanonicalAddress', () => {

  it('lowercases the whole address', () => {
    expect(toCanonicalAddress('Ann@3NWeb.COM')).toBe('ann@3nweb.com');
  });

  it('strips whitespace from the user part', () => {
    expect(toCanonicalAddress('A B@Domain.COM')).toBe('ab@domain.com');
  });

  // The 3NWeb test accounts really are named like this, so the canonical form
  // of a spaced address must stay stable.
  it('canonicalises a spaced 3NWeb address', () => {
    expect(toCanonicalAddress('contacts app tester 1@3nweb.com'))
    .toBe('contactsapptester1@3nweb.com');
  });

  it('treats an address without @ as a bare domain', () => {
    expect(toCanonicalAddress('no-at-here')).toBe('@no-at-here');
  });

  // Asymmetry worth pinning: whitespace is removed from the user part only,
  // so a trailing space in the domain survives canonicalisation and makes two
  // otherwise identical addresses compare as different.
  it('does not strip whitespace from the domain part', () => {
    expect(toCanonicalAddress('a@B.c  ')).toBe('a@b.c  ');
    expect(areAddressesEqual('a@b.c ', 'a@b.c')).toBe(false);
  });

  it('throws on an empty address', () => {
    expect(() => toCanonicalAddress('')).toThrow(/not an address/);
  });

});

describe('areAddressesEqual', () => {

  it('equates addresses differing only in case and user-part spacing', () => {
    expect(areAddressesEqual('Contacts App Tester 1@3NWeb.com', 'contactsapptester1@3nweb.com'))
    .toBe(true);
  });

  it('separates different addresses', () => {
    expect(areAddressesEqual('ann@3nweb.com', 'bob@3nweb.com')).toBe(false);
  });

  // The function guards with `if (!canonicalA) return false`, but
  // toCanonicalAddress throws on a falsy address before that guard can ever
  // run, so the guard is dead code and callers get an exception where the
  // written contract promises `false`. One of the two has to give: either the
  // guard goes, or toCanonicalAddress stops throwing here.
  it('throws instead of returning false for an empty argument', () => {
    expect(() => areAddressesEqual('', 'ann@3nweb.com')).toThrow(/not an address/);
    expect(() => areAddressesEqual('ann@3nweb.com', '')).toThrow(/not an address/);
  });

});

describe('includesAddress', () => {

  it('finds an address regardless of case', () => {
    expect(includesAddress(['Ann@3NWeb.com'], 'ann@3nweb.com')).toBe(true);
  });

  it('returns false for an empty list', () => {
    expect(includesAddress([], 'ann@3nweb.com')).toBe(false);
  });

  it('returns false when the address is absent', () => {
    expect(includesAddress(['bob@3nweb.com'], 'ann@3nweb.com')).toBe(false);
  });

});
