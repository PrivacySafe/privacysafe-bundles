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

// What any contact has to look like before it is stored, whoever hands it over
// (audit of 2026-11-26).

import { describe, expect, it } from 'vitest';
import {
  checkedContact,
  InvalidContactError,
  isAvatarDataURL,
  isImageId,
  MAX_CONTACT_NAME_LENGTH,
  withKeptAspects,
} from '@deno/utils/contact-input-checks.ts';
import { contactRowsOf } from '@deno/dataset/contacts-db.ts';
import { queryResultToPerson } from '@deno/dataset/contact-row-mapping.ts';

const base = { id: 'c1', mail: 'ann@3nweb.com', timestamp: 1 };

describe('checkedContact', () => {
  it('lets a well-formed contact through', () => {
    expect(checkedContact({ ...base, name: 'Ann', phone: '+1', notice: 'line\nline' }))
      .toMatchObject({ name: 'Ann', phone: '+1', notice: 'line\nline' });
  });

  it('refuses a mail that is not an address', () => {
    for (const mail of ['x', '@3nweb.com', 'a@b c.com', 42]) {
      expect(() => checkedContact({ ...base, mail } as never), String(mail)).toThrow(InvalidContactError);
    }
  });

  it('refuses text fields that are not strings', () => {
    expect(() => checkedContact({ ...base, name: 42 } as never)).toThrow(InvalidContactError);
    expect(() => checkedContact({ ...base, notice: { a: 1 } } as never)).toThrow(InvalidContactError);
  });

  it('keeps names one line and bounded', () => {
    const c = checkedContact({ ...base, name: `a\nb${'x'.repeat(500)}` });
    expect(c.name!.includes('\n')).toBe(false);
    expect(c.name!.length).toBe(MAX_CONTACT_NAME_LENGTH);
  });

  it('refuses an avatar id with a path in it', () => {
    expect(() => checkedContact({ ...base, avatarId: '../db' })).toThrow(InvalidContactError);
    expect(checkedContact({ ...base, avatarId: 'Ab_9-x' }).avatarId).toBe('Ab_9-x');
  });

  it('refuses malformed settings and activities', () => {
    expect(() => checkedContact({ ...base, settings: { blockUser: 'no' } } as never)).toThrow(InvalidContactError);
    expect(() => checkedContact({ ...base, activities: [1, 2] } as never)).toThrow(InvalidContactError);
  });
});

describe('withKeptAspects', () => {
  it('keeps blocking and activities an update leaves out', () => {
    const stored = { ...base, settings: { blockUser: true }, activities: ['a'] };
    expect(withKeptAspects({ ...base, name: 'Ann' }, stored as never))
      .toMatchObject({ settings: { blockUser: true }, activities: ['a'] });
    expect(withKeptAspects({ ...base, settings: { blockUser: false } }, stored as never).settings)
      .toEqual({ blockUser: false });
  });
});

describe('avatars', () => {
  it('are raster data URLs with ids that are not paths', () => {
    expect(isAvatarDataURL('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isAvatarDataURL('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isAvatarDataURL('x), url(https://tracker')).toBe(false);
    expect(isImageId('abc-mini')).toBe(true);
    expect(isImageId('a/b')).toBe(false);
  });
});

describe('reading contacts from a db written elsewhere', () => {
  it('answers no rows for a db without the table, instead of throwing', () => {
    expect(contactRowsOf({ exec: () => { throw new Error('no such table: contacts'); } })).toEqual([]);
    expect(contactRowsOf({ exec: () => [] })).toEqual([]);
  });

  it('reads a text column holding another type as text', () => {
    const person = queryResultToPerson({
      columns: ['id', 'mail', 'name', 'notice', 'phone', 'settings', 'activities', 'dates'],
      values: [['c1', 'ann@3nweb.com', 42, null, 7, null, null, null]],
    } as never);
    expect(person.name).toBe('42');
    expect(person.phone).toBe('7');
    expect(person.notice).toBeUndefined();
  });
});
