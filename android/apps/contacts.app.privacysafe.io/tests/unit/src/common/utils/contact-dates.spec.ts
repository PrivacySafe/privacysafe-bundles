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
import { UI3N_NO_YEAR_REFERENCE } from '@v1nt1248/3nclient-lib';
import {
  ageOn,
  areContactDatesEqual,
  contactDateToDate,
  dateToContactDate,
  formatContactDate,
  getBirthday,
  isContactDateDue,
  isValidCalendarDay,
  localDayKey,
  NO_YEAR_REFERENCE,
  sanitizeContactDates,
  serializeContactDates,
  withBirthday,
  withoutReminders,
} from '@main/common/utils/contact-dates';
import type { ContactDate } from '@main/types';

const birthday: ContactDate = { id: 'b1', type: 'birthday', month: 3, day: 15, year: 1990, notify: true };

describe('contact dates', () => {

  it('uses the same no-year reference as the ui library', () => {
    expect(NO_YEAR_REFERENCE).toBe(UI3N_NO_YEAR_REFERENCE);
  });

  describe('isValidCalendarDay', () => {
    it('accepts 29 February without a year and in a leap year only', () => {
      expect(isValidCalendarDay(2, 29)).toBe(true);
      expect(isValidCalendarDay(2, 29, 2024)).toBe(true);
      expect(isValidCalendarDay(2, 29, 2023)).toBe(false);
    });

    it('rejects days that do not exist', () => {
      expect(isValidCalendarDay(4, 31)).toBe(false);
      expect(isValidCalendarDay(13, 1)).toBe(false);
      expect(isValidCalendarDay(1, 0)).toBe(false);
      expect(isValidCalendarDay(1.5, 1)).toBe(false);
    });

    it('handles years below 100 as such', () => {
      expect(isValidCalendarDay(2, 29, 4)).toBe(true);
      expect(isValidCalendarDay(2, 29, 5)).toBe(false);
    });
  });

  describe('sanitizeContactDates', () => {
    it('takes a JSON string or an array', () => {
      expect(sanitizeContactDates(JSON.stringify([birthday]))).toEqual([birthday]);
      expect(sanitizeContactDates([birthday])).toEqual([birthday]);
    });

    it('gives an empty list for anything else', () => {
      expect(sanitizeContactDates(null)).toEqual([]);
      expect(sanitizeContactDates(undefined)).toEqual([]);
      expect(sanitizeContactDates('not json')).toEqual([]);
      expect(sanitizeContactDates({})).toEqual([]);
    });

    it('drops malformed entries and keeps the good ones', () => {
      expect(sanitizeContactDates([
        null,
        { type: 'wedding', month: 1, day: 1 },
        { type: 'birthday', month: 2, day: 30 },
        { type: 'birthday', month: 2, day: 29, year: 2023 },
        { type: 'birthday', month: 1, day: 1, year: '1990' },
        birthday,
      ])).toEqual([birthday]);
    });

    it('keeps only a true notify, drops unknown fields, and fills missing ids', () => {
      expect(sanitizeContactDates([{ type: 'birthday', month: 5, day: 1, notify: 'yes', extra: 1 }]))
        .toEqual([{ id: 'birthday-0', type: 'birthday', month: 5, day: 1 }]);
    });

    it('makes ids unique', () => {
      const ids = sanitizeContactDates([birthday, { ...birthday }]).map(date => date.id);
      expect(new Set(ids).size).toBe(2);
    });
  });

  it('serializes an empty list as null', () => {
    expect(serializeContactDates([])).toBeNull();
    expect(serializeContactDates(null)).toBeNull();
    expect(serializeContactDates([birthday])).toBe(JSON.stringify([birthday]));
  });

  it('compares dates by content', () => {
    expect(areContactDatesEqual([birthday], JSON.stringify([birthday]))).toBe(true);
    expect(areContactDatesEqual([], null)).toBe(true);
    expect(areContactDatesEqual([birthday], [{ ...birthday, notify: undefined }])).toBe(false);
  });

  describe('isContactDateDue', () => {
    it('matches the month and the day, whatever the year', () => {
      expect(isContactDateDue(birthday, new Date(2026, 2, 15, 9))).toBe(true);
      expect(isContactDateDue(birthday, new Date(2026, 2, 16, 9))).toBe(false);
    });

    it('celebrates 29 February on the 28th in a common year', () => {
      const leapDay: ContactDate = { id: 'b', type: 'birthday', month: 2, day: 29 };
      expect(isContactDateDue(leapDay, new Date(2026, 1, 28))).toBe(true);
      expect(isContactDateDue(leapDay, new Date(2028, 1, 28))).toBe(false);
      expect(isContactDateDue(leapDay, new Date(2028, 1, 29))).toBe(true);
    });
  });

  it('tells the age only when the year is known and passed', () => {
    expect(ageOn(birthday, new Date(2026, 2, 15))).toBe(36);
    expect(ageOn({ ...birthday, year: undefined }, new Date(2026, 2, 15))).toBeUndefined();
    expect(ageOn({ ...birthday, year: 2026 }, new Date(2026, 2, 15))).toBeUndefined();
  });

  it('makes a local day key', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  describe('conversion to and from the date input', () => {
    it('gives local midnight of the day', () => {
      const value = contactDateToDate(birthday);
      expect([value.getFullYear(), value.getMonth(), value.getDate(), value.getHours()]).toEqual([1990, 2, 15, 0]);
    });

    it('uses the reference year without a year', () => {
      expect(contactDateToDate({ id: 'b', type: 'birthday', month: 2, day: 29 }).getFullYear()).toBe(NO_YEAR_REFERENCE);
    });

    it('keeps id, type and notify, and drops the year when asked', () => {
      const value = new Date(2000, 6, 4);
      expect(dateToContactDate(value, true, birthday)).toEqual({ id: 'b1', type: 'birthday', month: 7, day: 4, notify: true });
      expect(dateToContactDate(value, false, { id: 'n', type: 'birthday' }))
        .toEqual({ id: 'n', type: 'birthday', month: 7, day: 4, year: 2000 });
    });
  });

  describe('birthday helpers', () => {
    it('finds the birthday', () => {
      expect(getBirthday([birthday])).toEqual(birthday);
      expect(getBirthday([])).toBeUndefined();
    });

    it('replaces and removes the birthday', () => {
      const next = { ...birthday, id: 'b2', day: 16 };
      expect(withBirthday([birthday], next)).toEqual([next]);
      expect(withBirthday([birthday], undefined)).toEqual([]);
    });

    it('drops the reminders', () => {
      const [date] = withoutReminders([birthday]);
      expect(date).toEqual({ id: 'b1', type: 'birthday', month: 3, day: 15, year: 1990 });
      expect('notify' in date).toBe(false);
    });
  });

  describe('formatContactDate', () => {
    it('follows each format of the settings', () => {
      expect(formatContactDate(birthday, 'MM.DD.YYYY')).toBe('03.15.1990');
      expect(formatContactDate(birthday, 'DD.MM.YYYY')).toBe('15.03.1990');
      expect(formatContactDate(birthday, 'YYYY-MM-DD')).toBe('1990-03-15');
    });

    it('leaves the year out when it is not known', () => {
      const noYear = { ...birthday, year: undefined };
      expect(formatContactDate(noYear, 'MM.DD.YYYY')).toBe('03.15');
      expect(formatContactDate(noYear, 'DD.MM.YYYY')).toBe('15.03');
      expect(formatContactDate(noYear, 'YYYY-MM-DD')).toBe('03-15');
    });

    it('agrees with the date input of the ui library', async () => {
      const { formatDate } = await import('@v1nt1248/3nclient-lib');
      for (const format of ['MM.DD.YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD'] as const) {
        expect(formatContactDate(birthday, format)).toBe(formatDate(contactDateToDate(birthday), format, false));
        expect(formatContactDate({ ...birthday, year: undefined }, format))
          .toBe(formatDate(contactDateToDate(birthday), format, true));
      }
    });
  });

});
