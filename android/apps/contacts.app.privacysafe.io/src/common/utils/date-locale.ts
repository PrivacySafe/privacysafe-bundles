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
// Month and weekday names for the date picker of the ui library, which has only
// English ones of its own. Taken from Intl, so that no translation has to be
// kept for them.
import type { Ui3nDateTimeLocaleConfig } from '@v1nt1248/3nclient-lib';

const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

/** In the order of Date.getDay(): Sunday first. */
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export function makeDateLocaleConfig(lang: string, withoutYearLabel: string): Ui3nDateTimeLocaleConfig {
  let monthFormat: Intl.DateTimeFormat;
  let dayFormat: Intl.DateTimeFormat;
  try {
    monthFormat = new Intl.DateTimeFormat(lang, { month: 'long' });
    dayFormat = new Intl.DateTimeFormat(lang, { weekday: 'short' });
  } catch {
    return { withoutYear: withoutYearLabel };
  }

  const months = {} as NonNullable<Ui3nDateTimeLocaleConfig['months']>;
  MONTH_KEYS.forEach((key, index) => {
    months[key] = monthFormat.format(new Date(2000, index, 1));
  });

  // 2 January 2000 is a Sunday.
  const days = {} as NonNullable<Ui3nDateTimeLocaleConfig['days']>;
  DAY_KEYS.forEach((key, index) => {
    days[key] = dayFormat.format(new Date(2000, 0, 2 + index)).replace(/\.$/, '').slice(0, 2);
  });

  return { months, days, withoutYear: withoutYearLabel };
}
