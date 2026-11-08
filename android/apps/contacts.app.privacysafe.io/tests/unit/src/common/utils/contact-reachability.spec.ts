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
import { verdictForAddressCheck } from '@main/common/utils/contact-reachability';
import { en } from '@main/common/data/i18/en';

describe('verdictForAddressCheck', () => {

  it('hands over silently when the address can receive', () => {
    expect(verdictForAddressCheck('found')).toEqual({ proceed: true });
  });

  // Starting the chat app for an address that cannot be reached would produce a
  // conversation whose messages silently never arrive.
  it('stops the handover when there is no such account at the domain', () => {
    const verdict = verdictForAddressCheck('not-present-at-domain');

    expect(verdict.proceed).toBe(false);
    expect(verdict.noticeType).toBe('error');
    expect(verdict.noticeKey).toBe('reachability.not-present-at-domain');
  });

  it('stops the handover when the domain runs no messaging service', () => {
    const verdict = verdictForAddressCheck('no-service-for-domain');

    expect(verdict.proceed).toBe(false);
    expect(verdict.noticeType).toBe('error');
  });

  // Whether this particular user is allowed is the recipient's decision, and it
  // can differ per app — so this warns and carries on rather than refusing.
  it('warns but still hands over when the address restricts senders', () => {
    const verdict = verdictForAddressCheck('found-but-access-restricted');

    expect(verdict.proceed).toBe(true);
    expect(verdict.noticeType).toBe('warning');
    expect(verdict.noticeKey).toBe('reachability.access-restricted');
  });

  // The check is a hint about the ADDRESS, not a gate on our own ability to run
  // it. Offline, or a failed check, is our problem; refusing to act on it would
  // turn a hint into an outage.
  it('hands over silently when the check could not be made', () => {
    expect(verdictForAddressCheck(undefined)).toEqual({ proceed: true });
  });

  // A notice the user never sees would be worse than none: it would stop the
  // handover without saying why.
  it('names a message that actually exists for every notice it asks for', () => {
    const results = [
      'found', 'not-present-at-domain', 'no-service-for-domain',
      'found-but-access-restricted',
    ] as const;

    for (const result of results) {
      const { noticeKey } = verdictForAddressCheck(result);
      if (!noticeKey) {
        continue;
      }
      const message = noticeKey.split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
      expect(typeof message, `message for ${noticeKey}`).toBe('string');
    }
  });

});
