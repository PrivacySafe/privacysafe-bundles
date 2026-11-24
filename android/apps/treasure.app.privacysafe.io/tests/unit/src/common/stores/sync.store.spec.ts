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
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSyncStore } from '@/common/stores/sync.store';

describe('sync.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('runs while any synchronization is under way', () => {
    const store = useSyncStore();
    expect(store.isSyncRunning).toBe(false);

    store.addRecordToSyncList('rec-1', 'upload');
    expect(store.isSyncRunning).toBe(true);

    store.removeRecordFromSyncList('rec-1');
    expect(store.isSyncRunning).toBe(false);
  });

  it('moves the images revision when a sync that may bring images ends', () => {
    const store = useSyncStore();

    for (const path of ['images', 'images/abc', 'root']) {
      const before = store.imagesRevision;
      store.addRecordToSyncList(path, 'download');
      store.removeRecordFromSyncList(path);
      expect(store.imagesRevision).toBe(before + 1);
    }
  });

  it('leaves the images revision alone for a record', () => {
    const store = useSyncStore();

    store.addRecordToSyncList('rec-1', 'download');
    store.removeRecordFromSyncList('rec-1');

    expect(store.imagesRevision).toBe(0);
  });
});
