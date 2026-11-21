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
  EMPTY_CONTACT,
  NEW_EMPTY_CONTACT_ID,
  NEW_POPULATED_CONTACT_ID,
  isNewContactId,
} from '@main/common/constants';

describe('isNewContactId', () => {

  it('accepts both placeholder ids', () => {
    expect(isNewContactId(NEW_EMPTY_CONTACT_ID)).toBe(true);
    expect(isNewContactId(NEW_POPULATED_CONTACT_ID)).toBe(true);
  });

  it('rejects a real contact id', () => {
    expect(isNewContactId('a1b2c3d4')).toBe(false);
  });

  it('rejects absent and empty ids', () => {
    expect(isNewContactId(undefined)).toBe(false);
    expect(isNewContactId(null)).toBe(false);
    expect(isNewContactId('')).toBe(false);
  });

  // The placeholder ids travel through routes and through the RPC boundary, so
  // their literal values are part of the app's external contract: the router
  // matches on them and contacts-db swaps them for a generated id.
  it('keeps the placeholder id values stable', () => {
    expect(NEW_EMPTY_CONTACT_ID).toBe('new');
    expect(NEW_POPULATED_CONTACT_ID).toBe('new-populated');
  });

});

describe('EMPTY_CONTACT', () => {

  it('is recognised as a new contact', () => {
    expect(isNewContactId(EMPTY_CONTACT.id)).toBe(true);
  });

  it('carries blank, not absent, editable text fields', () => {
    expect(EMPTY_CONTACT.name).toBe('');
    expect(EMPTY_CONTACT.mail).toBe('');
    expect(EMPTY_CONTACT.notice).toBe('');
    expect(EMPTY_CONTACT.phone).toBe('');
  });

  it('carries no avatar and a zero timestamp', () => {
    expect(EMPTY_CONTACT.avatarId).toBeUndefined();
    expect(EMPTY_CONTACT.avatarImage).toBeUndefined();
    expect(EMPTY_CONTACT.timestamp).toBe(0);
  });

});
