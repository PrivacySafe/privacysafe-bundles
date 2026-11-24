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
  findDueReminders,
  makeDateReminders,
  reminderKey,
  REMINDER_HOUR,
  type DateReminder,
  type ReminderState,
} from '@deno/utils/date-reminders.ts';
import type { ContactWithDates } from '@deno/dataset/contacts-db.ts';

const ann: ContactWithDates = {
  id: 'c1',
  name: 'Ann',
  mail: 'ann@3nweb.com',
  dates: [{ id: 'b1', type: 'birthday', month: 3, day: 15, year: 1990, notify: true }],
};

const bob: ContactWithDates = {
  id: 'c2',
  name: '',
  mail: 'bob@3nweb.com',
  dates: [{ id: 'b2', type: 'birthday', month: 3, day: 15 }],
};

function at(hour: number, day = 15): Date {
  return new Date(2026, 2, day, hour, 0);
}

function setup({ contacts = [ann], stored, now = at(REMINDER_HOUR) }: {
  contacts?: ContactWithDates[];
  stored?: ReminderState;
  now?: Date;
} = {}) {
  const clock = { now };
  const written: ReminderState[] = [];
  const shown: DateReminder[] = [];
  const deps = {
    listContacts: vi.fn(() => contacts),
    readState: vi.fn(async () => stored),
    writeState: vi.fn(async (state: ReminderState) => {
      written.push(state);
    }),
    notify: vi.fn(async (reminder: DateReminder) => {
      shown.push(reminder);
    }),
    now: () => clock.now,
    onError: vi.fn(),
  };
  return { reminders: makeDateReminders(deps), deps, clock, written, shown };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('findDueReminders', () => {

  it('takes the dates of the day that ask for a reminder', () => {
    expect(findDueReminders([ann, bob], at(9))).toEqual([
      { contactId: 'c1', displayName: 'Ann', date: ann.dates[0], age: 36 },
    ]);
  });

  it('names the contact by its mail when it has no name', () => {
    const noName = { ...bob, dates: [{ ...bob.dates[0], notify: true }] };
    expect(findDueReminders([noName], at(9))[0]).toMatchObject({ displayName: 'bob@3nweb.com', age: undefined });
  });

  it('finds nothing on another day', () => {
    expect(findDueReminders([ann], at(9, 16))).toEqual([]);
  });

});

describe('date reminders', () => {

  it('shows nothing before 08:00', async () => {
    const { reminders, deps } = setup({ now: at(REMINDER_HOUR - 1) });

    expect(await reminders.check()).toBe(0);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('shows a due reminder at 08:00 and records it', async () => {
    const { reminders, written, shown } = setup();

    expect(await reminders.check()).toBe(1);
    expect(shown).toHaveLength(1);
    expect(written).toEqual([{ day: '2026-03-15', shown: ['c1:b1'] }]);
  });

  it('shows it later the same day, when the device was off at 08:00', async () => {
    const { reminders, shown } = setup({ now: at(17) });

    await reminders.check();
    expect(shown).toHaveLength(1);
  });

  it('does not show it twice', async () => {
    const { reminders, deps, clock } = setup();

    await reminders.check();
    clock.now = at(12);
    expect(await reminders.check()).toBe(0);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.writeState).toHaveBeenCalledTimes(1);
  });

  it('does not show it again after a restart of the service', async () => {
    const { reminders, deps } = setup({ stored: { day: '2026-03-15', shown: ['c1:b1'] } });

    expect(await reminders.check()).toBe(0);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('forgets the marks of another day', async () => {
    const { reminders, written } = setup({ stored: { day: '2025-03-15', shown: ['c1:b1', 'old:x'] } });

    expect(await reminders.check()).toBe(1);
    expect(written).toEqual([{ day: '2026-03-15', shown: ['c1:b1'] }]);
  });

  it('shows the reminder of the next year again', async () => {
    const { reminders, deps, clock } = setup();

    await reminders.check();
    clock.now = new Date(2027, 2, 15, 9);
    expect(await reminders.check()).toBe(1);
    expect(deps.notify).toHaveBeenCalledTimes(2);
  });

  it('shows a reminder switched on during the day', async () => {
    const contacts: ContactWithDates[] = [{ ...ann, dates: [{ ...ann.dates[0], notify: false }] }];
    const { reminders, deps } = setup({ contacts });

    expect(await reminders.check()).toBe(0);
    contacts[0] = ann;
    expect(await reminders.check()).toBe(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('leaves a reminder that failed to the next check', async () => {
    const { reminders, deps } = setup();
    deps.notify.mockRejectedValueOnce(new Error('no notifications'));

    expect(await reminders.check()).toBe(0);
    expect(deps.onError).toHaveBeenCalled();
    expect(deps.writeState).not.toHaveBeenCalled();
    expect(await reminders.check()).toBe(1);
  });

  it('works with defaults when the stored marks cannot be read', async () => {
    const { reminders, deps } = setup();
    deps.readState.mockRejectedValueOnce(new Error('broken file'));

    expect(await reminders.check()).toBe(1);
    expect(deps.onError).toHaveBeenCalled();
  });

  it('ignores a malformed stored state', async () => {
    const { reminders } = setup({ stored: { day: 7, shown: 'x' } as unknown as ReminderState });

    expect(await reminders.check()).toBe(1);
  });

  it('does not run two checks at once', async () => {
    const { reminders, deps } = setup();

    const [a, b] = await Promise.all([reminders.check(), reminders.check()]);
    expect(a + b).toBe(2);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('checks at start and then on every interval', async () => {
    vi.useFakeTimers();
    const { reminders, deps, clock } = setup({ now: at(7) });

    reminders.start(1000);
    reminders.start(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.notify).not.toHaveBeenCalled();

    clock.now = at(8);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.notify).toHaveBeenCalledTimes(1);

    reminders.stop();
    clock.now = new Date(2027, 2, 15, 9);
    await vi.advanceTimersByTimeAsync(5000);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('makes the key of a reminder from the contact and the date', () => {
    expect(reminderKey({ contactId: 'c1', date: ann.dates[0] })).toBe('c1:b1');
  });

});
