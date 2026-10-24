/*
 Copyright (C) 2024-2026 3NSoft Inc.

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
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { contactsSrv, inboxSrv } from '@common/services/services-provider';
import { canonicalAddressOrUndefined } from '@shared/utils/address-utils';
import type { Person, PersonView } from '@common/types';

export const useContactsStore = defineStore('contacts', () => {
  const contactList = ref<Array<PersonView & { displayName: string }>>([]);
  /**
   * Who the user has blocked. The list belongs to the contacts app - this is a
   * copy of it, kept current by a watcher.
   */
  const blacklist = ref<PersonView[]>([]);
  let stopBlacklistWatch: (() => void) | undefined = undefined;

  const blockedAddresses = computed(() => {
    const addresses = new Set<string>();
    for (const person of blacklist.value) {
      const canonical = canonicalAddressOrUndefined(person?.mail);
      if (canonical) {
        addresses.add(canonical);
      }
    }
    return addresses;
  });

  function isBlacklisted(mail: string): boolean {
    const canonical = canonicalAddressOrUndefined(mail);
    return !!canonical && blockedAddresses.value.has(canonical);
  }

  function getContactName(mail: string): string {
    const canonical = canonicalAddressOrUndefined(mail);
    const contact = canonical
      ? contactList.value.find(c => canonicalAddressOrUndefined(c.mail) === canonical)
      : undefined;
    return contact?.name || contact?.mail || mail;
  }

  async function getContactList() {
    try {
      const data = await (await contactsSrv()).getContactList();
      contactList.value = (data || []).map(contact => ({
        ...contact,
        displayName: contact.name || contact.mail || '',
      }));
      return contactList.value;
    } catch (error) {
      console.error(error);
    }
  }

  async function fetchBlacklist(): Promise<PersonView[]> {
    try {
      blacklist.value = (await (await contactsSrv()).getContactBlacklist()) ?? [];
    } catch (error) {
      console.error(error);
    }
    return blacklist.value;
  }

  /**
   * Fills the blacklist from what the background component already knows.
   *
   * It answers at once - its tracker is warm from a cache before any RPC - while
   * the contacts app takes seconds of retries to reach. Until it does, mail from
   * a blocked sender would show no lock and a live Reply button.
   *
   * A head start, never a correction: it is not written over a list that has
   * already arrived.
   */
  async function primeBlacklistFromBackend(): Promise<void> {
    try {
      const addresses = await inboxSrv.getBlacklistedAddresses();
      if (addresses.length > 0 && blacklist.value.length === 0) {
        blacklist.value = addresses.map(mail => ({ id: mail, mail }));
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function startBlacklistWatch(): Promise<void> {
    if (stopBlacklistWatch) {
      return;
    }
    try {
      stopBlacklistWatch = (await contactsSrv()).watchContactBlacklistChanging({
        next: list => {
          blacklist.value = list ?? [];
        },
        error: error => {
          console.error(error);
          stopBlacklistWatch = undefined;
        },
      });
    } catch (error) {
      console.error(error);
    }
  }

  function stopWatching(): void {
    if (stopBlacklistWatch) {
      try {
        stopBlacklistWatch();
      } catch {
        // The connection may already be gone; nothing to undo either way.
      }
      stopBlacklistWatch = undefined;
    }
  }

  async function addContact(mail: string) {
    await getContactList();
    const isThereSuchContact = contactList.value.find(contact => contact.mail === mail);

    if (isThereSuchContact) {
      throw new Error(`There is the contact with mail ${mail}`);
    }

    const newContact: Person = {
      id: 'new',
      name: '',
      mail,
      notice: '',
      phone: '',
    };
    await (await contactsSrv()).upsertContact(newContact);
    await getContactList();
  }

  /**
   * Blocks or unblocks the owner of an address.
   *
   * The contacts app can only block a contact it has: changeContactBlockingSettings
   * throws for an address that is in no address book. Mail, however, arrives from
   * people who were never added, so blocking makes the contact first.
   *
   * addContact() is deliberately not reused for that: it fetches the whole list
   * to check for a duplicate, which is the right thing when a user is adding
   * somebody to write to, and beside the point here.
   */
  async function setContactBlocking(mail: string, value: boolean): Promise<void> {
    const srv = await contactsSrv();
    const contact = await srv.getContactByMail(mail);

    if (!contact) {
      if (!value) {
        // Nothing to unblock: no contact, hence no blocking flag.
        return;
      }

      // The contacts service RETURNS {errorType, errorMessage} instead of
      // throwing, so discarding the result would swallow the failure while the
      // interface shows the address as blocked.
      const result = await srv.upsertContact({ id: 'new', name: '', mail, notice: '', phone: '' });
      if (result && 'errorType' in result) {
        throw new Error(result.errorMessage || `Failed to add the contact ${mail}`);
      }
      await getContactList();
    }

    await srv.changeContactBlockingSettings({ mail, value });
    // The watcher announces this too, but the button that triggered it should
    // not be waiting on a round trip through another app to update.
    await fetchBlacklist();
  }

  return {
    contactList,
    blacklist,
    blockedAddresses,
    isBlacklisted,
    getContactName,
    getContactList,
    fetchBlacklist,
    primeBlacklistFromBackend,
    startBlacklistWatch,
    stopWatching,
    addContact,
    setContactBlocking,
  };
});
