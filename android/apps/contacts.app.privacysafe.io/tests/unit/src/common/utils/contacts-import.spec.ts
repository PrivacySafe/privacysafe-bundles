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
import { differingFields, mergeContact } from '@main/common/utils/contacts-import';
import type { ImportedContact, Person } from '@main/types';

function existing(over: Partial<Person> = {}): Person {
  return {
    id: 'c1',
    mail: 'Ann@3nweb.com',
    name: 'Ann',
    phone: '111',
    notice: 'met at work',
    avatarId: 'av-old',
    avatarImage: 'data:image/png;base64,OLD',
    settings: { blockUser: true },
    activities: ['a1'],
    timestamp: 5,
    ...over,
  };
}

function incoming(over: Partial<ImportedContact> = {}): ImportedContact {
  return {
    mail: 'ann@3nweb.com',
    name: 'Ann Smith',
    phone: '',
    notice: 'friend',
    avatarId: 'av-new',
    avatarImage: 'data:image/png;base64,NEW',
    timestamp: 7,
    settings: null,
    activities: null,
    key: null,
    ...over,
  };
}

describe('differingFields', () => {

  it('lists only fields whose values differ', () => {
    expect(differingFields(existing(), incoming({ notice: 'met at work' })))
      .toEqual(['avatar', 'name', 'phone']);
  });

  it('treats a missing value as an empty one', () => {
    expect(differingFields(
      existing({ phone: undefined, avatarImage: undefined, avatarId: undefined }),
      incoming({ name: 'Ann', notice: 'met at work', phone: '', avatarImage: undefined }),
    )).toEqual([]);
  });

});

describe('mergeContact', () => {

  it('changes nothing when the current contact is kept', () => {
    expect(mergeContact(existing(), incoming(), { kind: 'keep' })).toBeUndefined();
  });

  // Taking the received contact is literal: an empty received field clears
  // the current value, the phone here.
  it('takes every received field, empty ones included', () => {
    const res = mergeContact(existing(), incoming(), { kind: 'incoming' });

    expect(res?.avatarSource).toBe('incoming');
    expect(res?.contact).toMatchObject({
      id: 'c1',
      name: 'Ann Smith',
      phone: '',
      notice: 'friend',
      avatarId: undefined,
    });
  });

  it('keeps the current address, settings and activities', () => {
    const res = mergeContact(existing(), incoming(), { kind: 'incoming' });

    expect(res?.contact.mail).toBe('Ann@3nweb.com');
    expect(res?.contact.settings).toEqual({ blockUser: true });
    expect(res?.contact.activities).toEqual(['a1']);
  });

  it('takes chosen fields from their chosen side', () => {
    const res = mergeContact(existing(), incoming(), {
      kind: 'fields',
      fields: { avatar: 'current', name: 'incoming', phone: 'current', notice: 'incoming' },
    });

    expect(res?.avatarSource).toBe('current');
    expect(res?.contact).toMatchObject({
      name: 'Ann Smith',
      phone: '111',
      notice: 'friend',
      avatarId: 'av-old',
    });
  });

  it('changes nothing when every chosen field is the current one', () => {
    expect(mergeContact(existing(), incoming(), {
      kind: 'fields',
      fields: { avatar: 'current', name: 'current', phone: 'current', notice: 'current' },
    })).toBeUndefined();
  });

  it('takes only the avatar, when only it is chosen', () => {
    const res = mergeContact(existing(), incoming(), {
      kind: 'fields',
      fields: { avatar: 'incoming', name: 'current', phone: 'current', notice: 'current' },
    });

    expect(res?.avatarSource).toBe('incoming');
    expect(res?.contact).toMatchObject({ name: 'Ann', phone: '111', notice: 'met at work' });
  });

});
