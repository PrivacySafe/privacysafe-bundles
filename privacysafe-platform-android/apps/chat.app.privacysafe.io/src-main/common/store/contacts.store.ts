/*
Copyright (C) 2024 - 2025 3NSoft Inc.

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
import { chatService, contactsSrv } from '@main/common/services/external-services';
import { areAddressesEqual, toCanonicalAddress } from '@shared/address-utils';
import { ensureASMailAddressExists, makeContactsException } from '../utils/contact-checks';
import type { Person, PersonView } from '~/contact.types';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ContactsStore');

export const useContactsStore = defineStore('contacts', () => {
  const contactList = ref<(PersonView & { displayName: string })[]>([]);
  const blacklist = ref<PersonView[]>([]);
  let stopBlacklistWatch: (() => void) | undefined = undefined;

  const mailsBlacklist = computed<string[]>(() =>
    blacklist.value.map(contact => toCanonicalAddress(contact.mail).toLowerCase()),
  );

  async function fetchContacts() {
    try {
      contactList.value = (await (await contactsSrv()).getContactList())
        .map(contact => ({
          ...contact,
          displayName: contact.name || contact.mail || ' ',
        }))
        .sort((a, b) => (a.displayName > b.displayName ? 1 : -1));
    } catch (e) {
      log.error('Error contacts fetching. ', e);
    }
    return contactList.value;
  }

  async function fetchBlacklist(): Promise<PersonView[]> {
    try {
      const srv = await contactsSrv();
      blacklist.value = (await srv.getContactBlacklist()) ?? [];
    } catch (e) {
      log.error('Error fetching contact blacklist. ', e);
    }
    return blacklist.value;
  }

  async function startBlacklistWatch(): Promise<void> {
    if (stopBlacklistWatch) {
      return;
    }
    try {
      const srv = await contactsSrv();
      stopBlacklistWatch = srv.watchContactBlacklistChanging({
        next: (list: Person[]) => {
          blacklist.value = list ?? [];
        },
        error: (err: unknown) => {
          log.error('Error in watchContactBlacklistChanging. ', err);
          stopBlacklistWatch = undefined;
        },
        complete: () => {
          log.info('watchContactBlacklistChanging completed.');
        },
      });
    } catch (e) {
      log.error('Failed to start watchContactBlacklistChanging. ', e);
    }
  }

  function stopWatching(): void {
    if (stopBlacklistWatch) {
      try {
        stopBlacklistWatch();
      } catch {
        // ignore
      }
      stopBlacklistWatch = undefined;
    }
  }

  function isBlacklisted(mail: string): boolean {
    return blacklist.value.some(contact => contact.mail && areAddressesEqual(contact.mail, mail));
  }

  /**
   * Fills the blacklist from what the background component already knows.
   *
   * It answers at once - its tracker is warm from a cache before any RPC -
   * while the contacts app takes seconds to come up. Until it does, the chat
   * list showed no blocking marks and the composer let the user type into a
   * chat the background component was already refusing to send from.
   *
   * Addresses only: names are not needed to decide who is blocked, and the
   * real list, with them, replaces this one as soon as it arrives.
   */
  async function primeBlacklistFromBackend(): Promise<void> {
    try {
      const addrs = await chatService.getBlacklistedAddresses();
      // Not over the real list: this is a head start, never a correction.
      if (addrs.length > 0 && blacklist.value.length === 0) {
        blacklist.value = addrs.map(mail => ({ id: mail, mail }));
      }
    } catch (e) {
      log.error('Error priming the blacklist from the background component. ', e);
    }
  }

  async function initialize(): Promise<void> {
    await primeBlacklistFromBackend();
    await Promise.all([fetchContacts(), fetchBlacklist()]);
    startBlacklistWatch().catch(() => {});
  }

  async function addContact(mail: string): Promise<void> {
    const isThereSuchContact = !!(await (await contactsSrv()).getContactByMail(mail));
    if (isThereSuchContact) {
      throw makeContactsException({ contactAlreadyExists: true });
    }
    await ensureASMailAddressExists(mail);
    const person: Person = {
      id: 'new',
      name: '',
      mail,
      notice: '',
      phone: '',
    };
    // The contacts service RETURNS {errorType, errorMessage} instead of
    // throwing (e.g. 'exists') — discarding the result silently swallowed
    // those failures while the UI showed nothing.
    const result = await (await contactsSrv()).upsertContact(person);
    if (result && 'errorType' in result) {
      throw makeContactsException(
        result.errorType === 'exists'
          ? { contactAlreadyExists: true, message: result.errorMessage }
          : { invalidValue: true, message: result.errorMessage },
      );
    }
    await fetchContacts();
  }

  /**
   * Blocks or unblocks the owner of an address.
   *
   * The contacts app can only block a contact it has: changeContactBlockingSettings
   * throws for an address that is in no address book. A chat, however, can be
   * held with somebody never added to one, so blocking makes the contact first.
   *
   * addContact() is deliberately not reused for that: it asks ASMail whether
   * the address can receive, which is the right question when a user is adding
   * somebody to write to, and the wrong one here - blocking must work offline,
   * and must work for an address that no longer exists.
   */
  async function setContactBlocking(mail: string, value: boolean): Promise<void> {
    const srv = await contactsSrv();
    const contact = await srv.getContactByMail(mail);

    if (!contact) {
      if (!value) {
        // Nothing to unblock: no contact, hence no blocking flag.
        return;
      }

      const result = await srv.upsertContact({
        id: 'new',
        name: '',
        mail,
        notice: '',
        phone: '',
      } as Person);
      // The contacts service RETURNS {errorType, errorMessage} instead of
      // throwing; see addContact above.
      if (result && 'errorType' in result) {
        throw makeContactsException(
          result.errorType === 'exists'
            ? { contactAlreadyExists: true, message: result.errorMessage }
            : { invalidValue: true, message: result.errorMessage },
        );
      }
      await fetchContacts();
    }

    await srv.changeContactBlockingSettings({ mail, value });
    // The watcher announces this as well, but the button that triggered it
    // should not be waiting on a round trip through another app to update.
    await fetchBlacklist();
  }

  function getContactName(mail: string): string {
    const contact = contactList.value.find(c => areAddressesEqual(c.mail, mail));
    return contact ? contact.displayName : mail;
  }

  return {
    contactList,
    blacklist,
    mailsBlacklist,
    initialize,
    fetchContacts,
    fetchBlacklist,
    startBlacklistWatch,
    stopWatching,
    isBlacklisted,
    setContactBlocking,
    addContact,
    getContactName,
  };
});

export type ContactsStore = ReturnType<typeof useContactsStore>;
