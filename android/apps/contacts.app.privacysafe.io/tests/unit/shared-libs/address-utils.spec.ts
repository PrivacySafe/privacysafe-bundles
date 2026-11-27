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

  // Since the audit of 2026-11-26 the address is checked, not only reshaped:
  // a shared-contacts file or another app could put "x" into the book as "@x".
  it('refuses what is not an address', () => {
    for (const notAddr of ['no-at-here', '@3nweb.com', 'a@b c.com', 'a@evil.com/x', 'a@ex_ample.com', 'a@xn--p1ai']) {
      expect(() => toCanonicalAddress(notAddr), notAddr).toThrow(/not an address/);
    }
  });

  it('accepts an internationalized domain', () => {
    expect(toCanonicalAddress('Ann@München.de')).toBe('ann@münchen.de');
  });

  it('trims the domain part, so a trailing space is the same address', () => {
    expect(toCanonicalAddress('a@B.c  ')).toBe('a@b.c');
    expect(areAddressesEqual('a@b.c ', 'a@b.c')).toBe(true);
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
  it('answers false, not an exception, for something that is not an address', () => {
    expect(areAddressesEqual('', 'ann@3nweb.com')).toBe(false);
    expect(areAddressesEqual('ann@3nweb.com', '')).toBe(false);
    expect(areAddressesEqual('x', 'x')).toBe(false);
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
