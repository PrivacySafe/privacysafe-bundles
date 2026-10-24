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
import { useSyncStore } from '@main/common/store/sync.store';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from '@deno/constants';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useSyncStore', () => {

  it('reports nothing running while the list is empty', () => {
    expect(useSyncStore().isSyncRunning).toBe(false);
  });

  it('reports running while a path is in the list', () => {
    const store = useSyncStore();

    store.addToSyncList(CONTACTS_DB_FILE);

    expect(store.isSyncRunning).toBe(true);
  });

  it('stops reporting once the path is removed', () => {
    const store = useSyncStore();
    store.addToSyncList(CONTACTS_DB_FILE);

    store.removeFromSyncList(CONTACTS_DB_FILE);

    expect(store.isSyncRunning).toBe(false);
  });

  it('tracks several paths independently', () => {
    const store = useSyncStore();
    store.addToSyncList(CONTACTS_DB_FILE);
    store.addToSyncList(IMAGES_FOLDER);

    store.removeFromSyncList(CONTACTS_DB_FILE);

    expect(store.isSyncRunning).toBe(true);

    store.removeFromSyncList(IMAGES_FOLDER);

    expect(store.isSyncRunning).toBe(false);
  });

  // This is a SET keyed by path, not a counter, and the sync wrappers rely on
  // it: a childNeverUploaded retry emits a second sync:start for the same path,
  // and a single sync:end still has to clear the indicator. Turning this into a
  // counter would leave the indicator stuck on after every such retry.
  it('collapses a repeated add of the same path', () => {
    const store = useSyncStore();

    store.addToSyncList(CONTACTS_DB_FILE);
    store.addToSyncList(CONTACTS_DB_FILE);
    store.removeFromSyncList(CONTACTS_DB_FILE);

    expect(store.isSyncRunning).toBe(false);
    expect(store.inSynchronizationProcess.size).toBe(0);
  });

  it('ignores removal of a path it does not hold', () => {
    const store = useSyncStore();
    store.addToSyncList(CONTACTS_DB_FILE);

    store.removeFromSyncList('never-added');

    expect(store.isSyncRunning).toBe(true);
  });

  // sync:clean is the escape hatch for a run that ended without its closing
  // events — an aborted initial sync leaves paths behind, and without this the
  // indicator would spin for the rest of the session.
  it('clears everything at once', () => {
    const store = useSyncStore();
    store.addToSyncList(CONTACTS_DB_FILE);
    store.addToSyncList(IMAGES_FOLDER);

    store.cleanSyncList();

    expect(store.isSyncRunning).toBe(false);
    expect(store.inSynchronizationProcess.size).toBe(0);
  });

  it('can be cleared when already empty', () => {
    const store = useSyncStore();

    store.cleanSyncList();

    expect(store.isSyncRunning).toBe(false);
  });

});
