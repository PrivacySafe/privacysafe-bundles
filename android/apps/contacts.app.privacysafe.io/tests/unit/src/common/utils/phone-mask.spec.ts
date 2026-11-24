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
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { cleanup, render } from '@testing-library/vue';
import { Ui3nInput } from '@v1nt1248/3nclient-lib';
import {
  isPhoneMaskApplicable,
  PHONE_COUNTRY_MASKS,
  PHONE_MASK,
  phoneMaskIndex,
} from '@main/common/utils/phone-mask';

const FALLBACK = PHONE_COUNTRY_MASKS.length;

function maskOf(digits: string): string {
  const index = phoneMaskIndex(digits);
  return index === FALLBACK ? 'fallback' : PHONE_COUNTRY_MASKS[index].code;
}

/** Types the text into a masked input, as a user would, and gives what it shows. */
async function typeInto(text: string): Promise<{ shown: string; emitted: string[] }> {
  const { container, emitted } = render(Ui3nInput, { props: { modelValue: '', mask: PHONE_MASK } });
  await nextTick();
  const input = container.querySelector('input') as HTMLInputElement;
  for (const char of text) {
    input.value += char;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  }
  const inputs = ((emitted().input ?? []) as unknown[][]).map(args => args[0] as string);
  return { shown: input.value, emitted: inputs };
}

afterEach(() => {
  cleanup();
});

describe('phone mask', () => {

  it('picks the country by its code', () => {
    expect(maskOf('12015550123')).toBe('1');
    expect(maskOf('79161234567')).toBe('7');
    expect(maskOf('375291234567')).toBe('375');
    expect(maskOf('380501234567')).toBe('380');
    expect(maskOf('447911123456')).toBe('44');
  });

  it('takes the longest code that matches', () => {
    expect(maskOf('370')).toBe('370');
    expect(maskOf('33')).toBe('33');
  });

  it('falls back to the general form for an unknown or incomplete code', () => {
    expect(maskOf('')).toBe('fallback');
    expect(maskOf('3')).toBe('fallback');
    expect(maskOf('37')).toBe('fallback');
    expect(maskOf('86')).toBe('fallback');
  });

  it('is applied only to an empty field or an international number', () => {
    expect(isPhoneMaskApplicable('')).toBe(true);
    expect(isPhoneMaskApplicable(undefined)).toBe(true);
    expect(isPhoneMaskApplicable(' +375 29')).toBe(true);
    expect(isPhoneMaskApplicable('8 029 123-45-67')).toBe(false);
  });

  it('lays out a number of the US, and emits it as shown', async () => {
    const { shown, emitted } = await typeInto('12015550123');
    expect(shown).toBe('+1 (201) 555-0123');
    expect(emitted.at(-1)).toBe('+1 (201) 555-0123');
  });

  it('lays out a number of Belarus', async () => {
    expect((await typeInto('375291234567')).shown).toBe('+375 (29) 123-45-67');
  });

  it('keeps an unknown country as a plus and digits', async () => {
    expect((await typeInto('861012345678')).shown).toBe('+861012345678');
  });

  it('stops at 15 digits for an unknown country', async () => {
    expect((await typeInto('8610123456789012')).shown).toBe('+861012345678901');
  });

});
