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
import { describe, expect, it } from 'vitest';
import {
  NO_LETTER_KEY,
  filterContacts,
  groupByFirstLetter,
  initialLetters,
} from '@main/common/utils/contact-list-view';
import type { ContactListItem } from '@main/types';

function item(displayName: string, mail = 'x@3nweb.com'): ContactListItem {
  return {
    id: `${displayName}-${mail}`,
    name: displayName,
    displayName,
    mail,
    avatarId: '',
    avatarImage: '',
    timestamp: 0,
  };
}

describe('filterContacts', () => {

  const contacts = [
    item('Ann', 'ann@3nweb.com'),
    item('Bob', 'bob@example.org'),
    item('Cid', 'cid@3nweb.com'),
  ];

  it('returns everything for an empty search', () => {
    expect(filterContacts(contacts, '').map(c => c.displayName)).toEqual(['Ann', 'Bob', 'Cid']);
    expect(filterContacts(contacts, undefined)).toHaveLength(3);
  });

  it('does not hand back the caller its own array', () => {
    expect(filterContacts(contacts, '')).not.toBe(contacts);
  });

  it('matches on the display name, ignoring case', () => {
    expect(filterContacts(contacts, 'ANN').map(c => c.displayName)).toEqual(['Ann']);
  });

  it('matches on the mail address, ignoring case', () => {
    expect(filterContacts(contacts, 'EXAMPLE.ORG').map(c => c.displayName)).toEqual(['Bob']);
  });

  it('matches a substring anywhere in the value', () => {
    expect(filterContacts(contacts, '3nweb').map(c => c.displayName)).toEqual(['Ann', 'Cid']);
  });

  it('returns nothing when there is no match', () => {
    expect(filterContacts(contacts, 'zzz')).toEqual([]);
  });

  it('tolerates a blank display name', () => {
    expect(() => filterContacts([item('', 'blank@3nweb.com')], 'blank')).not.toThrow();
    expect(filterContacts([item('', 'blank@3nweb.com')], 'blank')).toHaveLength(1);
  });

  it('matches non-ASCII names', () => {
    const cyrillic = [item('Анна', 'anna@3nweb.com'), item('Борис', 'boris@3nweb.com')];

    expect(filterContacts(cyrillic, 'анн').map(c => c.displayName)).toEqual(['Анна']);
  });

});

describe('groupByFirstLetter', () => {

  it('groups by the lowercased first letter', () => {
    const groups = groupByFirstLetter([item('Ann'), item('alice'), item('Bob')]);

    expect(Object.keys(groups).sort()).toEqual(['a', 'b']);
    expect(groups.a.map(c => c.displayName)).toEqual(['alice', 'Ann']);
  });

  // The list components render from the store's `contacts` array, whose order
  // depends on whether the sorted `contactList` computed has been read. Sorting
  // inside the group makes the rendered order independent of that.
  it('sorts each group by display name regardless of input order', () => {
    const groups = groupByFirstLetter([item('Ada'), item('Abe'), item('Ace')]);

    expect(groups.a.map(c => c.displayName)).toEqual(['Abe', 'Ace', 'Ada']);
  });

  // `''[0]` is undefined and calling toLowerCase() on it throws, which took the
  // whole list down. Reachable through upsertContactListItem(), which fills a
  // new entry with a blank display name.
  it('puts a contact with a blank display name under its own key', () => {
    const groups = groupByFirstLetter([item('Ann'), item('')]);

    expect(Object.keys(groups).sort()).toEqual([NO_LETTER_KEY, 'a']);
    expect(groups[NO_LETTER_KEY]).toHaveLength(1);
  });

  it('groups non-ASCII names under their own letters', () => {
    const groups = groupByFirstLetter([item('Анна'), item('Борис'), item('анатолий')]);

    expect(Object.keys(groups).sort()).toEqual(['а', 'б']);
    expect(groups['а'].map(c => c.displayName)).toEqual(['анатолий', 'Анна']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByFirstLetter([])).toEqual({});
  });

});

describe('initialLetters', () => {

  it('orders the section headers alphabetically', () => {
    const letters = initialLetters(groupByFirstLetter([item('Cid'), item('Ann'), item('Bob')]));

    expect(letters.map(l => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('labels each header with its letter', () => {
    expect(initialLetters(groupByFirstLetter([item('Ann')]))).toEqual([{ id: 'a', label: 'a' }]);
  });

  // '#' sorts before 'a' as a character, which would park unnamed contacts at
  // the top of the list. They belong at the end.
  it('puts the blank-name section last', () => {
    const letters = initialLetters(groupByFirstLetter([item(''), item('Ann')]));

    expect(letters.map(l => l.id)).toEqual(['a', NO_LETTER_KEY]);
  });

  it('returns nothing for an empty grouping', () => {
    expect(initialLetters({})).toEqual([]);
  });

});
