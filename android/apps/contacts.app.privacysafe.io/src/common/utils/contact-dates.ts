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
// Dates of a contact (birthdays). Pure code, shared by the window and the
// background service: the service stores the dates and fires the reminders,
// the window edits them, and both have to agree on what a valid date is.
import type { ContactDate, ContactDateType } from '../../types/contacts-service.ts';

export const CONTACT_DATE_TYPES: readonly ContactDateType[] = ['birthday'];

/**
 * The year a date without a year is shown with in a date input. A leap year, so
 * that 29 February is a valid day. Equal to `UI3N_NO_YEAR_REFERENCE` of the ui
 * library, repeated here so that the service does not pull in the library.
 */
export const NO_YEAR_REFERENCE = 2000;

const MIN_YEAR = 1;
const MAX_YEAR = 9999;

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Whether the day exists in that month (of that year, or of a leap year). */
export function isValidCalendarDay(month: number, day: number, year?: number): boolean {
  if (!isInt(month, 1, 12) || !isInt(day, 1, 31)) {
    return false;
  }

  const y = year ?? NO_YEAR_REFERENCE;
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(y);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Takes what was read from the db (a JSON string), sent by a window or found in
 * an import file, and keeps only well-formed dates. A broken entry is dropped
 * rather than failing the contact; ids are made unique.
 */
export function sanitizeContactDates(raw: unknown): ContactDate[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }

  const result: ContactDate[] = [];
  const ids = new Set<string>();

  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const { id, type, month, day, year, notify } = item as Record<string, unknown>;
    if (!CONTACT_DATE_TYPES.includes(type as ContactDateType)) {
      return;
    }

    const hasYear = year !== undefined && year !== null;
    if (hasYear && !isInt(year, MIN_YEAR, MAX_YEAR)) {
      return;
    }
    if (!isValidCalendarDay(month as number, day as number, hasYear ? (year as number) : undefined)) {
      return;
    }

    let dateId = typeof id === 'string' && id.trim() ? id.trim() : `${type}-${index}`;
    while (ids.has(dateId)) {
      dateId = `${dateId}-${index}`;
    }
    ids.add(dateId);

    const date: ContactDate = {
      id: dateId,
      type: type as ContactDateType,
      month: month as number,
      day: day as number,
    };
    if (hasYear) {
      date.year = year as number;
    }
    if (notify === true) {
      date.notify = true;
    }

    result.push(date);
  });

  return result;
}

/** The db value of the dates column: null rather than an empty list. */
export function serializeContactDates(raw: unknown): string | null {
  const dates = sanitizeContactDates(raw);
  return dates.length ? JSON.stringify(dates) : null;
}

export function areContactDatesEqual(a: unknown, b: unknown): boolean {
  return serializeContactDates(a) === serializeContactDates(b);
}

/**
 * Whether the date falls on the given day (in the device's time zone). A 29
 * February without a leap year to fall on is celebrated on the 28th.
 */
export function isContactDateDue(date: ContactDate, on: Date): boolean {
  const month = on.getMonth() + 1;
  const day = on.getDate();
  if (date.month === month && date.day === day) {
    return true;
  }

  return date.month === 2 && date.day === 29 && month === 2 && day === 28 && !isLeapYear(on.getFullYear());
}

/** How old one turns on that day, when the year is known and not ahead. */
export function ageOn(date: ContactDate, on: Date): number | undefined {
  if (date.year === undefined) {
    return undefined;
  }

  const age = on.getFullYear() - date.year;
  return age > 0 ? age : undefined;
}

/** `YYYY-MM-DD` of the day in the device's time zone. */
export function localDayKey(on: Date): string {
  const y = String(on.getFullYear()).padStart(4, '0');
  const m = String(on.getMonth() + 1).padStart(2, '0');
  const d = String(on.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The value for a date input: local midnight of the day, with
 * NO_YEAR_REFERENCE when the year is not known.
 */
export function contactDateToDate(date: ContactDate): Date {
  const value = new Date(NO_YEAR_REFERENCE, date.month - 1, date.day);
  value.setFullYear(date.year ?? NO_YEAR_REFERENCE);
  return value;
}

/**
 * Takes the value of a date input back into a contact date, keeping the id,
 * the type and the notify flag of `base`.
 */
export function dateToContactDate(
  value: Date,
  withoutYear: boolean,
  base: Pick<ContactDate, 'id' | 'type'> & Partial<ContactDate>,
): ContactDate {
  const date: ContactDate = {
    id: base.id,
    type: base.type,
    month: value.getMonth() + 1,
    day: value.getDate(),
  };
  if (!withoutYear) {
    date.year = value.getFullYear();
  }
  if (base.notify) {
    date.notify = true;
  }
  return date;
}

/** The birthday of a contact. A contact has one at most. */
export function getBirthday(dates: unknown): ContactDate | undefined {
  return sanitizeContactDates(dates).find(date => date.type === 'birthday');
}

/**
 * The dates with the birthday replaced (or removed, when `birthday` is
 * undefined). Other dates are kept as they are.
 */
export function withBirthday(dates: unknown, birthday: ContactDate | undefined): ContactDate[] {
  const others = sanitizeContactDates(dates).filter(date => date.type !== 'birthday');
  return birthday ? [birthday, ...others] : others;
}

/**
 * Text of a date in one of the formats of the app settings, e.g. `03.15.1990`,
 * or `03.15` when the year is not known.
 */
export function formatContactDate(date: ContactDate, format: string): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  const separator = format.includes('-') ? '-' : '.';
  const order = format.split(/[.-]/);

  return order
    .filter(token => date.year !== undefined || token !== 'YYYY')
    .map(token => (token === 'YYYY' ? String(date.year).padStart(4, '0') : token === 'MM' ? mm : dd))
    .join(separator);
}

/**
 * The dates with no reminders: what goes to another user. Whether to be
 * reminded of a date is the choice of the one who set it.
 */
export function withoutReminders(dates: unknown): ContactDate[] {
  return sanitizeContactDates(dates).map(date => {
    const copy = { ...date };
    delete copy.notify;
    return copy;
  });
}
