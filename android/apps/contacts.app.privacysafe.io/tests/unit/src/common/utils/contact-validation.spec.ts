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
  checkEmail,
  checkRequired,
  checkUsage,
  makeMailRules,
} from '@main/common/utils/contact-validation';

/** Stands in for i18n: returns the key, so assertions name the failed rule. */
const t = (key: string) => key;

describe('checkRequired', () => {

  it('accepts a non-empty value', () => {
    expect(checkRequired('ann@3nweb.com', t)).toBe(true);
  });

  it('rejects an empty and an absent value', () => {
    expect(checkRequired('', t)).toBe('validation.text.required');
    expect(checkRequired(undefined, t)).toBe('validation.text.required');
    expect(checkRequired(null, t)).toBe('validation.text.required');
  });

  // The check is a bare truthiness test, so whitespace counts as filled in.
  // Harmless in practice only because checkEmail rejects it right after.
  it('accepts whitespace as filled in', () => {
    expect(checkRequired('   ', t)).toBe(true);
  });

});

describe('checkEmail', () => {

  it('accepts ordinary addresses', () => {
    expect(checkEmail('ann@3nweb.com', t)).toBe(true);
    expect(checkEmail('a@b.co', t)).toBe(true);
    expect(checkEmail('user-777@3nweb.com', t)).toBe(true);
  });

  it('accepts an address in upper case', () => {
    expect(checkEmail('Ann@3NWeb.COM', t)).toBe(true);
  });

  // 3NWeb's own test accounts are named like this, and toCanonicalAddress
  // strips the spaces from the user part, so a spaced address is legitimate
  // here. Any tightening of this rule must keep it passing.
  it('accepts a 3NWeb address containing spaces', () => {
    expect(checkEmail('contacts app tester 1@3nweb.com', t)).toBe(true);
  });

  it('rejects values that are not addresses at all', () => {
    for (const value of ['', 'no-at-here', 'a@b', '@b.c', 'a@.c', 'a@b.', 'a@@b.c']) {
      expect(checkEmail(value, t)).toBe('validation.text.mail');
    }
  });

  it('rejects absent values', () => {
    expect(checkEmail(undefined, t)).toBe('validation.text.mail');
    expect(checkEmail(null, t)).toBe('validation.text.mail');
  });

  // The shared library's mailReg is unanchored, so it accepted anything that
  // merely contained an address. These are the cases that used to slip through.
  it('rejects an address buried in surrounding text', () => {
    expect(checkEmail('hello ann@3nweb.com world', t)).toBe('validation.text.mail');
    expect(checkEmail('ann@3nweb.com and more', t)).toBe('validation.text.mail');
  });

  // toCanonicalAddress strips whitespace from the user part only, so a stray
  // space in the domain would silently make a different address.
  it('rejects leading and trailing whitespace', () => {
    expect(checkEmail(' ann@3nweb.com', t)).toBe('validation.text.mail');
    expect(checkEmail('ann@3nweb.com ', t)).toBe('validation.text.mail');
    expect(checkEmail('\tann@3nweb.com', t)).toBe('validation.text.mail');
  });

  it('accepts a domain with several labels', () => {
    expect(checkEmail('ann.tester@3nweb.co.uk', t)).toBe(true);
    expect(checkEmail('ann+tag@3nweb.com', t)).toBe(true);
  });

  // Deliberately NOT rejected: which characters a user part may contain is not
  // documented anywhere, and inventing a charset here would reject legitimate
  // addresses. If such a policy exists, it belongs in one place, next to
  // toCanonicalAddress.
  it('does not restrict the character set of the user part', () => {
    expect(checkEmail('<script>ann@3nweb.com', t)).toBe(true);
  });

});

describe('checkUsage', () => {

  const taken = ['ann@3nweb.com', 'bob@3nweb.com'];
  const isMailAddressInUse = (mail: string, ignored: string[] = []) =>
    taken.filter(a => !ignored.includes(a)).includes(mail);

  it('accepts a free address', () => {
    expect(checkUsage('cid@3nweb.com', t, isMailAddressInUse, [])).toBe(true);
  });

  it('rejects an address already on another contact', () => {
    expect(checkUsage('ann@3nweb.com', t, isMailAddressInUse, []))
    .toBe('validation.text.usage');
  });

  // While editing, the contact's own current address must not read as taken by
  // itself, or saving an unchanged contact would be refused.
  it('accepts the address the edited contact already has', () => {
    expect(checkUsage('ann@3nweb.com', t, isMailAddressInUse, ['ann@3nweb.com'])).toBe(true);
  });

  // Guards the canonical comparison: with a raw-string check the same address in
  // a different case read as free, both here and in the service, so one person
  // could be stored as two contacts. This suite passes its own
  // isMailAddressInUse, so the canonicalisation it relies on lives in the store
  // and in contacts-db - see their specs.
  it('leaves case handling to isMailAddressInUse', () => {
    const canonicalAware = (mail: string, ignored: string[] = []) => (
      ['ann@3nweb.com'].filter(a => !ignored.includes(a))
      .includes(mail.toLowerCase())
    );

    expect(checkUsage('Ann@3NWeb.com', t, canonicalAware, []))
    .toBe('validation.text.usage');
  });

});

describe('makeMailRules', () => {

  const deps = {
    t,
    isMailAddressInUse: (mail: string) => (mail === 'ann@3nweb.com'),
    ignoredAddresses: () => [] as string[],
  };

  it('evaluates required, then format, then usage', () => {
    const rules = makeMailRules(deps);

    expect(rules).toHaveLength(3);
    expect(rules[0]('')).toBe('validation.text.required');
    expect(rules[1]('not-an-address')).toBe('validation.text.mail');
    expect(rules[2]('ann@3nweb.com')).toBe('validation.text.usage');
  });

  it('passes a free, well formed address through every rule', () => {
    for (const rule of makeMailRules(deps)) {
      expect(rule('cid@3nweb.com')).toBe(true);
    }
  });

  // The ignored list is read at validation time, not when the rules are built:
  // the edited contact is loaded after the field is wired up.
  it('reads the ignored addresses on each evaluation', () => {
    let ignored: string[] = [];
    const rules = makeMailRules({
      t,
      isMailAddressInUse: (mail, ignore = []) => (
        (mail === 'ann@3nweb.com') && !ignore.includes(mail)
      ),
      ignoredAddresses: () => ignored,
    });

    expect(rules[2]('ann@3nweb.com')).toBe('validation.text.usage');

    ignored = ['ann@3nweb.com'];

    expect(rules[2]('ann@3nweb.com')).toBe(true);
  });

});
