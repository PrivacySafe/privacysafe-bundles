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
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { defineStore } from 'pinia';
import isEmpty from 'lodash/isEmpty';
import cloneDeep from 'lodash/cloneDeep';
import set from 'lodash/set';
import difference from 'lodash/difference';
import { appContactsSrvProxy } from '@main/common/services/services-provider';
import { includesMailAddress } from '@main/common/utils/mail-address';
import { useAppStore } from '@main/common/store/app.store';
import type { Person, PersonView, ContactListItem } from '@main/types';

const contactFields: {
  field: Exclude<keyof ContactListItem, 'id'>;
  extraCheck?: boolean;
}[] = [
  { field: 'name' },
  { field: 'displayName' },
  { field: 'mail' },
  { field: 'avatarId' },
  { field: 'avatarImage' },
  { field: 'timestamp' },
  { field: 'settings', extraCheck: true },
];

export const useContactsStore = defineStore('contacts', () => {
  const appStore = useAppStore();
  const { t } = useI18n();

  const contacts = ref<ContactListItem[]>([]);

  const contactDataFromCmd = ref<Person | null>(null);

  const currentContactIds = computed(() => contacts.value.map(c => c.id));

  /**
   * Contacts keyed by id, in display-name order.
   *
   * Sorted on a COPY: Array.prototype.sort mutates, so sorting `contacts` here
   * made merely READING this computed reorder the array both list views render
   * from. Their order then depended on whether anything had happened to read
   * contactList first.
   */
  const contactList = computed(() => {
    return contacts.value
      .slice()
      .sort((a, b) => {
        const nameA = (a.displayName || '').toLocaleLowerCase();
        const nameB = (b.displayName || '').toLocaleLowerCase();
        if (nameA === nameB) {
          return 0;
        }
        return nameA > nameB ? 1 : -1;
      })
      .reduce(
        (res, item) => {
          res[item.id] = item;
          return res;
        },
        {} as Record<string, ContactListItem>,
      );
  });

  const mailAddressesUsed = computed(() => Object.values(contactList.value).map(p => p.mail));

  /**
   * Compared canonically, not as raw strings: 'Ann@3NWeb.com' and
   * 'ann@3nweb.com' are one address, and reading them as two is how one person
   * ends up as two contacts. The service's own duplicate check does the same.
   */
  function isMailAddressInUse(mail: string, ignoredMailAddresses?: string[]): boolean {
    const stillTaken = mailAddressesUsed.value.filter(a => !includesMailAddress(ignoredMailAddresses || [], a));
    return includesMailAddress(stillTaken, mail);
  }

  function buildContactListItem(item: PersonView | Person, existing?: ContactListItem): ContactListItem {
    const isMyself = item.mail === appStore.user;
    return {
      id: item.id,
      name: isMyself ? t('contact.myself.name') : item.name,
      displayName: isMyself ? t('contact.myself.name') : item.name || item.mail,
      mail: item.mail,
      avatarId: item.avatarId || '',
      avatarImage: existing && existing.avatarId === item.avatarId ? existing.avatarImage : (item.avatarImage || ''),
      timestamp: item.timestamp || 0,
      settings: item.settings || {},
    };
  }

  async function upsertContact(contact: Omit<Person, 'timestamp' | 'avatarImage'>): Promise<
    | Person
    | {
        errorType: string;
        errorMessage: string;
      }
  > {
    const res = await appContactsSrvProxy.upsertContact(contact);

    if (res && !('errorType' in res)) {
      const index = contacts.value.findIndex(c => c.id === res.id);
      if (index >= 0) {
        contacts.value[index] = buildContactListItem(res, contacts.value[index]);
      } else {
        contacts.value.push(buildContactListItem(res));
      }
    }

    return res;
  }

  async function getContact(contactId: string): Promise<Person | undefined> {
    return appContactsSrvProxy.getContact(contactId);
  }

  async function fetchContacts({
    withImage,
    withFullOverload,
  }: {
    withImage?: boolean;
    withFullOverload?: boolean;
  }): Promise<ContactListItem[]> {
    const list = await appContactsSrvProxy.getContactList(withImage);

    if (isEmpty(list)) {
      contacts.value = [] as ContactListItem[];
      return contacts.value;
    }

    const { newIds, newContacts } = list.reduce(
      (res, item) => {
        const newContact = buildContactListItem(item);

        res.newIds.push(newContact.id);
        res.newContacts.push(newContact);
        return res;
      },
      { newIds: [] as string[], newContacts: [] as ContactListItem[] },
    );

    if (withFullOverload) {
      contacts.value = newContacts;
    } else {
      const addIds = difference(newIds, currentContactIds.value);
      const removeIds = difference(currentContactIds.value, newIds);

      const removeIdsIndexes = contacts.value
        .reduce((res, contact, index) => {
          if (removeIds.includes(contact.id)) {
            res.push(index);
          }
          return res;
        }, [] as number[])
        .sort((a, b) => b - a);

      for (const item of removeIdsIndexes) {
        contacts.value.splice(item, 1);
      }

      for (const newContact of newContacts) {
        const { id } = newContact;
        if (addIds.includes(id)) {
          contacts.value.push(newContact);
        }
      }

      for (const item of contacts.value) {
        const { id } = item;
        const newContact = newContacts.find(c => c.id === id)!;

        for (const f of contactFields) {
          const { field, extraCheck } = f;
          const newContactFieldValue: ContactListItem[keyof ContactListItem] = extraCheck
            ? JSON.stringify(newContact[field])
            : newContact[field];

          const contactFieldValue: ContactListItem[keyof ContactListItem] = extraCheck
            ? JSON.stringify(item[field])
            : item[field];

          if (contactFieldValue !== newContactFieldValue) {
            (item[field] as ContactListItem[keyof ContactListItem]) = newContact[field];
          }
        }
      }
    }

    return contacts.value;
  }

  function upsertContactListItem(id: string, data: Partial<PersonView>) {
    const index = contacts.value.findIndex(item => item.id === id);
    if (index >= 0) {
      contacts.value[index] = {
        ...contacts.value[index],
        id,
        ...data,
      };
    } else {
      contacts.value.push({
        id,
        mail: '',
        name: '',
        displayName: '',
        avatarId: '',
        avatarImage: '',
        timestamp: 0,
        ...data,
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function updateContactField(id: string, path: string | string[], value: any) {
    const index = contacts.value.findIndex(item => item.id === id);
    if (index < 0) {
      return;
    }

    const contact = cloneDeep(contacts.value[index]);
    set(contact, path, value);
    contacts.value[index] = contact;
  }

  async function deleteContact(contactId: string, withoutParentUpload?: boolean): Promise<void> {
    if (contactId) {
      await appContactsSrvProxy.deleteContact(contactId, withoutParentUpload);
      const index = contacts.value.findIndex(item => item.id === contactId);
      if (index >= 0) {
        contacts.value.splice(index, 1);
      }
    }
  }

  async function deleteContacts(contactIds: string[]): Promise<void> {
    if (isEmpty(contactIds)) {
      return;
    }

    for (let i = 0; i < contactIds.length; i++) {
      const withoutParentUpload = i !== contactIds.length - 1;
      await deleteContact(contactIds[i], withoutParentUpload);
    }
  }

  async function changeContactBlockingSettings(id: string, value: boolean) {
    return await appContactsSrvProxy.changeContactBlockingSettings({ id, value });
  }

  return {
    contacts,
    contactDataFromCmd,
    contactList,
    isMailAddressInUse,
    upsertContactListItem,
    updateContactField,
    fetchContacts,
    getContact,
    upsertContact,
    deleteContact,
    deleteContacts,
    changeContactBlockingSettings,
  };
});

export type ContactsStore = ReturnType<typeof useContactsStore>;

