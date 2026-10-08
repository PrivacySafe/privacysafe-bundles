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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContactEventHandler } from '@main/common/composables/contact-event-handler';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from '@deno/constants';
import type { ContactEvent } from '@main/types';

function setup(over: Partial<Record<string, unknown>> = {}) {
  const deps = {
    addToSyncList: vi.fn(),
    removeFromSyncList: vi.fn(),
    cleanSyncList: vi.fn(),
    setSyncStuck: vi.fn(),
    emitContactListUpdated: vi.fn(),
    fetchContacts: vi.fn(async () => undefined),
    currentRouteName: vi.fn(() => 'contacts' as string | undefined),
    openContactId: vi.fn(() => undefined as string | undefined),
    listedContactIds: vi.fn(() => [] as string[]),
    goToContactList: vi.fn(async () => undefined),
    onBackupProgress: vi.fn(),
    onRestoreProgress: vi.fn(),
    ...over,
  };
  return { deps, handle: makeContactEventHandler(deps as never) };
}

describe('contact event handler', () => {

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sync:start', () => {

    it('adds the reported path to the sync list', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:start', payload: { path: IMAGES_FOLDER } } as ContactEvent);

      expect(deps.addToSyncList).toHaveBeenCalledWith(IMAGES_FOLDER);
    });

    // The synced FS root arrives as an empty path; it has to become a stable
    // key, or the matching sync:end could never remove it.
    it('maps the empty root path to "root"', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:start', payload: { path: '' } } as ContactEvent);

      expect(deps.addToSyncList).toHaveBeenCalledWith('root');
    });

  });

  describe('sync:end', () => {

    it('removes the reported path from the sync list', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:end', payload: { path: IMAGES_FOLDER } } as ContactEvent);

      expect(deps.removeFromSyncList).toHaveBeenCalledWith(IMAGES_FOLDER);
    });

    it('maps the empty root path to "root", matching sync:start', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:end', payload: { path: '' } } as ContactEvent);

      expect(deps.removeFromSyncList).toHaveBeenCalledWith('root');
    });

    // This is the path that keeps the visible list in step with the db file:
    // when the contacts db finishes syncing, the list must be re-read.
    it('refreshes the contact list when the db file finished syncing', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:end', payload: { path: CONTACTS_DB_FILE } } as ContactEvent);

      expect(deps.emitContactListUpdated).toHaveBeenCalled();
      expect(deps.fetchContacts).toHaveBeenCalled();
    });

    it('does not refresh the list for any other path', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:end', payload: { path: IMAGES_FOLDER } } as ContactEvent);

      expect(deps.emitContactListUpdated).not.toHaveBeenCalled();
      expect(deps.fetchContacts).not.toHaveBeenCalled();
    });

    it('awaits the refresh before returning', async () => {
      let finished = false;
      const { handle } = setup({
        fetchContacts: vi.fn(async () => {
          await Promise.resolve();
          finished = true;
        }),
      });

      await handle({ event: 'sync:end', payload: { path: CONTACTS_DB_FILE } } as ContactEvent);

      expect(finished).toBe(true);
    });

    it('still clears the path when the sync ended with an error', async () => {
      const { deps, handle } = setup();

      await handle({
        event: 'sync:end', payload: { path: IMAGES_FOLDER, error: 'offline' },
      } as ContactEvent);

      expect(deps.removeFromSyncList).toHaveBeenCalledWith(IMAGES_FOLDER);
    });

  });

  describe('sync:clean', () => {

    it('clears the whole sync list', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:clean', payload: { reason: 'init failed' } } as ContactEvent);

      expect(deps.cleanSyncList).toHaveBeenCalled();
    });

    it('tolerates a missing reason', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:clean', payload: {} } as ContactEvent);

      expect(deps.cleanSyncList).toHaveBeenCalled();
    });

  });

  // A STATE, unlike sync:clean above: the ui keeps a standing warning up until
  // it is told the trouble is over.
  describe('sync:stuck', () => {

    it('passes the stuck state on', async () => {
      const { deps, handle } = setup();

      await handle({
        event: 'sync:stuck',
        payload: { isStuck: true, reason: 'root-folder-not-verified' },
      } as ContactEvent);

      expect(deps.setSyncStuck).toHaveBeenCalledWith(true, 'root-folder-not-verified');
    });

    // The reason travels with the flag: the two stuck states need different
    // words, because only one of them clears itself.
    it('passes the reason on', async () => {
      const { deps, handle } = setup();

      await handle({
        event: 'sync:stuck',
        payload: { isStuck: true, reason: 'local-version-not-published' },
      } as ContactEvent);

      expect(deps.setSyncStuck).toHaveBeenCalledWith(true, 'local-version-not-published');
    });

    it('passes the recovery on', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:stuck', payload: { isStuck: false } } as ContactEvent);

      expect(deps.setSyncStuck).toHaveBeenCalledWith(false, undefined);
    });

    // The sync list is about paths being uploaded right now; a stuck session is
    // a different matter and must not clear it.
    it('leaves the sync list alone', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'sync:stuck', payload: { isStuck: true } } as ContactEvent);

      expect(deps.cleanSyncList).not.toHaveBeenCalled();
      expect(deps.fetchContacts).not.toHaveBeenCalled();
    });

  });

  describe('update:contact-list', () => {

    it('refreshes the list', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'update:contact-list' } as ContactEvent);

      expect(deps.fetchContacts).toHaveBeenCalled();
    });

    it('stays put while the contact list is on screen', async () => {
      const { deps, handle } = setup({ currentRouteName: vi.fn(() => 'contacts') });

      await handle({ event: 'update:contact-list' } as ContactEvent);

      expect(deps.goToContactList).not.toHaveBeenCalled();
    });

    it('stays on an open contact that still exists', async () => {
      const { deps, handle } = setup({
        currentRouteName: vi.fn(() => 'contact'),
        openContactId: vi.fn(() => 'a1'),
        listedContactIds: vi.fn(() => ['a1', 'b2']),
      });

      await handle({ event: 'update:contact-list' } as ContactEvent);

      expect(deps.goToContactList).not.toHaveBeenCalled();
    });

    // A contact deleted on another device disappears from the list underneath
    // an open card; without this redirect the user is left staring at a card
    // whose contact no longer exists.
    it('navigates away from an open contact that disappeared', async () => {
      const { deps, handle } = setup({
        currentRouteName: vi.fn(() => 'contact'),
        openContactId: vi.fn(() => 'gone'),
        listedContactIds: vi.fn(() => ['a1', 'b2']),
      });

      await handle({ event: 'update:contact-list' } as ContactEvent);

      expect(deps.goToContactList).toHaveBeenCalled();
    });

    it('refreshes the list before deciding whether to navigate away', async () => {
      const order: string[] = [];
      const { handle } = setup({
        fetchContacts: vi.fn(async () => { order.push('fetch'); }),
        currentRouteName: vi.fn(() => 'contact'),
        openContactId: vi.fn(() => 'gone'),
        listedContactIds: vi.fn(() => { order.push('read'); return []; }),
        goToContactList: vi.fn(async () => { order.push('navigate'); }),
      });

      await handle({ event: 'update:contact-list' } as ContactEvent);

      expect(order).toEqual(['fetch', 'read', 'navigate']);
    });

    // A brand-new contact route carries the 'new' placeholder id, which is
    // never in the list. Pinned to record that the handler DOES redirect in
    // that case, discarding a half-filled form if a sync lands mid-edit.
    it('also navigates away from the new-contact route', async () => {
      const { deps, handle } = setup({
        currentRouteName: vi.fn(() => 'contact'),
        openContactId: vi.fn(() => 'new'),
        listedContactIds: vi.fn(() => ['a1']),
      });

      await handle({ event: 'update:contact-list' } as ContactEvent);

      expect(deps.goToContactList).toHaveBeenCalled();
    });

  });

  describe('backup and restore progress', () => {

    // Progress events only move a progress bar. Refetching the list on them
    // would mean hundreds of refetches over one restore.
    it('passes backup progress on without refetching the list', async () => {
      const { deps, handle } = setup();
      const payload = {
        stage: 'compressing', totalFiles: 10, processedFiles: 3, percent: 30,
      };

      await handle({ event: 'backup', payload } as ContactEvent);

      expect(deps.onBackupProgress).toHaveBeenCalledWith(payload);
      expect(deps.fetchContacts).not.toHaveBeenCalled();
    });

    it('passes restore progress on without refetching the list', async () => {
      const { deps, handle } = setup();
      const payload = {
        stage: 'restoring-images', totalFiles: 4, processedFiles: 1, percent: 12,
      };

      await handle({ event: 'restore', payload } as ContactEvent);

      expect(deps.onRestoreProgress).toHaveBeenCalledWith(payload);
      expect(deps.fetchContacts).not.toHaveBeenCalled();
    });

    // A restore renumbers every contact, so the card the user had open is
    // almost certainly gone. It is update:contact-list, emitted once the table
    // has been swapped, that has to get them off it.
    it('leaves an open contact card on the update that follows a restore', async () => {
      const { deps, handle } = setup({
        currentRouteName: vi.fn(() => 'contact'),
        openContactId: vi.fn(() => 'old-id'),
        listedContactIds: vi.fn(() => ['fresh-id']),
      });

      await handle({ event: 'update:contact-list' } as ContactEvent);

      expect(deps.goToContactList).toHaveBeenCalled();
    });

  });

  describe('unhandled events', () => {

    // add/remove/update:contact are emitted by the service but deliberately
    // not acted on here — the list is refreshed via sync:end and
    // update:contact-list instead. They must be inert, not throw.
    it('ignores the per-contact events without touching anything', async () => {
      const { deps, handle } = setup();

      await handle({ event: 'add:contact', payload: { data: {} } } as ContactEvent);
      await handle({ event: 'remove:contact', payload: { id: 'a1' } } as ContactEvent);
      await handle({ event: 'update:contact', payload: { data: {} } } as ContactEvent);

      expect(deps.fetchContacts).not.toHaveBeenCalled();
      expect(deps.addToSyncList).not.toHaveBeenCalled();
      expect(deps.goToContactList).not.toHaveBeenCalled();
    });

  });

});
