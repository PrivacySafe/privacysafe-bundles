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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';

/* eslint-disable @typescript-eslint/no-unused-vars */
const rewriteGroups = vi.fn(async (_groups: unknown[]) => true);
const getAllTreasureGroups = vi.fn(async () => [] as unknown[]);
const getAllRecords = vi.fn(async () => ({ records: [] as unknown[], errors: [] }));
const getRecord = vi.fn(async (_id: string) => null as unknown);
const addRecord = vi.fn(async (_data: unknown) => ({ id: 'minted-id', wasSync: true }));
const updateRecord = vi.fn(async (_data: unknown) => true);
const deleteRecord = vi.fn(async (_data: unknown) => true);
const loadRecentFile = vi.fn(async () => [] as string[]);
const saveRecentFile = vi.fn(async (_ids: string[]) => undefined);
const getRecordSyncStatus = vi.fn(async (_id: string) => undefined);

vi.mock('@/common/services/service-provider', () => ({
  appTreasureDenoSrv: {
    rewriteGroups: (groups: unknown[]) => rewriteGroups(groups),
    getAllTreasureGroups: () => getAllTreasureGroups(),
    getAllRecords: () => getAllRecords(),
    getRecord: (id: string) => getRecord(id),
    addRecord: (data: unknown) => addRecord(data),
    updateRecord: (data: unknown) => updateRecord(data),
    deleteRecord: (data: unknown) => deleteRecord(data),
    loadRecentFile: () => loadRecentFile(),
    saveRecentFile: (ids: string[]) => saveRecentFile(ids),
    getRecordSyncStatus: (id: string) => getRecordSyncStatus(id),
  },
}));

const { useRecordStore } = await import('@/common/stores/record.store');
const { RECORD_TYPE, DEFAULT_GROUP } = await import('@shared/constants');
const { withSetup } = await import('../../../helpers/app-context');
const { installFakeW3n } = await import('../../../helpers/fake-w3n');

type Rec = Record<string, unknown>;

function aRecord(over: Rec = {}): Rec {
  return {
    id: 'rec-1',
    type: RECORD_TYPE.PASSWORD,
    resource: 'example.com',
    username: 'me',
    ...over,
  };
}

describe('record.store', () => {

  let fake: ReturnType<typeof installFakeW3n>;
  let app: App | undefined;

  function setup() {
    const res = withSetup(() => useRecordStore());
    app = res.app;
    return res.result;
  }

  beforeEach(() => {
    fake = installFakeW3n();
    vi.clearAllMocks();
    rewriteGroups.mockResolvedValue(true);
    getAllTreasureGroups.mockResolvedValue([]);
    getAllRecords.mockResolvedValue({ records: [], errors: [] });
    addRecord.mockResolvedValue({ id: 'minted-id', wasSync: true });
    updateRecord.mockResolvedValue(true);
    loadRecentFile.mockResolvedValue([]);
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    fake.uninstall();
  });

  describe('groups', () => {

    it('loads groups keyed by their id', async () => {
      getAllTreasureGroups.mockResolvedValue([
        { id: 'g1', name: 'Work' }, { id: 'g2', name: 'Home' },
      ]);
      const store = setup();

      await store.getAllGroups();

      expect(store.getGroup('g1')).toMatchObject({ name: 'Work' });
      expect(store.getGroup('absent')).toBeUndefined();
    });

    it('answers no groups when the service has none', async () => {
      getAllTreasureGroups.mockResolvedValue(null as unknown as unknown[]);
      const store = setup();

      await store.getAllGroups();

      expect(store.sortedGroups).toEqual([]);
    });

    it('sorts groups by name, ignoring case', async () => {
      getAllTreasureGroups.mockResolvedValue([
        { id: 'g1', name: 'work' }, { id: 'g2', name: 'Bank' }, { id: 'g3', name: 'home' },
      ]);
      const store = setup();

      await store.getAllGroups();

      expect(store.sortedGroups.map(g => g.name)).toEqual(['Bank', 'home', 'work']);
    });

    // The built-in groups always come first, and in a fixed order.
    it('puts the default groups ahead of the ones a user made', async () => {
      getAllTreasureGroups.mockResolvedValue([{ id: 'g1', name: 'Work' }]);
      const store = setup();

      await store.getAllGroups();

      expect(store.sortedGroupsAll.map(g => g.id)).toEqual([
        'all', DEFAULT_GROUP.RECENT, DEFAULT_GROUP.CARDS,
        DEFAULT_GROUP.BANK_CARDS, DEFAULT_GROUP.FAVORITES, 'g1',
      ]);
    });

    it('adds a group and writes the whole list back', async () => {
      const store = setup();

      await store.upsertGroup({ id: 'g1', name: 'Work' } as never);

      expect(rewriteGroups).toHaveBeenCalledWith([{ id: 'g1', name: 'Work' }]);
      expect(store.getGroup('g1')).toMatchObject({ name: 'Work' });
    });

    // The service reports whether the write reached the server; a group that
    // did not is marked, so the ui can show it as pending.
    it('marks a group the service could not sync', async () => {
      rewriteGroups.mockResolvedValue(false);
      const store = setup();

      await store.upsertGroup({ id: 'g1', name: 'Work' } as never);

      expect(store.getGroup('g1')).toMatchObject({ withoutSync: true });
    });

    it('renames a group in place', async () => {
      const store = setup();
      await store.upsertGroup({ id: 'g1', name: 'Work' } as never);

      await store.upsertGroup({ id: 'g1', name: 'Office' } as never);

      expect(store.sortedGroups).toHaveLength(1);
      expect(store.getGroup('g1')).toMatchObject({ name: 'Office' });
    });

    it('deletes a group that holds nothing', async () => {
      const store = setup();
      await store.upsertGroup({ id: 'g1', name: 'Work' } as never);

      await expect(store.deleteGroup('g1')).resolves.toBe(true);
      expect(store.getGroup('g1')).toBeUndefined();
    });

    // Otherwise its records would be left pointing at a group that is gone.
    it('refuses to delete a group that still holds records', async () => {
      getAllRecords.mockResolvedValue({
        records: [aRecord({ id: 'rec-1', group: 'g1' })], errors: [],
      });
      const store = setup();
      await store.upsertGroup({ id: 'g1', name: 'Work' } as never);
      await store.getAllRecords();

      await expect(store.deleteGroup('g1')).resolves.toBe(false);
      expect(store.getGroup('g1')).toBeDefined();
    });

  });

  describe('records', () => {

    it('loads records from the service', async () => {
      getAllRecords.mockResolvedValue({ records: [aRecord(), aRecord({ id: 'rec-2' })], errors: [] });
      const store = setup();

      await store.getAllRecords();

      expect(store.records).toHaveLength(2);
    });

    it('adds a record under the id the service minted', async () => {
      const store = setup();

      await store.addRecord(aRecord({ id: 'new' }) as never);

      expect(store.records).toHaveLength(1);
      expect(store.records[0]).toMatchObject({ id: 'minted-id', withoutSync: false });
    });

    // A record that already exists must go through updateRecord, or the service
    // would write a second file for it.
    it('refuses to add a record that already has an id', async () => {
      const store = setup();

      await expect(store.addRecord(aRecord({ id: 'rec-1' }) as never))
      .rejects.toThrow(/other then 'new'/);
      expect(addRecord).not.toHaveBeenCalled();
    });

    it('marks a record the service could not sync', async () => {
      addRecord.mockResolvedValue({ id: 'minted-id', wasSync: false });
      const store = setup();

      await store.addRecord(aRecord({ id: 'new' }) as never);

      expect(store.records[0]).toMatchObject({ withoutSync: true });
    });

    it('updates a record in place, keeping the fields not given', async () => {
      getAllRecords.mockResolvedValue({ records: [aRecord()], errors: [] });
      const store = setup();
      await store.getAllRecords();

      await store.updateRecord('rec-1', { id: 'rec-1', username: 'someone-else' });

      expect(store.records).toHaveLength(1);
      expect(store.records[0]).toMatchObject({
        username: 'someone-else', resource: 'example.com',
      });
    });

    it('says nothing to the service about a record it does not hold', async () => {
      const store = setup();

      await store.updateRecord('absent', { id: 'absent' });

      expect(updateRecord).not.toHaveBeenCalled();
    });

    it('removes a record, and tells the service', async () => {
      getAllRecords.mockResolvedValue({ records: [aRecord()], errors: [] });
      const store = setup();
      await store.getAllRecords();

      await store.removeRecord('rec-1');

      expect(store.records).toHaveLength(0);
      expect(deleteRecord).toHaveBeenCalled();
    });

    it('does not call the service to remove what it does not hold', async () => {
      const store = setup();

      await store.removeRecord('absent');

      expect(deleteRecord).not.toHaveBeenCalled();
    });

  });

  describe('grouping of records', () => {

    beforeEach(() => {
      getAllRecords.mockResolvedValue({
        records: [
          aRecord({ id: 'rec-1', group: 'g1' }),
          aRecord({ id: 'rec-2', group: 'g1' }),
          aRecord({ id: 'rec-3', group: 'g2', isFavorite: true }),
          aRecord({ id: 'rec-4', type: RECORD_TYPE.CARD }),
          aRecord({ id: 'rec-5', type: RECORD_TYPE.BANK_CARD }),
        ],
        errors: [],
      });
    });

    it('collects records under the group each belongs to', async () => {
      const store = setup();
      await store.getAllRecords();

      expect(store.recordsByGroups.g1.map(r => r.id)).toEqual(['rec-1', 'rec-2']);
      expect(store.recordsByGroups.g2.map(r => r.id)).toEqual(['rec-3']);
    });

    it('fills the built-in groups by what a record is, not where it sits', async () => {
      const store = setup();
      await store.getAllRecords();

      expect(store.recordsByGroups[DEFAULT_GROUP.FAVORITES].map(r => r.id))
      .toEqual(['rec-3']);
      expect(store.recordsByGroups[DEFAULT_GROUP.CARDS].map(r => r.id))
      .toEqual(['rec-4']);
      expect(store.recordsByGroups[DEFAULT_GROUP.BANK_CARDS].map(r => r.id))
      .toEqual(['rec-5']);
    });

    it('leaves a record with no group out of the grouping', async () => {
      const store = setup();
      await store.getAllRecords();

      const grouped = Object.entries(store.recordsByGroups)
      .filter(([key]) => !Object.values(DEFAULT_GROUP).includes(key as never))
      .flatMap(([, list]) => (list as { id: string }[]).map(r => r.id));

      expect(grouped).not.toContain('rec-4');
    });

    it('lists favourites', async () => {
      const store = setup();
      await store.getAllRecords();

      expect(store.favoritesRecords.map(r => r.id)).toEqual(['rec-3']);
    });

  });

  describe('the recent list', () => {

    it('loads what was stored', async () => {
      loadRecentFile.mockResolvedValue(['rec-1', 'rec-2']);
      const store = setup();

      await store.loadRecentRecords();

      expect(store.numOfRecentRecords).toBe(0); // no records loaded yet
      await store.saveRecentRecords();
      expect(saveRecentFile).toHaveBeenCalledWith(['rec-1', 'rec-2']);
    });

    it('appends a record, and persists the list', async () => {
      const store = setup();

      await store.addRecordToRecent('rec-1');

      expect(saveRecentFile).toHaveBeenCalledWith(['rec-1']);
    });

    // Opening something already in the list moves it to the end rather than
    // adding it twice.
    it('moves a record already listed to the end', async () => {
      loadRecentFile.mockResolvedValue(['rec-1', 'rec-2', 'rec-3']);
      const store = setup();
      await store.loadRecentRecords();

      await store.addRecordToRecent('rec-1');

      expect(saveRecentFile).toHaveBeenLastCalledWith(['rec-2', 'rec-3', 'rec-1']);
    });

    // The list is capped, and it is the oldest end that gives way.
    it('drops the oldest once twenty are listed', async () => {
      const twenty = Array.from({ length: 20 }, (_, i) => `rec-${i}`);
      loadRecentFile.mockResolvedValue(twenty);
      const store = setup();
      await store.loadRecentRecords();

      await store.addRecordToRecent('rec-new');

      const saved = saveRecentFile.mock.calls.at(-1)![0];
      expect(saved).toHaveLength(20);
      expect(saved[0]).toBe('rec-1');
      expect(saved.at(-1)).toBe('rec-new');
    });

    it('removes a record from the list', async () => {
      loadRecentFile.mockResolvedValue(['rec-1', 'rec-2']);
      const store = setup();
      await store.loadRecentRecords();

      await store.removeRecordFromRecent('rec-1');

      expect(saveRecentFile).toHaveBeenLastCalledWith(['rec-2']);
    });

    it('leaves the list alone when removing what is not in it', async () => {
      loadRecentFile.mockResolvedValue(['rec-1']);
      const store = setup();
      await store.loadRecentRecords();
      saveRecentFile.mockClear();

      await store.removeRecordFromRecent('absent');

      expect(saveRecentFile).not.toHaveBeenCalled();
    });

    // Deleting a record must not leave it behind in recent, pointing at nothing.
    it('drops a deleted record from the recent list', async () => {
      loadRecentFile.mockResolvedValue(['rec-1']);
      getAllRecords.mockResolvedValue({ records: [aRecord()], errors: [] });
      const store = setup();
      await store.loadRecentRecords();
      await store.getAllRecords();

      await store.removeRecord('rec-1');

      expect(saveRecentFile).toHaveBeenLastCalledWith([]);
    });

    it('counts only recent records it actually holds', async () => {
      loadRecentFile.mockResolvedValue(['rec-1', 'gone']);
      getAllRecords.mockResolvedValue({ records: [aRecord()], errors: [] });
      const store = setup();
      await store.loadRecentRecords();
      await store.getAllRecords();

      expect(store.numOfRecentRecords).toBe(1);
    });

    it('empties the list on reset', async () => {
      loadRecentFile.mockResolvedValue(['rec-1']);
      const store = setup();
      await store.loadRecentRecords();

      await store.$reset();

      expect(saveRecentFile).toHaveBeenLastCalledWith([]);
    });

  });

  describe('updateRecordList', () => {

    it('adds a record it does not hold yet', () => {
      const store = setup();

      store.updateRecordList(aRecord() as never);

      expect(store.records).toHaveLength(1);
    });

    it('replaces a record it already holds', () => {
      const store = setup();
      store.updateRecordList(aRecord() as never);

      store.updateRecordList(aRecord({ username: 'someone-else' }) as never);

      expect(store.records).toHaveLength(1);
      expect(store.records[0]).toMatchObject({ username: 'someone-else' });
    });

    it('removes a record when asked to', () => {
      const store = setup();
      store.updateRecordList(aRecord() as never);

      store.updateRecordList(aRecord() as never, true);

      expect(store.records).toHaveLength(0);
    });

    it('does not add a record it was asked to remove', () => {
      const store = setup();

      store.updateRecordList(aRecord() as never, true);

      expect(store.records).toHaveLength(0);
    });

  });

});
