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
// Covers only what gates the header actions of the contact form. The rest of
// useContact talks to the service and the router, and is exercised through the
// app rather than here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, type Plugin } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { DIALOGS_KEY, NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
import type { Person } from '@main/types';

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: {
    getContact: vi.fn(),
    getContactList: vi.fn(async () => []),
    checkAddressReachability: vi.fn(),
    changeContactBlockingSettings: vi.fn(),
  },
  initializeServices: vi.fn(),
}));

const { appContactsSrvProxy } = await import('@main/common/services/services-provider');
const { useContact } = await import('@main/common/composables/use-contact.ts');
const { withSetup } = await import('../../../helpers/app-context.ts');
const { installFakeW3n } = await import('../../../helpers/fake-w3n.ts');
const { NEW_EMPTY_CONTACT_ID } = await import('@main/common/constants');

const SAVED_CONTACT = { id: 'c1', mail: 'ann@3nweb.com', timestamp: 1 };
const NEW_CONTACT = { id: NEW_EMPTY_CONTACT_ID, mail: 'ann@3nweb.com', timestamp: 0 };

let dialogConfirmResult: { event: string } = { event: 'confirm' };

/** The plugins useContact needs in order to run outside a real app. */
function pluginsFor(router: Router): Plugin[] {
  const provide: Plugin = {
    install(app) {
      // Neither is reached by what is asserted below; they only have to be
      // present, because useContact injects both unconditionally.
      app.provide(NOTIFICATIONS_KEY, { $createNotice: vi.fn() });
      app.provide(DIALOGS_KEY, {
        $openDialog: vi.fn(async () => dialogConfirmResult),
      } as never);
    },
  };
  return [router, provide];
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/contact/:id', name: 'contact', component: { render: () => null } }],
  });
}

let w3n: ReturnType<typeof installFakeW3n>;

async function setup() {
  const router = makeRouter();
  await router.push('/contact/c1');
  await router.isReady();
  const { result } = withSetup(() => useContact(), { plugins: pluginsFor(router) });
  // useConnectivityStatus starts at 'offline' and only moves on an event.
  w3n.emitConnectivity({ isOnline: true });
  await nextTick();
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  w3n = installFakeW3n();
});

afterEach(() => {
  w3n.uninstall();
  vi.restoreAllMocks();
});

describe('useContact, gating of the header actions', () => {

  describe('a contact that is not saved yet', () => {

    // The form fills `mail` as the user types, which used to be enough to
    // enable handing the contact to the chat and the inbox apps - neither of
    // which has any record of it.
    it('cannot be handed to the other apps', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...NEW_CONTACT } as never;
      await nextTick();

      expect(contactUse.isContactNew.value).toBe(true);
      expect(contactUse.canReachOtherApps.value).toBe(false);
    });

    it('has no keys to show', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...NEW_CONTACT } as never;
      await nextTick();

      expect(contactUse.canShowContactKeys.value).toBe(false);
    });

    it('explains the block by the contact not being saved', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...NEW_CONTACT } as never;
      await nextTick();

      // Not the offline wording: sending someone to look for a network problem
      // they do not have is worse than saying nothing.
      expect(contactUse.disabledActionReason.value).toBe('Available after the contact is saved.');
    });

  });

  describe('a saved contact', () => {

    it('can be handed to the other apps while online', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...SAVED_CONTACT } as never;
      await nextTick();

      expect(contactUse.canReachOtherApps.value).toBe(true);
    });

    it('has keys to show', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...SAVED_CONTACT } as never;
      await nextTick();

      expect(contactUse.canShowContactKeys.value).toBe(true);
    });

    // Keys come out of the keyring, so unlike the two apps above they do not
    // need the network.
    it('keeps its keys available offline', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...SAVED_CONTACT } as never;
      w3n.emitConnectivity({ isOnline: false });
      await nextTick();

      expect(contactUse.canReachOtherApps.value).toBe(false);
      expect(contactUse.canShowContactKeys.value).toBe(true);
      expect(contactUse.disabledActionReason.value).toBe('Available when online.');
    });

  });

  describe('setUpContactBlocking', () => {

    it('blocks contact and immediately updates local settings and contactSettings', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...SAVED_CONTACT, settings: {} } as unknown as Person;
      contactUse.initialContact.value = { ...SAVED_CONTACT, settings: {} } as unknown as Person;
      await nextTick();

      expect(contactUse.contactSettings.value.blockUser).toBeFalsy();

      await contactUse.setUpContactBlocking({
        id: 'c1',
        contactName: 'Ann',
        value: true,
      });

      expect(appContactsSrvProxy.changeContactBlockingSettings).toHaveBeenCalledWith({
        id: 'c1',
        value: true,
      });
      expect(contactUse.contact.value!.settings?.blockUser).toBe(true);
      expect(contactUse.initialContact.value!.settings?.blockUser).toBe(true);
      expect(contactUse.contactSettings.value.blockUser).toBe(true);
      expect(contactUse.whetherContactChanged.value).toBe(false);
    });

    it('unblocks contact and immediately updates local settings and contactSettings', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...SAVED_CONTACT, settings: { blockUser: true } } as unknown as Person;
      contactUse.initialContact.value = { ...SAVED_CONTACT, settings: { blockUser: true } } as unknown as Person;
      await nextTick();

      expect(contactUse.contactSettings.value.blockUser).toBe(true);

      await contactUse.setUpContactBlocking({
        id: 'c1',
        contactName: 'Ann',
        value: false,
      });

      expect(appContactsSrvProxy.changeContactBlockingSettings).toHaveBeenCalledWith({
        id: 'c1',
        value: false,
      });
      expect(contactUse.contact.value!.settings?.blockUser).toBe(false);
      expect(contactUse.initialContact.value!.settings?.blockUser).toBe(false);
      expect(contactUse.contactSettings.value.blockUser).toBe(false);
      expect(contactUse.whetherContactChanged.value).toBe(false);
    });

    it('does nothing when confirmation dialog is cancelled', async () => {
      const contactUse = await setup();
      contactUse.contact.value = { ...SAVED_CONTACT, settings: {} } as unknown as Person;
      contactUse.initialContact.value = { ...SAVED_CONTACT, settings: {} } as unknown as Person;
      await nextTick();

      dialogConfirmResult = { event: 'cancel' };
      try {
        await contactUse.setUpContactBlocking({
          id: 'c1',
          contactName: 'Ann',
          value: true,
        });

        expect(appContactsSrvProxy.changeContactBlockingSettings).not.toHaveBeenCalled();
        expect(contactUse.contactSettings.value.blockUser).toBeFalsy();
      } finally {
        dialogConfirmResult = { event: 'confirm' };
      }
    });

  });

});
