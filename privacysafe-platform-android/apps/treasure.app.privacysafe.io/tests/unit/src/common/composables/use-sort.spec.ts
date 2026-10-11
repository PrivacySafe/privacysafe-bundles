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
*/
// Sorting and filtering of the record list - what the user sees in the table,
// and the one place where a wrong comparison is visible on every screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';

const push = vi.fn(async () => undefined);

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

const { useSort } = await import('@/common/composables/use-sort');
const { prepareRecordList } = await import('@/common/utils/for-record-list');
const { APP_ROUTES } = await import('@/common/constants');
const { withSetup } = await import('../../../helpers/app-context');
const { installFakeW3n } = await import('../../../helpers/fake-w3n');

type Rec = Record<string, unknown>;

function aRecord(over: Rec = {}): Rec {
  return { id: 'rec-1', type: 'password', resource: 'example.com', username: 'me', ...over };
}

describe('useSort', () => {

  let fake: ReturnType<typeof installFakeW3n>;
  let app: App | undefined;

  function setup() {
    const res = withSetup(() => useSort());
    app = res.app;
    return res.result;
  }

  beforeEach(() => {
    fake = installFakeW3n();
    push.mockClear();
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    fake.uninstall();
  });

  // The sort lives in the url, so it survives a reload and can be linked to.
  it('puts the chosen sort into the route query', async () => {
    const { changeSort } = setup();

    await changeSort({ field: 'name', direction: 'asc' });

    expect(push).toHaveBeenCalledWith({
      name: APP_ROUTES.RECORD_LIST,
      query: { sortBy: 'name', sortOrder: 'asc' },
    });
  });

  describe('sortTreasuresTableData', () => {

    function sortedNames(records: Rec[], direction: 'asc' | 'desc'): unknown[] {
      const { sortTreasuresTableData } = setup();
      return [...records]
      .sort((a, b) => sortTreasuresTableData(a as never, b as never, 'name', direction))
      .map(r => r.name ?? r.resource);
    }

    it('orders A to Z ascending', () => {
      const records = [
        aRecord({ id: '1', name: 'Bank' }),
        aRecord({ id: '2', name: 'Apple' }),
        aRecord({ id: '3', name: 'Cloud' }),
      ];

      expect(sortedNames(records, 'asc')).toEqual(['Apple', 'Bank', 'Cloud']);
    });

    it('orders Z to A descending', () => {
      const records = [
        aRecord({ id: '1', name: 'Bank' }),
        aRecord({ id: '2', name: 'Apple' }),
        aRecord({ id: '3', name: 'Cloud' }),
      ];

      expect(sortedNames(records, 'desc')).toEqual(['Cloud', 'Bank', 'Apple']);
    });

    it('ignores case when comparing names', () => {
      const records = [
        aRecord({ id: '1', name: 'banana' }),
        aRecord({ id: '2', name: 'Apple' }),
      ];

      expect(sortedNames(records, 'asc')).toEqual(['Apple', 'banana']);
    });

    // A record with no name of its own is shown by its resource, and sorts by
    // it as well.
    it('falls back to the resource when a record has no name', () => {
      const records = [
        aRecord({ id: '1', resource: 'zebra.com' }),
        aRecord({ id: '2', name: 'Apple', resource: 'apple.com' }),
      ];

      expect(sortedNames(records, 'asc')).toEqual(['Apple', 'zebra.com']);
    });

    // Equal values must compare as equal, or the sort has no stable order to
    // fall back on.
    it('answers zero for two records that read the same', () => {
      const { sortTreasuresTableData } = setup();
      const one = aRecord({ id: '1', name: 'Same', resource: 'same.example' });
      const two = aRecord({ id: '2', name: 'same', resource: 'same.example' });

      expect(sortTreasuresTableData(one as never, two as never, 'name', 'asc')).toBe(0);
    });

    // The list and the table order the same records the same way now.
    it('gives the record list the same A to Z order', () => {
      const { sortTreasuresTableData } = setup();
      const records = [aRecord({ id: '1', name: 'Zed' }), aRecord({ id: '2', name: 'Abe' })];

      const sorted = prepareRecordList(records as never, '', sortTreasuresTableData as never);

      expect(sorted.map(r => r.name)).toEqual(['Abe', 'Zed']);
    });

    it('leaves the order alone for a field it does not sort by', () => {
      const { sortTreasuresTableData } = setup();

      expect(sortTreasuresTableData(
        aRecord({ name: 'Zed' }) as never, aRecord({ name: 'Abe' }) as never,
        'resource' as never, 'asc',
      )).toBe(0);
    });

  });

  // The recent list is ordered by when each record was opened, and that order
  // is the whole point of it.
  describe('sortTreasuresRecentData', () => {

    it('keeps the records in the order they came in', () => {
      const { sortTreasuresRecentData } = setup();
      const records = [
        aRecord({ id: '1', name: 'Zed' }),
        aRecord({ id: '2', name: 'Abe' }),
        aRecord({ id: '3', name: 'Mid' }),
      ];

      const sorted = prepareRecordList(records as never, '', sortTreasuresRecentData as never);

      expect(sorted.map(r => r.name)).toEqual(['Zed', 'Abe', 'Mid']);
    });

  });

});

describe('prepareRecordList', () => {

  const records = [
    aRecord({ id: '1', name: 'Bank of Somewhere', resource: 'bank.example', username: 'ann' }),
    aRecord({ id: '2', name: 'Cloud', resource: 'cloud.example', username: 'bob' }),
    aRecord({ id: '3', name: '', resource: 'mail.example', username: 'carol' }),
  ];

  function idsOf(list: unknown[]): unknown[] {
    return (list as { id: string }[]).map(r => r.id);
  }

  it('keeps every record when nothing is searched for', () => {
    expect(idsOf(prepareRecordList(records as never, ''))).toEqual(['1', '2', '3']);
  });

  it('matches on the name', () => {
    expect(idsOf(prepareRecordList(records as never, 'cloud'))).toEqual(['2']);
  });

  it('matches on the resource', () => {
    expect(idsOf(prepareRecordList(records as never, 'mail.example'))).toEqual(['3']);
  });

  it('matches on the username', () => {
    expect(idsOf(prepareRecordList(records as never, 'carol'))).toEqual(['3']);
  });

  it('matches anywhere in the value, not only at its start', () => {
    expect(idsOf(prepareRecordList(records as never, 'somewhere'))).toEqual(['1']);
  });

  // The caller lowercases the search text, so the record side has to as well.
  it('ignores the case of the record', () => {
    expect(idsOf(prepareRecordList(records as never, 'bank of'))).toEqual(['1']);
  });

  it('answers nothing when there is no match', () => {
    expect(prepareRecordList(records as never, 'nothing here')).toEqual([]);
  });

  it('tolerates a record with fields missing', () => {
    const sparse = [{ id: '9' }] as never;

    expect(idsOf(prepareRecordList(sparse, ''))).toEqual(['9']);
  });

  it('tolerates being given no list at all', () => {
    expect(prepareRecordList(undefined, '')).toEqual([]);
  });

  it('sorts what it kept, when given a comparator', () => {
    const byNameDesc = (a: Rec, b: Rec) =>
      (`${a.name}` > `${b.name}` ? -1 : 1) as 1 | -1;

    const sorted = prepareRecordList(records as never, '', byNameDesc as never);

    expect(idsOf(sorted)).toEqual(['2', '1', '3']);
  });

});
