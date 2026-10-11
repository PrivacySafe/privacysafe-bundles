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
import { describe, expect, it, vi } from 'vitest';
import {
  objectFromQueryExecResult,
  personValueToSqlInsertParams,
  queryResultToPerson,
} from '@deno/dataset/contact-row-mapping.ts';
import type { Person, RawPerson } from '@main/types';

const contactColumns = [
  'id', 'mail', 'name', 'avatarId', 'timestamp', 'notice', 'phone', 'activities', 'settings',
];

function queryResult(values: unknown[][]) {
  return { columns: contactColumns, values } as never;
}

// BindParams is `SqlValue[] | ParamsObject | null`; every call here passes an
// object, so narrow once instead of asserting at each use site.
function paramsOf(value: Omit<Person, 'avatarImage'> | RawPerson): Record<string, unknown> {
  return personValueToSqlInsertParams(value) as Record<string, unknown>;
}

function person(over: Partial<Person> = {}): Omit<Person, 'avatarImage'> {
  return {
    id: 'c1',
    mail: 'ann@3nweb.com',
    name: 'Ann',
    avatarId: undefined,
    timestamp: 42,
    notice: '',
    phone: '',
    ...over,
  } as Omit<Person, 'avatarImage'>;
}

describe('objectFromQueryExecResult', () => {

  it('maps rows into objects keyed by column name', () => {
    const rows = objectFromQueryExecResult<RawPerson>(queryResult([
      ['c1', 'ann@3nweb.com', 'Ann', null, 42, null, null, null, null],
      ['c2', 'bob@3nweb.com', 'Bob', 'av1', 43, 'note', '+1', '[]', '{}'],
    ]));

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('c1');
    expect(rows[0].name).toBe('Ann');
    expect(rows[1].avatarId).toBe('av1');
    expect(rows[1].phone).toBe('+1');
  });

  it('returns an empty array for an empty result set', () => {
    expect(objectFromQueryExecResult<RawPerson>(queryResult([]))).toEqual([]);
  });

  it('keeps null cell values as null', () => {
    const [row] = objectFromQueryExecResult<RawPerson>(queryResult([
      ['c1', 'ann@3nweb.com', null, null, 0, null, null, null, null],
    ]));

    expect(row.name).toBeNull();
    expect(row.activities).toBeNull();
  });

});

describe('personValueToSqlInsertParams', () => {

  it('stringifies the array/object shapes carried by Person', () => {
    const params = paramsOf(person({
      activities: [{ id: 'a1' }] as unknown as Person['activities'],
      settings: { s: 1 },
    }));

    expect(params.$activities).toBe('[{"id":"a1"}]');
    expect(params.$settings).toBe('{"s":1}');
  });

  // `settings` is a typed object now, so the one key the app actually reads
  // has to survive the trip through the TEXT column unchanged.
  it('round-trips the blockUser settings flag', () => {
    const params = paramsOf(person({ settings: { blockUser: true } }));

    expect(params.$settings).toBe('{"blockUser":true}');

    const read = queryResultToPerson(queryResult([
      ['c1', 'ann@3nweb.com', 'Ann', null, 42, null, null, null, params.$settings],
    ]));

    expect(read.settings).toEqual({ blockUser: true });
  });

  it('passes through the string shapes carried by RawPerson', () => {
    const params = paramsOf({
      id: 'c1',
      mail: 'ann@3nweb.com',
      activities: '[1]',
      settings: '{"s":1}',
      timestamp: 42,
    } as unknown as RawPerson);

    expect(params.$activities).toBe('[1]');
    expect(params.$settings).toBe('{"s":1}');
  });

  // Regression guard: the $settings branch used to test `value.activities`
  // instead of `value.settings`, so a string `settings` was dropped to null
  // whenever `activities` was not itself a string. Reachable from
  // updateContactsTable, where the two fields are independently string-or-null.
  it('keeps a string settings when activities is not a string', () => {
    expect(paramsOf({
      id: 'c1', mail: 'ann@3nweb.com', timestamp: 1,
      activities: null, settings: '{"s":1}',
    } as unknown as RawPerson).$settings).toBe('{"s":1}');

    expect(paramsOf({
      id: 'c1', mail: 'ann@3nweb.com', timestamp: 1,
      activities: [{ id: 'a1' }], settings: '{"s":1}',
    } as unknown as RawPerson).$settings).toBe('{"s":1}');
  });

  it('maps absent activities and settings to null', () => {
    const params = paramsOf(person());

    expect(params.$activities).toBeNull();
    expect(params.$settings).toBeNull();
  });

  it('maps empty optional strings to null', () => {
    const params = paramsOf(person({
      name: '', avatarId: '', notice: '', phone: '',
    }));

    expect(params.$name).toBeNull();
    expect(params.$avatarId).toBeNull();
    expect(params.$notice).toBeNull();
    expect(params.$phone).toBeNull();
  });

  it('keeps mail and id verbatim and defaults a missing timestamp to 0', () => {
    const params = paramsOf(person({
      timestamp: 0, mail: 'Ann Tester@3NWeb.com',
    }));

    expect(params.$id).toBe('c1');
    // No canonicalisation happens here — the address is stored as typed.
    expect(params.$mail).toBe('Ann Tester@3NWeb.com');
    expect(params.$timestamp).toBe(0);
  });

});

describe('queryResultToPerson', () => {

  it('parses the JSON columns of the requested row', () => {
    const result = queryResultToPerson(queryResult([
      ['c1', 'ann@3nweb.com', 'Ann', null, 42, null, null, '[{"id":"a1"}]', '{"s":1}'],
    ]));

    expect(result.activities).toEqual([{ id: 'a1' }]);
    expect(result.settings).toEqual({ s: 1 });
  });

  it('defaults null JSON columns to an empty array and an empty object', () => {
    const result = queryResultToPerson(queryResult([
      ['c1', 'ann@3nweb.com', 'Ann', null, 42, null, null, null, null],
    ]));

    expect(result.activities).toEqual([]);
    expect(result.settings).toEqual({});
  });

  it('reads the row addressed by the row index', () => {
    const result = queryResultToPerson(queryResult([
      ['c1', 'ann@3nweb.com', 'Ann', null, 42, null, null, null, null],
      ['c2', 'bob@3nweb.com', 'Bob', null, 43, null, null, null, null],
    ]), 1);

    expect(result.id).toBe('c2');
    expect(result.name).toBe('Bob');
  });

  // A bare JSON.parse here took the whole read down on a malformed value, while
  // updateContactInto tolerated the same value on the way out. Now a column that
  // cannot be parsed costs its own field, not the contact.
  it('falls back to the empty shape for a malformed JSON column', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = queryResultToPerson(queryResult([
      ['c1', 'ann@3nweb.com', 'Ann', null, 42, null, null, '{not json', '{"s":1}'],
    ]));

    expect(result.id).toBe('c1');
    expect(result.name).toBe('Ann');
    expect(result.activities).toEqual([]);
    // The intact column is still read.
    expect(result.settings).toEqual({ s: 1 });

    warn.mockRestore();
  });

});
