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
// Pure part of the contacts-db conflict resolution, kept free of any
// sqlite/3NStorage import so that it can be unit-tested without pulling in the
// ~1MB precompiled sqlite-on-3nstorage bundle.
import { normalizeJsonField } from './obj-processing.ts';
import { randomStr } from '../../src/common/services/base/random.ts';
import type { Person, RawPerson } from '../../src/types/index.ts';

interface ValidatedContactField {
  field: Exclude<keyof Person, 'id' | 'mail' | 'avatarImage'>;
  extraCheck?: boolean;
}

export const validatedContactFields: ValidatedContactField[] = [
  {
    field: 'name',
  },
  {
    field: 'avatarId',
  },
  {
    field: 'timestamp',
  },
  {
    field: 'notice',
    extraCheck: true,
  },
  {
    field: 'phone',
  },
  {
    field: 'activities',
    extraCheck: true,
  },
  {
    field: 'settings',
    extraCheck: true,
  }];

const jsonFields = ['activities', 'settings'];

/**
 * Copies a contact row read out of sqlite, passing the JSON-ish columns through
 * normalizeJsonField. Iterating field NAMES here is essential: `for...in` over
 * the Object.keys() array walks its indices ("0", "1", …) instead, which
 * silently produces a row with numeric keys and undefined values.
 */
export function normalizeContactRow(contact: RawPerson): RawPerson {
  const normalized = {} as RawPerson;
  for (const field of Object.keys(contact)) {
    if (jsonFields.includes(field)) {
      // @ts-ignore
      normalized[field] = normalizeJsonField(contact[field] as string);
    } else {
      // @ts-ignore
      normalized[field] = contact[field];
    }
  }
  return normalized;
}

/**
 * Renumbers duplicated primary keys, keeping the FIRST occurrence.
 *
 * resolveDbFileConflict matches rows by mail and leaves every remote-only row
 * with the id it was created under on the other device. Two devices can pick
 * the same randomStr(8) for different contacts, and updateContactsTable inserts
 * through insertContactInto, which throws contactAlreadyExists on a primary key
 * clash - failing the whole merge. Remote-only rows are appended last, so the
 * local row is the one that keeps its id.
 *
 * Restoring a backup needs the same guarantee for the same reason, and reaching
 * for it there must not pull in the sqlite runtime - which is why this lives in
 * the pure module rather than next to its first caller.
 */
export function ensureUniqueContactIds(contacts: RawPerson[]): RawPerson[] {
  const seen = new Set<string>();
  return contacts.map(contact => {
    if (!seen.has(contact.id)) {
      seen.add(contact.id);
      return contact;
    }

    let id = randomStr(8);
    while (seen.has(id)) {
      id = randomStr(8);
    }
    seen.add(id);
    return { ...contact, id };
  });
}

/**
 * Merges the local and the remote contact lists field by field, matching rows
 * by mail address. For a field present on both sides the value of the record
 * with the newer timestamp wins.
 *
 * The two flags say which side contributed to the result:
 *
 *  - `areThereDifferences` — did the REMOTE contribute anything the local side
 *    did not have?
 *  - `isLocalAheadOfRemote` — do WE hold anything the remote does not have? If
 *    so the merge differs from the remote version and has to be published; the
 *    remote version must never be adopted without writing the merge back
 *    afterwards, since adopting replaces the table wholesale and everything
 *    local-only is gone for good. Seen for real in the live test of
 *    2026-09-13, where a contact created offline on one device vanished from it
 *    a second after the merge had shown it.
 *
 * Rows matched on both sides with the SAME timestamp are taken to be the same
 * row; the merge itself already resolves them that way, by giving the tie to
 * the local record.
 */
export function resolveDbFileConflict(
  contactListRemote: RawPerson[],
  contactList: RawPerson[],
): {
  areThereDifferences: boolean;
  isLocalAheadOfRemote: boolean;
  resolvedContactList: RawPerson[];
} {
  const resolvedContactList: RawPerson[] = [];
  let areThereDifferences = false;
  let isLocalAheadOfRemote = false;
  const remoteMap = new Map(contactListRemote.map(p => [p.mail, p]));

  for (const localPerson of contactList) {
    const remotePerson = remoteMap.get(localPerson.mail);

    if (!remotePerson) {
      resolvedContactList.push(localPerson);
      isLocalAheadOfRemote = true;
    } else {
      const resolvedContact = { id: localPerson.id, mail: localPerson.mail } as RawPerson;
      const olderRecord = localPerson.timestamp >= remotePerson.timestamp ? localPerson : remotePerson;

      for (const item of validatedContactFields) {
        const { field } = item;

        if (!localPerson[field] && !remotePerson[field]) {
          // @ts-ignore
          resolvedContact[field] = null;
          continue;
        }

        if (localPerson[field] && !remotePerson[field]) {
          // @ts-ignore
          resolvedContact[field] = localPerson[field];
          isLocalAheadOfRemote = true;
        } else if (remotePerson[field] && !localPerson[field]) {
          // @ts-ignore
          resolvedContact[field] = remotePerson[field];
          areThereDifferences = true;
        } else {
          // @ts-ignore
          resolvedContact[field] = olderRecord[field];
          if (remotePerson.timestamp > localPerson.timestamp) {
            areThereDifferences = true;
          } else if (localPerson.timestamp > remotePerson.timestamp) {
            isLocalAheadOfRemote = true;
          }
        }
      }

      resolvedContactList.push(resolvedContact);

      remoteMap.delete(localPerson.mail);
    }
  }

  for (const remotePerson of remoteMap.values()) {
    areThereDifferences = true;
    resolvedContactList.push(remotePerson);
  }

  return { areThereDifferences, isLocalAheadOfRemote, resolvedContactList };
}
