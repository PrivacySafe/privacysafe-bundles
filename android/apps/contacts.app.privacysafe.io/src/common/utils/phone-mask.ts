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
// Mask of the phone field: an international number, laid out by the rules of
// its country once the country code is typed. Numbers differ in length and
// grouping from country to country (+1 (201) 555-0123 in the US, +375 (29)
// 123-45-67 in Belarus), so one fixed mask cannot serve them; this is a dynamic
// mask of IMask, which the input of the ui library takes as its `mask`.
//
// A country not in the list gets the general form of E.164: a plus and up to 15
// digits, with no grouping. That is also what is shown while the code is not
// complete yet.
import type { Ui3nInputProps } from '@v1nt1248/3nclient-lib';

export type PhoneMask = NonNullable<Ui3nInputProps['mask']>;

export interface PhoneCountryMask {
  /** Country calling code, digits only. */
  code: string;
  /** IMask pattern; `{...}` makes the code a part of the value. */
  mask: string;
}

/** Countries with a fixed length of numbers, for which a layout makes sense. */
export const PHONE_COUNTRY_MASKS: readonly PhoneCountryMask[] = [
  { code: '1', mask: '+{1} (000) 000-0000' },
  { code: '7', mask: '+{7} (000) 000-00-00' },
  { code: '33', mask: '+{33} 0 00 00 00 00' },
  { code: '34', mask: '+{34} 000 000 000' },
  { code: '44', mask: '+{44} 0000 000000' },
  { code: '48', mask: '+{48} 000 000 000' },
  { code: '370', mask: '+{370} 000 00000' },
  { code: '371', mask: '+{371} 00 000 000' },
  { code: '375', mask: '+{375} (00) 000-00-00' },
  { code: '380', mask: '+{380} (00) 000-00-00' },
  { code: '995', mask: '+{995} 000 00 00 00' },
];

/** Up to 15 digits, the longest a number can be by E.164. */
export const PHONE_FALLBACK_MASK = '+000000000000000';

/**
 * Index of the mask for the digits typed so far: of the country whose code
 * they start with, or of the fallback (the last one) when there is none.
 */
export function phoneMaskIndex(digits: string): number {
  let index = PHONE_COUNTRY_MASKS.length;
  let codeLength = 0;
  PHONE_COUNTRY_MASKS.forEach(({ code }, i) => {
    if (digits.startsWith(code) && code.length > codeLength) {
      index = i;
      codeLength = code.length;
    }
  });
  return index;
}

/**
 * The mask is applied only to a number in the international form, or to an
 * empty field. A number saved before the mask existed, like `8 029 123-45-67`,
 * is left as the user typed it: it cannot be turned into the international
 * form without guessing the country.
 */
export function isPhoneMaskApplicable(value: string | null | undefined): boolean {
  const text = (value ?? '').trim();
  return !text || text.startsWith('+');
}

interface DynamicMaskedLike {
  value: string;
  compiledMasks: unknown[];
}

/** One object for the life of the app: the input recreates its mask on a new one. */
export const PHONE_MASK = {
  mask: [
    ...PHONE_COUNTRY_MASKS.map(({ mask }) => ({ mask })),
    { mask: PHONE_FALLBACK_MASK },
  ],
  dispatch: (appended: string, dynamicMasked: DynamicMaskedLike) => {
    const digits = `${dynamicMasked.value}${appended}`.replace(/\D/g, '');
    return dynamicMasked.compiledMasks[phoneMaskIndex(digits)];
  },
} as unknown as PhoneMask;
