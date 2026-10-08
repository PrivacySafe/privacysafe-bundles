/*
 Copyright (C) 2024-2025 3NSoft Inc.

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
import type { Person, PersonView } from './contacts.types';

/**
 * What the contacts app answers when a write fails.
 *
 * It returns this INSTEAD of throwing, so a caller that ignores the result
 * swallows the failure silently while the interface shows nothing.
 */
export interface ContactsSrvError {
  errorType: string;
  errorMessage: string;
}

/**
 * This service comes from contacts app.
 *
 * One declaration for both halves of this app: the window uses it to show and
 * change the blacklist, the background component to read it.
 */
export interface AppContacts {
  getContact(id: string): Promise<Person | undefined>;

  getContactByMail(mail: string): Promise<Person | undefined>;

  getContactList(withImage?: boolean): Promise<PersonView[]>;

  upsertContact(value: Person): Promise<Person | ContactsSrvError>;

  /** Contacts whose `settings.blockUser` is set, as of right now. */
  getContactBlacklist(withImage?: boolean): Promise<PersonView[]>;

  /**
   * Sets or clears the blocking flag.
   *
   * Throws for an address that is in no address book, so blocking a stranger
   * has to make the contact first - see setContactBlocking in contacts.store.
   */
  changeContactBlockingSettings(value: {
    id?: string;
    mail?: string;
    value: boolean;
  }): Promise<Person>;

  /** Observable: the whole list, on every change to it. */
  watchContactBlacklistChanging(obs: web3n.Observer<PersonView[]>): () => void;
}

export interface FileLinkStoreService {
  saveLink(file: web3n.files.ReadonlyFile): Promise<string>;

  getLink(fileId: string): Promise<web3n.files.SymLink | null | undefined>;

  getFile(fileId: string): Promise<web3n.files.Linkable | null | undefined>;

  deleteLink(fileId: string): Promise<void>;
}
