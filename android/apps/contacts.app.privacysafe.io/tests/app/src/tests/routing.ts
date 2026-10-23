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
// Navigation of the real desktop app instance built by the test setup: the
// router here is the one from setupMainApp, with the actual page components
// mounted behind it.
import { itCond, skipSpecIfUnresponsive } from '../libs-for-tests/jasmine-utils.js';
import { appContactsSrvProxy } from '@main/common/services/services-provider.js';
import { NEW_EMPTY_CONTACT_ID } from '@main/common/constants/index.js';
import { TestSetupContainer } from '@tests/setups.js';
import type { Router } from 'vue-router';
import type { Person } from '@main/types/index.js';

const OP_TIMEOUT = 20000;
const SPEC_TIMEOUT = 40000;
const CLEANUP_TIMEOUT = 120000;

function isPerson(res: Person | { errorType: string }): res is Person {
  return !('errorType' in res);
}

describe(`Desktop routing`, () => {

  let router: Router;
  const contactIdsToClean = new Set<string>();

  beforeAll(() => {
    ({ router } = (window as any as TestSetupContainer).testSetup);
  });

  afterEach(async () => {
    await router.push({ name: 'contacts' });
  });

  afterAll(async () => {
    for (const id of contactIdsToClean) {
      await appContactsSrvProxy.deleteContact(id).catch(() => undefined);
    }
    await router.push({ name: 'contacts' });
  }, CLEANUP_TIMEOUT);

  async function addContact(): Promise<Person> {
    const mail = `route-spec-${Date.now()}-${Math.floor(Math.random() * 1e6)}@3nweb.com`;
    const res = await skipSpecIfUnresponsive(
      `adding contact ${mail}`, OP_TIMEOUT,
      () => appContactsSrvProxy.upsertContact({ id: NEW_EMPTY_CONTACT_ID, mail }),
    );
    if (!isPerson(res)) {
      throw new Error(`Failed to add a contact: ${res.errorMessage}`);
    }
    contactIdsToClean.add(res.id);
    return res;
  }

  itCond(`starts on the contact list`, async () => {
    await router.push({ name: 'contacts' });

    expect(router.currentRoute.value.name).withContext(`route name`).toBe('contacts');
  }, SPEC_TIMEOUT);

  itCond(`opens a contact and returns to the list`, async () => {
    const contact = await addContact();

    await router.push({ name: 'contact', params: { id: contact.id } });
    expect(router.currentRoute.value.name).withContext(`on the contact`).toBe('contact');
    expect(router.currentRoute.value.params.id).toBe(contact.id);

    await router.push({ name: 'contacts' });
    expect(router.currentRoute.value.name).withContext(`back on the list`).toBe('contacts');
  }, SPEC_TIMEOUT);

  // The contact route is a CHILD of the contacts route on desktop, so an open
  // contact is rendered inside the list rather than instead of it. Pinned
  // because the mobile router has them as siblings, and the difference is easy
  // to erase by accident.
  itCond(`renders an open contact inside the list route`, async () => {
    const contact = await addContact();

    await router.push({ name: 'contact', params: { id: contact.id } });

    expect(router.currentRoute.value.matched.map(r => r.name))
    .withContext(`matched route chain`).toEqual(['contacts', 'contact']);
  }, SPEC_TIMEOUT);

  itCond(`opens the form for a new contact`, async () => {
    await router.push({ name: 'contact', params: { id: NEW_EMPTY_CONTACT_ID } });

    expect(router.currentRoute.value.name).toBe('contact');
    expect(router.currentRoute.value.params.id).toBe(NEW_EMPTY_CONTACT_ID);
  }, SPEC_TIMEOUT);

  itCond(`redirects the bare and the html paths to the list`, async () => {
    await router.push('/');
    expect(router.currentRoute.value.name).withContext(`from /`).toBe('contacts');

    await router.push('/index.html');
    expect(router.currentRoute.value.name).withContext(`from /index.html`).toBe('contacts');
  }, SPEC_TIMEOUT);

  // A contact that no longer exists still matches the route — nothing in the
  // router rejects an unknown id. What moves the user off the dead card is the
  // update:contact-list event handler, which is unit-tested separately. This
  // spec records the router half of that contract.
  itCond(`still routes to a contact id that is not in the list`, async () => {
    await router.push({ name: 'contact', params: { id: 'no-such-contact-id' } });

    expect(router.currentRoute.value.name).toBe('contact');
    expect(router.currentRoute.value.params.id).toBe('no-such-contact-id');
  }, SPEC_TIMEOUT);

});
