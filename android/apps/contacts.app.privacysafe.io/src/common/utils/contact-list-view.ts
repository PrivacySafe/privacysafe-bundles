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
// Search, grouping and letter ordering for the contact list. Both the desktop
// list and the phone list render from this, so the two stay in step.
import type { ContactListItem } from '@main/types';

/** Section header used for contacts whose display name is empty. */
export const NO_LETTER_KEY = '#';

/**
 * Keeps the contacts whose display name or mail address contains the search
 * text, compared case-insensitively. An empty search keeps everything.
 */
export function filterContacts(
  contacts: ContactListItem[], searchText?: string,
): ContactListItem[] {
  const text = (searchText || '').toLocaleLowerCase();
  if (!text) {
    return contacts.slice();
  }
  return contacts.filter(c => (
    (c.displayName || '').toLocaleLowerCase().includes(text)
    || (c.mail || '').toLocaleLowerCase().includes(text)
  ));
}

/**
 * Groups contacts under the first letter of their display name, sorting each
 * group by display name.
 *
 * A contact with a blank display name is put under NO_LETTER_KEY instead of
 * having its first character read: `''[0]` is undefined, and calling
 * toLowerCase() on it throws, taking the whole list down. That state is
 * reachable — upsertContactListItem() fills a new entry with a blank name.
 */
export function groupByFirstLetter(
  contacts: ContactListItem[],
): Record<string, ContactListItem[]> {
  const groups = contacts.reduce((res, item) => {
    const firstChar = (item.displayName || '')[0];
    const letter = firstChar ? firstChar.toLocaleLowerCase() : NO_LETTER_KEY;
    if (!res[letter]) {
      res[letter] = [];
    }
    res[letter].push(item);
    return res;
  }, {} as Record<string, ContactListItem[]>);

  for (const letter of Object.keys(groups)) {
    groups[letter].sort(byDisplayName);
  }
  return groups;
}

function byDisplayName(a: ContactListItem, b: ContactListItem): number {
  const nameA = (a.displayName || '').toLocaleLowerCase();
  const nameB = (b.displayName || '').toLocaleLowerCase();
  if (nameA === nameB) {
    return 0;
  }
  return ((nameA > nameB) ? 1 : -1);
}

/**
 * Ordered section headers for the grouped list. NO_LETTER_KEY goes last: an
 * unnamed contact belongs at the end, not ahead of 'a' where '#' would sort.
 */
export function initialLetters(
  groups: Record<string, ContactListItem[]>,
): { id: string; label: string }[] {
  return Object.keys(groups)
    .sort((a, b) => {
      if (a === b) {
        return 0;
      }
      if (a === NO_LETTER_KEY) {
        return 1;
      }
      if (b === NO_LETTER_KEY) {
        return -1;
      }
      return ((a > b) ? 1 : -1);
    })
    .map(letter => ({ id: letter, label: letter }));
}
