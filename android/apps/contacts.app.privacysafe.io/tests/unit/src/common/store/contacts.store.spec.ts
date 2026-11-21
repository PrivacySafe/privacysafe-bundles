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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: {
    getContactList: vi.fn(),
    getContact: vi.fn(),
    upsertContact: vi.fn(),
    deleteContact: vi.fn(),
    addImage: vi.fn(),
    getImage: vi.fn(),
    deleteImage: vi.fn(),
    removeUnnecessaryImageFiles: vi.fn(),
    initialSyncProcess: vi.fn(),
  },
  initializeServices: vi.fn(),
}));

const { appContactsSrvProxy } = await import('@main/common/services/services-provider');
const { useContactsStore } = await import('@main/common/store/contacts.store');
const { useAppStore } = await import('@main/common/store/app.store');
const { withSetup } = await import('../../../helpers/app-context.ts');

const srv = appContactsSrvProxy as unknown as Record<string, ReturnType<typeof vi.fn>>;

interface ServiceContact {
  id: string;
  mail: string;
  name?: string;
  avatarId?: string;
  avatarImage?: string;
  timestamp?: number;
  settings?: Record<string, unknown> | null;
}

function serviceContact(id: string, over: Partial<ServiceContact> = {}): ServiceContact {
  return { id, mail: `${id}@3nweb.com`, name: id.toUpperCase(), timestamp: 1, ...over };
}

/** Boots the store inside a component setup and points appStore.user at `user`. */
function bootStore(user = 'me@3nweb.com') {
  const { result, app } = withSetup(() => {
    const appStore = useAppStore();
    const store = useContactsStore();
    return { appStore, store };
  });
  // toRO() only freezes refs inside the test app, so `user` stays writable here.
  (result.appStore as unknown as { user: string }).user = user;
  return { ...result, app };
}

describe('useContactsStore', () => {

  beforeEach(() => {
    for (const fn of Object.values(srv)) {
      fn.mockReset();
    }
    srv.getContactList.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchContacts', () => {

    it('replaces the whole list with withFullOverload', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a'), serviceContact('b')]);
      await store.fetchContacts({ withFullOverload: true });

      srv.getContactList.mockResolvedValue([serviceContact('c')]);
      await store.fetchContacts({ withFullOverload: true });

      expect(store.contacts.map(c => c.id)).toEqual(['c']);
      app.unmount();
    });

    it('adds a newly appeared contact incrementally', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a')]);
      await store.fetchContacts({});

      srv.getContactList.mockResolvedValue([serviceContact('a'), serviceContact('b')]);
      await store.fetchContacts({});

      expect(store.contacts.map(c => c.id)).toEqual(['a', 'b']);
      app.unmount();
    });

    it('updates a changed field of an existing contact in place', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a', { name: 'Ann' })]);
      await store.fetchContacts({});

      srv.getContactList.mockResolvedValue([serviceContact('a', { name: 'Annabel' })]);
      await store.fetchContacts({});

      expect(store.contacts).toHaveLength(1);
      expect(store.contacts[0].name).toBe('Annabel');
      expect(store.contacts[0].displayName).toBe('Annabel');
      app.unmount();
    });

    it('updates displayName in place when an unnamed contact gets a new mail address', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a', { name: '', mail: 'old@3nweb.com' })]);
      await store.fetchContacts({});
      expect(store.contacts[0].displayName).toBe('old@3nweb.com');

      srv.getContactList.mockResolvedValue([serviceContact('a', { name: '', mail: 'new@3nweb.com' })]);
      await store.fetchContacts({});

      expect(store.contacts[0].mail).toBe('new@3nweb.com');
      expect(store.contacts[0].displayName).toBe('new@3nweb.com');
      app.unmount();
    });

    it('updates settings of an existing contact in place', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a', { settings: {} })]);
      await store.fetchContacts({});

      srv.getContactList.mockResolvedValue([serviceContact('a', { settings: { blockUser: true } })]);
      await store.fetchContacts({});

      expect(store.contacts[0].settings).toEqual({ blockUser: true });
      app.unmount();
    });

    it('drops a contact the service no longer returns', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue(['a', 'b', 'c'].map(id => serviceContact(id)));
      await store.fetchContacts({});

      srv.getContactList.mockResolvedValue([serviceContact('a'), serviceContact('c')]);
      await store.fetchContacts({});

      expect(store.contacts.map(c => c.id)).toEqual(['a', 'c']);
      app.unmount();
    });

    // Regression guard for the removal loop. It used to splice the loop counter
    // instead of the collected index; and even after that was fixed, `.sort()`
    // without a comparator ordered the indices lexicographically, so
    // [2, 10] spliced as [2, 10] — ascending — and removing index 2 shifted the
    // array so that splice(10) hit the wrong element. Both defects are
    // invisible on short lists, hence the 12 contacts here.
    it('drops the right contacts when indices cross the 10 boundary', async () => {
      const { store, app } = bootStore();
      const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
      srv.getContactList.mockResolvedValue(ids.map(id => serviceContact(id)));
      await store.fetchContacts({});
      expect(store.contacts.map(c => c.id)).toEqual(ids);

      const remaining = ids.filter(id => id !== 'c2' && id !== 'c10');
      srv.getContactList.mockResolvedValue(remaining.map(id => serviceContact(id)));
      await store.fetchContacts({});

      expect(store.contacts.map(c => c.id)).toEqual(remaining);
      app.unmount();
    });

    it('empties the list when the service returns nothing', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a')]);
      await store.fetchContacts({});

      srv.getContactList.mockResolvedValue([]);
      await store.fetchContacts({});

      expect(store.contacts).toEqual([]);
      app.unmount();
    });

    it('falls back to the mail address as display name when the name is blank', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a', { name: '' })]);

      await store.fetchContacts({});

      expect(store.contacts[0].displayName).toBe('a@3nweb.com');
      app.unmount();
    });

    it('renames the own contact to the localised "me" label', async () => {
      const { store, app } = bootStore('me@3nweb.com');
      srv.getContactList.mockResolvedValue([
        serviceContact('own', { mail: 'me@3nweb.com', name: 'Whatever' }),
        serviceContact('a'),
      ]);

      await store.fetchContacts({});

      const own = store.contacts.find(c => c.mail === 'me@3nweb.com')!;
      expect(own.name).toBe('Me');
      expect(own.displayName).toBe('Me');
      app.unmount();
    });

    it('passes the withImage flag on to the service', async () => {
      const { store, app } = bootStore();

      await store.fetchContacts({ withImage: true });

      expect(srv.getContactList).toHaveBeenCalledWith(true);
      app.unmount();
    });

  });

  describe('contactList', () => {

    it('is keyed by contact id', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a'), serviceContact('b')]);
      await store.fetchContacts({});

      expect(Object.keys(store.contactList).sort()).toEqual(['a', 'b']);
      app.unmount();
    });

    it('orders contacts by display name, ignoring case', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([
        serviceContact('c', { name: 'zoe' }),
        serviceContact('a', { name: 'Ann' }),
        serviceContact('b', { name: 'bob' }),
      ]);
      await store.fetchContacts({});

      expect(Object.values(store.contactList).map(c => c.name)).toEqual(['Ann', 'bob', 'zoe']);
      app.unmount();
    });

    // Array.prototype.sort mutates, so sorting `contacts` inside this computed
    // made merely READING it reorder the array both list views render from —
    // their order then depended on whether anything had read contactList first.
    // It sorts a copy now.
    it('leaves the backing contacts array untouched when read', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([
        serviceContact('c', { name: 'zoe' }),
        serviceContact('a', { name: 'Ann' }),
      ]);
      await store.fetchContacts({});
      const orderBefore = store.contacts.map(c => c.name);

      expect(Object.values(store.contactList).map(c => c.name)).toEqual(['Ann', 'zoe']);

      expect(store.contacts.map(c => c.name))
      .toEqual(orderBefore);
      app.unmount();
    });

    it('tolerates a contact with a blank display name', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([
        serviceContact('a', { name: '', mail: '' }),
        serviceContact('b', { name: 'Bob' }),
      ]);
      await store.fetchContacts({});

      expect(() => store.contactList).not.toThrow();
      expect(Object.keys(store.contactList).sort()).toEqual(['a', 'b']);
      app.unmount();
    });

  });

  describe('isMailAddressInUse', () => {

    beforeEach(() => {
      srv.getContactList.mockResolvedValue([
        serviceContact('a', { mail: 'ann@3nweb.com' }),
        serviceContact('b', { mail: 'bob@3nweb.com' }),
      ]);
    });

    it('reports a taken address', async () => {
      const { store, app } = bootStore();
      await store.fetchContacts({});

      expect(store.isMailAddressInUse('ann@3nweb.com')).toBe(true);
      app.unmount();
    });

    it('reports a free address', async () => {
      const { store, app } = bootStore();
      await store.fetchContacts({});

      expect(store.isMailAddressInUse('cid@3nweb.com')).toBe(false);
      app.unmount();
    });

    it('ignores the addresses it is told to ignore', async () => {
      const { store, app } = bootStore();
      await store.fetchContacts({});

      expect(store.isMailAddressInUse('ann@3nweb.com', ['ann@3nweb.com'])).toBe(false);
      app.unmount();
    });

    // Addresses are compared canonically, not as raw strings: 'Ann@3NWeb.com' is
    // the same account as 'ann@3nweb.com', and reading them as two is how one
    // person ends up as two contacts.
    it('recognises the same address in a different case', async () => {
      const { store, app } = bootStore();
      await store.fetchContacts({});

      expect(store.isMailAddressInUse('Ann@3NWeb.com')).toBe(true);
      app.unmount();
    });

    // The user part of a 3NWeb address ignores whitespace, which is why the
    // platform's own test accounts are named with spaces.
    it('ignores whitespace in the user part', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([
        serviceContact('a', { mail: 'ann tester@3nweb.com' }),
      ]);
      await store.fetchContacts({});

      expect(store.isMailAddressInUse('AnnTester@3NWeb.com')).toBe(true);
      app.unmount();
    });

    it('ignores an address given in a different case', async () => {
      const { store, app } = bootStore();
      await store.fetchContacts({});

      expect(store.isMailAddressInUse('ann@3nweb.com', ['Ann@3NWeb.com'])).toBe(false);
      app.unmount();
    });

    it('tolerates a contact with a blank address', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a', { mail: '' })]);
      await store.fetchContacts({});

      expect(() => store.isMailAddressInUse('ann@3nweb.com')).not.toThrow();
      expect(store.isMailAddressInUse('')).toBe(false);
      app.unmount();
    });

  });

  describe('upsertContactListItem', () => {

    it('merges into an existing entry', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a', { name: 'Ann' })]);
      await store.fetchContacts({});

      store.upsertContactListItem('a', { avatarId: 'av1' });

      expect(store.contacts).toHaveLength(1);
      expect(store.contacts[0].name).toBe('Ann');
      expect(store.contacts[0].avatarId).toBe('av1');
      app.unmount();
    });

    it('appends a new entry with blank defaults', async () => {
      const { store, app } = bootStore();

      store.upsertContactListItem('fresh', { mail: 'fresh@3nweb.com' });

      expect(store.contacts).toHaveLength(1);
      expect(store.contacts[0]).toMatchObject({
        id: 'fresh', mail: 'fresh@3nweb.com', name: '', displayName: '',
        avatarId: '', avatarImage: '', timestamp: 0,
      });
      app.unmount();
    });

  });

  describe('deleteContact', () => {

    it('removes the contact locally and asks the service to delete it', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('a'), serviceContact('b')]);
      await store.fetchContacts({});
      srv.deleteContact.mockResolvedValue(undefined);

      await store.deleteContact('a');

      expect(srv.deleteContact).toHaveBeenCalledWith('a', undefined);
      expect(store.contacts.map(c => c.id)).toEqual(['b']);
      app.unmount();
    });

    it('does nothing for a blank id', async () => {
      const { store, app } = bootStore();

      await store.deleteContact('');

      expect(srv.deleteContact).not.toHaveBeenCalled();
      app.unmount();
    });

  });

  describe('deleteContacts', () => {

    it('defers the parent upload to the last deletion only', async () => {
      const { store, app } = bootStore();
      srv.deleteContact.mockResolvedValue(undefined);

      await store.deleteContacts(['a', 'b', 'c']);

      expect(srv.deleteContact.mock.calls).toEqual([
        ['a', true], ['b', true], ['c', false],
      ]);
      app.unmount();
    });

    it('does nothing for an empty list', async () => {
      const { store, app } = bootStore();

      await store.deleteContacts([]);

      expect(srv.deleteContact).not.toHaveBeenCalled();
      app.unmount();
    });

  });

  describe('upsertContact', () => {

    it('appends a new contact to the list in place without refetching', async () => {
      const { store, app } = bootStore();
      const saved = { id: 'a1b2c3d4', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 };
      srv.upsertContact.mockResolvedValue(saved);

      const result = await store.upsertContact({ id: 'new', mail: 'ann@3nweb.com', name: 'Ann' } as never);

      expect(result).toBe(saved);
      expect(srv.getContactList).not.toHaveBeenCalled();
      expect(store.contacts).toHaveLength(1);
      expect(store.contacts[0]).toMatchObject({
        id: 'a1b2c3d4',
        mail: 'ann@3nweb.com',
        name: 'Ann',
        displayName: 'Ann',
        timestamp: 5,
      });
      app.unmount();
    });

    it('updates an existing contact in place and preserves avatarImage when avatarId is unchanged', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([
        serviceContact('a', { name: 'Ann', avatarId: 'av1', avatarImage: 'data:image/png;base64,existing' }),
      ]);
      await store.fetchContacts({ withImage: true });

      const updated = { id: 'a', mail: 'ann@3nweb.com', name: 'Annabel', avatarId: 'av1', timestamp: 10 };
      srv.upsertContact.mockResolvedValue(updated);

      const result = await store.upsertContact({ id: 'a', mail: 'ann@3nweb.com', name: 'Annabel', avatarId: 'av1' } as never);

      expect(result).toBe(updated);
      expect(srv.getContactList).toHaveBeenCalledTimes(1);
      expect(store.contacts).toHaveLength(1);
      expect(store.contacts[0]).toMatchObject({
        id: 'a',
        name: 'Annabel',
        displayName: 'Annabel',
        avatarId: 'av1',
        avatarImage: 'data:image/png;base64,existing',
        timestamp: 10,
      });
      app.unmount();
    });

    // The service reports a duplicate as a RESOLVED value of this shape rather
    // than by rejecting, and the store forwards it untouched. Callers must
    // check for `errorType` — the tests/app spec that expects a rejection with
    // `contactAlreadyExists` is testing a different contract.
    it('forwards a service-reported error object without modifying the list', async () => {
      const { store, app } = bootStore();
      srv.getContactList.mockResolvedValue([serviceContact('existing')]);
      await store.fetchContacts({});

      const failure = { errorType: 'exists', errorMessage: 'There is already the contact' };
      srv.upsertContact.mockResolvedValue(failure);

      const result = await store.upsertContact({ id: 'new', mail: 'existing@3nweb.com' } as never);

      expect(result).toBe(failure);
      expect(store.contacts.map(c => c.id)).toEqual(['existing']);
      app.unmount();
    });

  });

  describe('getContact', () => {

    it('delegates straight to the service', async () => {
      const { store, app } = bootStore();
      const contact = { id: 'a', mail: 'ann@3nweb.com' };
      srv.getContact.mockResolvedValue(contact);

      expect(await store.getContact('a')).toBe(contact);
      expect(srv.getContact).toHaveBeenCalledWith('a');
      app.unmount();
    });

  });

});
