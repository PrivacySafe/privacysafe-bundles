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
// Reminders of the dates of contacts (birthdays) as system notifications.
//
// Not a timer set for 08:00: the service lives for days, the device sleeps and
// wakes, and its clock may be changed in between, so a long timeout cannot be
// trusted to fire on the right day or at all. Instead the due dates are checked
// every minute, which also covers the case of a device that was off at 08:00:
// the reminder is shown as soon as the service runs later the same day. The
// next day it is not shown any more - a birthday reminder a day late is noise.
//
// What was shown today is kept in the app's LOCAL fs, so that a restart of the
// service does not show it again. It is per device on purpose: each device the
// user has reminds on its own, as the notifications of the chat app do.
import { ageOn, isContactDateDue, localDayKey } from '../../src/common/utils/contact-dates.ts';
import type { ContactDate } from '../../src/types/index.ts';
import type { ContactWithDates } from '../dataset/contacts-db.ts';

/** Local hour of the day from which the reminders of the day are shown. */
export const REMINDER_HOUR = 8;

export const REMINDER_CHECK_INTERVAL_MS = 60 * 1000;

/** Stored in the app's local fs. */
export interface ReminderState {
  /** `YYYY-MM-DD` of the day the list is for. */
  day: string;
  /** Keys of the reminders shown that day, see reminderKey. */
  shown: string[];
}

export interface DateReminder {
  contactId: string;
  /** The contact's name, or its mail when it has none. */
  displayName: string;
  date: ContactDate;
  /** How old the contact turns, when the year of birth is known. */
  age?: number;
}

export interface DateRemindersDeps {
  listContacts: () => ContactWithDates[];
  readState: () => Promise<ReminderState | undefined>;
  writeState: (state: ReminderState) => Promise<void>;
  /** Shows the notification. A rejection leaves the reminder to the next check. */
  notify: (reminder: DateReminder) => Promise<void>;
  now?: () => Date;
  onError?: (message: string, err: unknown) => void;
}

export function reminderKey(reminder: Pick<DateReminder, 'contactId' | 'date'>): string {
  return `${reminder.contactId}:${reminder.date.id}`;
}

/** The dates with a reminder that fall on the day of `now`. */
export function findDueReminders(contacts: ContactWithDates[], now: Date): DateReminder[] {
  const result: DateReminder[] = [];
  for (const contact of contacts) {
    for (const date of contact.dates) {
      if (!date.notify || !isContactDateDue(date, now)) {
        continue;
      }

      result.push({
        contactId: contact.id,
        displayName: contact.name?.trim() || contact.mail,
        date,
        age: ageOn(date, now),
      });
    }
  }
  return result;
}

export function makeDateReminders(deps: DateRemindersDeps) {
  const now = deps.now ?? (() => new Date());
  let state: ReminderState | undefined;
  let checking: Promise<number> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function loadState(day: string): Promise<ReminderState> {
    if (!state) {
      try {
        const stored = await deps.readState();
        state = (stored && typeof stored.day === 'string' && Array.isArray(stored.shown))
          ? { day: stored.day, shown: stored.shown.filter(key => typeof key === 'string') }
          : { day, shown: [] };
      } catch (err) {
        deps.onError?.('Could not read what reminders were shown', err);
        state = { day, shown: [] };
      }
    }

    // Marks of another day are of no use: they are dropped, not accumulated.
    if (state.day !== day) {
      state = { day, shown: [] };
    }
    return state;
  }

  async function runCheck(): Promise<number> {
    const moment = now();
    if (moment.getHours() < REMINDER_HOUR) {
      return 0;
    }

    const day = localDayKey(moment);
    const current = await loadState(day);
    const shown = new Set(current.shown);
    const due = findDueReminders(deps.listContacts(), moment)
      .filter(reminder => !shown.has(reminderKey(reminder)));

    let count = 0;
    for (const reminder of due) {
      try {
        await deps.notify(reminder);
        shown.add(reminderKey(reminder));
        count += 1;
      } catch (err) {
        deps.onError?.(`Could not show the reminder for contact ${reminder.contactId}`, err);
      }
    }

    if (count > 0) {
      state = { day, shown: [...shown] };
      try {
        await deps.writeState(state);
      } catch (err) {
        deps.onError?.('Could not save what reminders were shown', err);
      }
    }
    return count;
  }

  /**
   * Shows the reminders that are due and not shown yet. Resolves with how many
   * were shown. Checks do not overlap: a call during a check joins it.
   */
  function check(): Promise<number> {
    checking ??= runCheck()
      .catch(err => {
        deps.onError?.('Reminders check failed', err);
        return 0;
      })
      .finally(() => {
        checking = undefined;
      });
    return checking;
  }

  function start(intervalMs = REMINDER_CHECK_INTERVAL_MS): void {
    if (timer) {
      return;
    }
    void check();
    timer = setInterval(() => void check(), intervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return { check, start, stop };
}
