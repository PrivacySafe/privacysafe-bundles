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
// The birthday and phone fields of the contact form, with the real inputs of
// the ui library.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { cleanup, render } from '@testing-library/vue';

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: {},
  initializeServices: vi.fn(),
}));

const ContactContent = (await import('@main/common/components/contact-content.vue')).default;
const { useSettingsStore } = await import('@main/common/store/settings.store');
const { stubResizeObserver } = await import('../../../helpers/app-context.ts');
const i18n = (await import('@main/common/data/i18')).default;

import type { ContactDate, Person } from '@main/types';

const birthday: ContactDate = { id: 'b1', type: 'birthday', month: 3, day: 15, year: 1990 };

let pinia: Pinia;

function contact(over: Partial<Person> = {}): Person {
  return { id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', phone: '', notice: '', dates: [], timestamp: 1, ...over };
}

function setup(person: Person) {
  const result = render(ContactContent, {
    props: { contact: person, valid: true },
    global: { plugins: [pinia, i18n] },
  });
  const field = result.container.querySelector('[data-field="birthday"]') as HTMLElement;
  const dateInput = field.querySelector('input') as HTMLInputElement;
  const lastDates = () => {
    const events = (result.emitted()['update:dates'] ?? []) as ContactDate[][][];
    return events.at(-1)?.[0];
  };
  return { ...result, field, dateInput, lastDates };
}

/** The clickable part of the reminder checkbox. */
function reminderCheckbox(field: HTMLElement): HTMLElement {
  return field.querySelector('[data-ui3n="checkbox"] > div[tabindex]') as HTMLElement;
}

async function typeInto(input: HTMLInputElement, text: string) {
  for (const char of text) {
    input.value += char;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
}

beforeEach(() => {
  stubResizeObserver();
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  cleanup();
});

describe('contact form: birthday', () => {

  it('shows the birthday in the format of the settings', async () => {
    useSettingsStore().applySettings({ dateFormat: 'DD.MM.YYYY' });
    const { dateInput } = setup(contact({ dates: [birthday] }));
    await nextTick();

    expect(dateInput.value).toBe('15.03.1990');
  });

  it('shows a birthday without a year by day and month only', async () => {
    const { dateInput } = setup(contact({ dates: [{ ...birthday, year: undefined }] }));
    await nextTick();

    expect(dateInput.value).toBe('03.15');
  });

  it('turns a typed date into the birthday of the contact', async () => {
    const { dateInput, lastDates } = setup(contact());

    await typeInto(dateInput, '07041985');

    expect(lastDates()).toEqual([
      { id: expect.any(String), type: 'birthday', month: 7, day: 4, year: 1985 },
    ]);
  });

  it('keeps the other fields of the birthday when it is retyped', async () => {
    const { dateInput, lastDates } = setup(contact({ dates: [{ ...birthday, notify: true }] }));
    await nextTick();

    dateInput.value = '';
    await typeInto(dateInput, '03.16.1990');

    expect(lastDates()).toEqual([{ ...birthday, day: 16, notify: true }]);
  });

  it('switches the reminder of the birthday', async () => {
    const { field, lastDates, rerender } = setup(contact({ dates: [birthday] }));

    reminderCheckbox(field).click();
    await nextTick();
    expect(lastDates()).toEqual([{ ...birthday, notify: true }]);

    await rerender({ contact: contact({ dates: [{ ...birthday, notify: true }] }), valid: true });
    reminderCheckbox(field).click();
    await nextTick();
    expect(lastDates()).toEqual([birthday]);
  });

  it('drops the year and puts it back with the switch of the picker', async () => {
    const { field, lastDates, rerender } = setup(contact({ dates: [{ ...birthday, notify: true }] }));
    const openPicker = async () => {
      (field.querySelector('[data-ui3n="icon"]') as HTMLElement).click();
      await nextTick();
    };
    const withoutYearSwitch = () => field.querySelector(
      '[data-ui3n="datepicker-without-year"] [data-ui3n="checkbox"] > div[tabindex]',
    ) as HTMLElement;

    await openPicker();
    withoutYearSwitch().click();
    await nextTick();
    expect(lastDates()).toEqual([{ id: 'b1', type: 'birthday', month: 3, day: 15, notify: true }]);

    await rerender({ contact: contact({ dates: lastDates() }), valid: true });
    withoutYearSwitch().click();
    await nextTick();
    const [restored] = lastDates()!;
    expect(restored).toMatchObject({ id: 'b1', month: 3, day: 15, notify: true });
    expect(typeof restored.year).toBe('number');
  });

  it('offers no reminder while there is no birthday', async () => {
    const { field, emitted } = setup(contact());

    reminderCheckbox(field).click();
    await nextTick();

    expect(emitted()['update:dates']).toBeUndefined();
  });

});

describe('contact form: phone', () => {

  function phoneInput(container: Element): HTMLInputElement {
    return container.querySelectorAll('input')[2] as HTMLInputElement;
  }

  it('lays out an international number', async () => {
    const { container } = setup(contact({ phone: '+375291234567' }));
    await nextTick();

    expect(phoneInput(container).value).toBe('+375 (29) 123-45-67');
  });

  it('leaves a number of the old form as it is', async () => {
    const { container, emitted } = setup(contact({ phone: '8 029 123-45-67' }));
    await nextTick();

    expect(phoneInput(container).value).toBe('8 029 123-45-67');
    expect(emitted()['update:field']).toBeUndefined();
  });

});
