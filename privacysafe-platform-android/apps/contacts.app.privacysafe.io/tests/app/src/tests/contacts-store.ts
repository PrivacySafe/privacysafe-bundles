/*
 Copyright (C) 2025 3NSoft Inc.

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

import type { ContactsStore } from '@main/common/store/contacts.store.js';
import { itCond, skipSpecIfUnresponsive } from '../libs-for-tests/jasmine-utils.js';
import { appContactsSrvProxy } from '@main/common/services/services-provider.js';
import { TestSetupContainer } from '@tests/setups.js';
import { PersonView } from '@main/types/index.js';
import { NEW_EMPTY_CONTACT_ID } from '@main/common/constants/index.js';

function findInContactListFrom(
	contactsStore: ContactsStore, addr: string
): PersonView|undefined {
	return Object.values(contactsStore.contactList).find(
    ({ mail }) => (mail === addr)
  );
}

async function deleteAllContactsExceptOneFrom(
  contactsStore: ContactsStore, exceptId: string
): Promise<void> {
  console.log(`contact ids:`, Object.keys(contactsStore.contactList));
  for (const id of Object.keys(contactsStore.contactList)) {
    if (id !== exceptId) {
      await contactsStore.deleteContact(id);
    }
  }
}

// Server-touching operations get their own, shorter limit, so that an
// unresponsive server produces a named skip instead of jasmine cutting the
// spec off with "did not complete within Nms".
const ADD_CONTACT_TIMEOUT = 20000;
const SPEC_TIMEOUT = 30000;
const CLEANUP_TIMEOUT = 120000;

describe(`ContactsStore`, () => {

  let contactsStore: ContactsStore;
  let fstUserAddr: string;
  let sndUserAddr: string;
  let ownId: string;

  beforeAll(() => {
    ({
      contactsStore, fstUserAddr, sndUserAddr
    } = (window as any as TestSetupContainer).testSetup);

    const ownUser = Object.values(contactsStore.contactList).find(c => c.mail === fstUserAddr);
    ownId = ownUser?.id || '';
  });

  // Removing every contact saves the db once per removal, which outruns
  // jasmine's 5s default for a hook - and a timed out hook fails the SUITE.
  afterAll(async () => {
    await deleteAllContactsExceptOneFrom(contactsStore, ownId);
  }, CLEANUP_TIMEOUT)

  itCond(`own address is present by default`, async () => {
    console.log(`contactsStore is`, contactsStore);
    await contactsStore.fetchContacts({});
    const ownContact = Object.values(contactsStore.contactList).find(c => c.mail === fstUserAddr);
    expect(ownContact).toBeDefined();
  });

  itCond(`lists, adds and removes contacts`, async () => {
    const contactAddr = sndUserAddr;

    if (!findInContactListFrom(contactsStore, contactAddr)) {
      // Adding a contact goes to the server, so a hang here becomes a stated
      // skip rather than a timeout blamed on the next spec. The spec timeout
      // below must stay larger than this one.
      await skipSpecIfUnresponsive(
        `adding contact ${contactAddr}`,
        ADD_CONTACT_TIMEOUT,
        () => contactsStore.upsertContact({
          id: NEW_EMPTY_CONTACT_ID,
          mail: contactAddr
        })
      );
      expect(findInContactListFrom(contactsStore, contactAddr))
      .withContext(`address is present after addition`)
      .toBeDefined();
    }

    const contact = findInContactListFrom(contactsStore, contactAddr);
    if (!contact) {
      fail(`Contact should've been created and available in list`);
      return;
    }

    // A duplicate address is reported by the service as a RESOLVED value of
    // shape { errorType, errorMessage } - it does not reject. The previous
    // version of this spec expected a rejection carrying
    // `contactAlreadyExists`, so its success branch only checked that
    // something truthy came back and the duplicate was never actually
    // verified.
    const duplicateRes = await contactsStore.upsertContact({
      id: NEW_EMPTY_CONTACT_ID,
      mail: contactAddr
    });
    if (duplicateRes && ('errorType' in duplicateRes)) {
      expect(duplicateRes.errorType)
      .withContext(`error type for a duplicated address`)
      .toBe('exists');
    } else {
      fail(`Creating a contact with an existing address should be refused, got: ${
        JSON.stringify(duplicateRes)}`);
    }
    expect(Object.values(contactsStore.contactList)
      .filter(({ mail }) => (mail === contactAddr)).length)
    .withContext(`number of contacts with the same address`)
    .toBe(1);

    await contactsStore.deleteContact(contact.id);
    expect(findInContactListFrom(contactsStore, contactAddr))
    .withContext(`contact should be removed`)
    .toBeUndefined();
  }, SPEC_TIMEOUT);

  itCond(`keeps the list sorted by display name`, async () => {
    await contactsStore.fetchContacts({});

    const names = Object.values(contactsStore.contactList)
    .map(c => c.displayName.toLocaleLowerCase());
    const sorted = [...names].sort((a, b) => ((a === b) ? 0 : (a > b) ? 1 : -1));

    expect(names).withContext(`display names in list order`).toEqual(sorted);
  }, SPEC_TIMEOUT);

  itCond(`reports an address already on a contact as in use`, async () => {
    await contactsStore.fetchContacts({});
    const someContact = Object.values(contactsStore.contactList)[0];

    expect(contactsStore.isMailAddressInUse(someContact.mail))
    .withContext(`existing address`).toBeTrue();
    expect(contactsStore.isMailAddressInUse(`free-${Date.now()}@3nweb.com`))
    .withContext(`unused address`).toBeFalse();
  }, SPEC_TIMEOUT);

  itCond(`ignores the edited contact's own address when checking usage`, async () => {
    await contactsStore.fetchContacts({});
    const someContact = Object.values(contactsStore.contactList)[0];

    expect(contactsStore.isMailAddressInUse(someContact.mail, [someContact.mail]))
    .withContext(`own address while editing`).toBeFalse();
  }, SPEC_TIMEOUT);

  itCond(`stores and reads back every editable field through the store`, async () => {
    const mail = `store-spec-${Date.now()}@3nweb.com`;
    const created = await skipSpecIfUnresponsive(
      `adding contact ${mail}`, ADD_CONTACT_TIMEOUT,
      () => contactsStore.upsertContact({
        id: NEW_EMPTY_CONTACT_ID, mail, name: 'Store Spec', phone: '+1 555 0111',
        notice: 'from the store spec',
      })
    );
    if (!created || ('errorType' in created)) {
      fail(`Failed to add a contact: ${JSON.stringify(created)}`);
      return;
    }

    try {
      const read = await contactsStore.getContact(created.id);
      expect(read).withContext(`contact is readable`).toBeDefined();
      expect(read!.name).toBe('Store Spec');
      expect(read!.phone).toBe('+1 555 0111');
      expect(read!.notice).toBe('from the store spec');
    } finally {
      await contactsStore.deleteContact(created.id);
    }
  }, SPEC_TIMEOUT);

  itCond(`removes a batch of contacts`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await skipSpecIfUnresponsive(
        `adding contact ${i}`, ADD_CONTACT_TIMEOUT,
        () => contactsStore.upsertContact({
          id: NEW_EMPTY_CONTACT_ID,
          mail: `batch-spec-${Date.now()}-${i}@3nweb.com`,
        })
      );
      if (!res || ('errorType' in res)) {
        fail(`Failed to add contact ${i}: ${JSON.stringify(res)}`);
        return;
      }
      ids.push(res.id);
    }

    await contactsStore.deleteContacts(ids);

    await contactsStore.fetchContacts({});
    for (const id of ids) {
      expect(contactsStore.contactList[id])
      .withContext(`contact ${id} after batch removal`).toBeUndefined();
    }
  }, SPEC_TIMEOUT * 2);

  // The store's list is what the UI renders, and it is refreshed off the deno
  // service's events. A contact created straight through the service must show
  // up here once the list is re-read, or the UI would go stale after any change
  // that did not originate in this window.
  itCond(`picks up a contact created straight through the service`, async () => {
    const mail = `direct-spec-${Date.now()}@3nweb.com`;
    const created = await skipSpecIfUnresponsive(
      `adding contact ${mail}`, ADD_CONTACT_TIMEOUT,
      () => appContactsSrvProxy.upsertContact({ id: NEW_EMPTY_CONTACT_ID, mail })
    );
    if (!created || ('errorType' in created)) {
      fail(`Failed to add a contact: ${JSON.stringify(created)}`);
      return;
    }

    try {
      await contactsStore.fetchContacts({});
      expect(contactsStore.contactList[created.id])
      .withContext(`service-created contact in the store list`).toBeDefined();
    } finally {
      await contactsStore.deleteContact(created.id);
    }
  }, SPEC_TIMEOUT);

});
