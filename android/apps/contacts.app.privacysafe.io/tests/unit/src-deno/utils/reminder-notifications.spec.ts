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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OPEN_CONTACT_CMD,
  readUiLanguage,
  reminderNotificationOpts,
  reminderNotificationTexts,
} from '@deno/utils/reminder-notifications.ts';
import { logoIcon } from '@deno/logo-icon.ts';
import type { DateReminder } from '@deno/utils/date-reminders.ts';

const reminder: DateReminder = {
  contactId: 'c1',
  displayName: 'Ann',
  date: { id: 'b1', type: 'birthday', month: 3, day: 15, year: 1990, notify: true },
  age: 36,
};

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).w3n;
});

describe('reminder notifications', () => {

  it('names the contact and the age', () => {
    expect(reminderNotificationTexts(reminder, 'en')).toEqual({
      title: 'Birthday: Ann',
      body: 'Ann turns 36 today.',
    });
  });

  it('says nothing of the age when it is not known', () => {
    expect(reminderNotificationTexts({ ...reminder, age: undefined }, 'en').body)
      .toBe('Today is the birthday of Ann.');
  });

  it('speaks the language of the launcher, and English for an unknown one', () => {
    expect(reminderNotificationTexts(reminder, 'es').title).toBe('Cumpleaños: Ann');
    expect(reminderNotificationTexts(reminder, 'fr').body).toContain('36');
    expect(reminderNotificationTexts(reminder, 'xx').title).toBe('Birthday: Ann');
  });

  it('opens the contact on a click', () => {
    const icon = new Uint8Array([1]);
    expect(reminderNotificationOpts(reminder, 'en', icon)).toMatchObject({
      icon,
      cmd: { cmd: OPEN_CONTACT_CMD, params: [{ contactId: 'c1' }] },
    });
  });

  it('builds in a png logo', () => {
    expect([...logoIcon().subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('reads the language of the launcher', async () => {
    const readJSON = vi.fn(async () => ({ lang: 'fr' }));
    (globalThis as unknown as Record<string, unknown>).w3n = {
      shell: { getFSResource: vi.fn(async () => ({ readJSON })) },
    };

    expect(await readUiLanguage()).toBe('fr');
  });

  it('falls back to English when the language cannot be read', async () => {
    (globalThis as unknown as Record<string, unknown>).w3n = {
      shell: { getFSResource: vi.fn(async () => { throw new Error('no resource'); }) },
    };

    expect(await readUiLanguage()).toBe('en');
  });

});
