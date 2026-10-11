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
import type { ContactEvent, Person, PersonSettings, PersonView } from '../../src/types/index.ts';

/**
 * Events after which the blacklist may differ from the one already broadcast.
 *
 * 'update:contact-list' is here although some of its sources - a change of
 * avatar files, for one - do not touch the contacts table at all. Listing it
 * costs a recomputation that the fingerprint then finds identical, and leaving
 * it out would lose every change that arrives by synchronisation from another
 * device, which is the whole point of watching these events.
 */
const BLACKLIST_AFFECTING = new Set<ContactEvent['event']>([
  'add:contact',
  'update:contact',
  'remove:contact',
  'update:contact-list',
]);

export function isBlacklistAffecting(event: ContactEvent): boolean {
  return BLACKLIST_AFFECTING.has(event.event);
}

/**
 * The single place where "this contact is blocked" is decided. Both the reply
 * to getContactBlacklist and what the watchers are given go through it, so the
 * two cannot drift apart.
 */
export function selectBlacklisted<T extends Pick<PersonView, 'settings'>>(contacts: T[]): T[] {
  return contacts.filter(contact => !!contact.settings?.blockUser);
}

/**
 * A stable fingerprint of what a subscriber actually sees in the list.
 *
 * Sorted by id, because listAllContactsFrom selects without ORDER BY: after a
 * DROP-and-refill of the table - a restore, a conflict merge, a reloadDb of a
 * version that came from another device - the same set comes back in another
 * order, and without sorting every rebuild of the table would look like a
 * change.
 *
 * `timestamp` is deliberately left out. updateContactInto stamps it on EVERY
 * save, including edits to fields that are not in this list at all, so it says
 * "the contact was touched", not "the list became different".
 *
 * `settings` are serialized by sorted keys: the key order of an object built in
 * the gui and of the same object parsed back from the db's json need not match,
 * and a differing order would read as a difference that is not there.
 */
export function blacklistFingerprint(list: Pick<PersonView, 'id' | 'mail' | 'name' | 'avatarId' | 'settings'>[]): string {
  return JSON.stringify(
    list
      .map(({ id, mail, name, avatarId, settings }) => [
        id,
        mail ?? '',
        name ?? '',
        avatarId ?? '',
        canonicalSettings(settings),
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0))),
  );
}

function canonicalSettings(settings: PersonSettings | null | undefined): string {
  if (!settings) {
    return '';
  }

  return JSON.stringify(
    Object.keys(settings).sort().map(key => [key, settings[key]]),
  );
}

export interface BlacklistBroadcaster {
  /** The blacklist as it is right now, read synchronously. */
  current: () => Person[];
  /** Takes the current state as the baseline, broadcasting nothing. */
  prime: () => void;
  /** Broadcasts the list to the observers, but only if it actually changed. */
  broadcastIfChanged: () => void;
}

/**
 * Keeps the blacklist observers in step with the contacts table.
 *
 * Everything here is SYNCHRONOUS by design, and both halves of that matter.
 * Nothing is awaited, so this cannot deadlock against the proc that serializes
 * the wholesale rewrites of the table - and it cannot observe one halfway
 * through either: updateContactsTable DROPs the table and refills it with an
 * awaited insert per row, so a recomputation deferred past an await could read
 * an empty table and tell every subscriber that nobody is blocked.
 */
export function makeBlacklistBroadcaster({ listContacts, broadcast, onError }: {
  listContacts: () => Pick<PersonView, 'id' | 'mail' | 'name' | 'avatarId' | 'settings'>[];
  broadcast: (list: Person[]) => void;
  onError: (err: unknown) => void;
}): BlacklistBroadcaster {
  let lastBroadcast: string | undefined;

  function current(): Person[] {
    return selectBlacklisted(listContacts()) as Person[];
  }

  function prime(): void {
    try {
      lastBroadcast = blacklistFingerprint(current());
    } catch (err) {
      onError(err);
    }
  }

  function broadcastIfChanged(): void {
    let list: Person[];
    try {
      list = current();
    } catch (err) {
      // Reading the table can fail, e.g. when reloadDb brought in a schema
      // older than the query expects - migrations are not run on a reload.
      // Staying quiet here is better than tearing down the synchronisation
      // phase that emitted the event.
      onError(err);
      return;
    }

    const fingerprint = blacklistFingerprint(list);
    if (fingerprint === lastBroadcast) {
      return;
    }

    lastBroadcast = fingerprint;
    broadcast(list);
  }

  return { current, prime, broadcastIfChanged };
}
