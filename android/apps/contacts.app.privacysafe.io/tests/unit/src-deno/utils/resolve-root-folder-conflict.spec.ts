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

// The module reaches the sqlite bundle only to read the remote db file; mocking
// it keeps the ~1MB precompiled runtime out of the test.
const makeReadonly = vi.fn();
vi.mock('@shared/sqlite-on-3nstorage/index.js', () => ({
  SQLiteOn3NStorage: { makeReadonly },
}));

const { resolveRootFolderConflict, ensureUniqueContactIds } =
  await import('@deno/utils/resolve-root-folder-conflict.ts');
const { CONTACTS_DB_FILE, IMAGES_FOLDER } = await import('@deno/constants');
const {
  fileEntry, makeEventCollector, makeFakeFs, makeFakeRemoteFolder, scriptSyncStatuses,
} = await import('../../helpers/fake-fs.ts');
const { installFakeW3n } = await import('../../helpers/fake-w3n.ts');

import type { FakeFolderEntry } from '../../helpers/fake-fs.ts';
import type { RawPerson } from '@main/types';

const REMOTE_ROOT_VERSION = 6;

const contactColumns = [
  'id', 'mail', 'name', 'avatarId', 'timestamp', 'notice', 'phone', 'activities', 'settings',
];

interface Row { id: string; mail: string; name?: string | null; timestamp?: number }

function queryResult(rows: Row[]) {
  return [{
    columns: contactColumns,
    values: rows.map(r => [
      r.id, r.mail, r.name ?? null, null, r.timestamp ?? 1, null, null, null, null,
    ]),
  }];
}

/** Local sqlite handle: only db.exec, reloadDb and saveToFile are reached. */
function fakeSqlite(rows: Row[]) {
  return {
    db: { exec: vi.fn(() => queryResult(rows)) },
    reloadDb: vi.fn(async () => undefined),
    saveToFile: vi.fn(async () => undefined),
  };
}

function fakeContactDbSrv() {
  return { updateContactsTable: vi.fn(async () => true) };
}

interface ConflictSetup {
  localRows?: Row[];
  remoteRows?: Row[];
  diff?: unknown;
  rootState?: unknown;
  localImages?: FakeFolderEntry[];
  remoteImages?: FakeFolderEntry[];
  remoteImageTexts?: Record<string, string>;
}

/**
 * Scripts a root in a conflicting state whose remote branch carries both a
 * contacts-db and an images folder of its own - the name overlap two devices
 * produce when each created them without looking at the server.
 */
function setupConflict(over: ConflictSetup = {}) {
  const {
    localRows = [], remoteRows = [], localImages = [], remoteImages = [], remoteImageTexts = {},
    diff = { nameOverlaps: [CONTACTS_DB_FILE, IMAGES_FOLDER] },
    rootState = { state: 'conflicting', remote: { latest: REMOTE_ROOT_VERSION } },
  } = over;

  const fake = makeFakeFs({ [IMAGES_FOLDER]: localImages });
  scriptSyncStatuses(fake.sync, {
    '': rootState,
    // Both children are local-only objects, so they are `unsynced` and can be
    // uploaded without an explicit version.
    [CONTACTS_DB_FILE]: { state: 'unsynced' },
    [IMAGES_FOLDER]: { state: 'unsynced' },
  });
  fake.sync.diffCurrentAndRemoteFolderVersions.mockResolvedValue(diff);
  fake.sync.getRemoteFileItem.mockResolvedValue({
    readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  } as never);
  fake.sync.getRemoteFolderItem.mockResolvedValue(
    makeFakeRemoteFolder(remoteImages, remoteImageTexts) as never,
  );
  makeReadonly.mockResolvedValue({ db: { exec: vi.fn(() => queryResult(remoteRows)) } });

  const sqlite = fakeSqlite(localRows);
  const contactDbSrv = fakeContactDbSrv();
  const collector = makeEventCollector();

  return {
    ...fake,
    sqlite,
    contactDbSrv,
    collector,
    run: () => resolveRootFolderConflict({
      fs: fake.fs,
      sqlite: sqlite as never,
      contactDbSrv: contactDbSrv as never,
      emitStorageEvent: collector.emitStorageEvent,
    }),
  };
}

/** The contact list handed to updateContactsTable by the merge. */
function mergedList(contactDbSrv: ReturnType<typeof fakeContactDbSrv>): RawPerson[] {
  const [list] = contactDbSrv.updateContactsTable.mock.calls[0] as unknown as [RawPerson[]];
  return list;
}

let w3n: ReturnType<typeof installFakeW3n>;

beforeEach(() => {
  makeReadonly.mockReset();
  w3n = installFakeW3n();
});

afterEach(() => {
  w3n.uninstall();
  vi.restoreAllMocks();
});

describe('ensureUniqueContactIds', () => {

  it('leaves already unique ids alone', () => {
    const contacts = [
      { id: 'a', mail: 'ann@3nweb.com' }, { id: 'b', mail: 'bob@3nweb.com' },
    ] as RawPerson[];

    expect(ensureUniqueContactIds(contacts).map(c => c.id)).toEqual(['a', 'b']);
  });

  // insertContactInto throws contactAlreadyExists on a primary key clash, which
  // would fail the whole merge inside updateContactsTable.
  it('renumbers a repeated id, keeping the first occurrence', () => {
    const contacts = [
      { id: 'dup', mail: 'ann@3nweb.com' }, { id: 'dup', mail: 'bob@3nweb.com' },
    ] as RawPerson[];

    const ids = ensureUniqueContactIds(contacts).map(c => c.id);

    expect(ids[0]).toBe('dup');
    expect(ids[1]).not.toBe('dup');
    expect(new Set(ids).size).toBe(2);
  });

  it('does not mutate the given rows', () => {
    const contacts = [
      { id: 'dup', mail: 'ann@3nweb.com' }, { id: 'dup', mail: 'bob@3nweb.com' },
    ] as RawPerson[];

    ensureUniqueContactIds(contacts);

    expect(contacts.map(c => c.id)).toEqual(['dup', 'dup']);
  });

});

describe('resolveRootFolderConflict', () => {

  it('does nothing when the root is not conflicting', async () => {
    const t = setupConflict({ rootState: { state: 'synced', synced: { latest: 2 } } });

    await t.run();

    expect(t.sync.diffCurrentAndRemoteFolderVersions).not.toHaveBeenCalled();
    expect(t.sync.upload).not.toHaveBeenCalled();
    expect(t.collector.events).toEqual([]);
  });

  it('diffs against the remote version the status reports', async () => {
    const t = setupConflict();

    await t.run();

    expect(t.sync.diffCurrentAndRemoteFolderVersions)
      .toHaveBeenCalledWith('', REMOTE_ROOT_VERSION);
  });

  describe('the contacts db', () => {

    it('keeps every contact of both sides, without duplicating any mail', async () => {
      const t = setupConflict({
        localRows: [{ id: 'L1', mail: 'ann@3nweb.com' }],
        remoteRows: [{ id: 'R1', mail: 'bob@3nweb.com' }],
      });

      await t.run();

      const list = mergedList(t.contactDbSrv);
      expect(list.map(c => c.mail).sort()).toEqual(['ann@3nweb.com', 'bob@3nweb.com']);
      expect(new Set(list.map(c => c.mail)).size).toBe(list.length);
    });

    it('reads the remote db out of the root\'s remote version', async () => {
      const t = setupConflict();

      await t.run();

      expect(t.sync.getRemoteFileItem)
        .toHaveBeenCalledWith('', CONTACTS_DB_FILE, REMOTE_ROOT_VERSION);
    });

    // Two devices can pick the same randomStr(8) for different contacts.
    it('survives an id shared by a local and a remote-only contact', async () => {
      const t = setupConflict({
        localRows: [{ id: 'dup', mail: 'ann@3nweb.com' }],
        remoteRows: [{ id: 'dup', mail: 'bob@3nweb.com' }],
      });

      await t.run();

      const list = mergedList(t.contactDbSrv);
      expect(list).toHaveLength(2);
      expect(new Set(list.map(c => c.id)).size).toBe(2);
      // The local row is the one that keeps its id.
      expect(list.find(c => c.mail === 'ann@3nweb.com')!.id).toBe('dup');
    });

    // The flag makes updateContactsTable save the file once, at its last insert,
    // instead of after every single one.
    it('asks for a single save of the merged table', async () => {
      const t = setupConflict({ localRows: [{ id: 'L1', mail: 'ann@3nweb.com' }] });

      await t.run();

      expect(t.contactDbSrv.updateContactsTable)
        .toHaveBeenCalledWith(expect.any(Array), true);
    });

    it('reloads the db from file after the merge', async () => {
      const t = setupConflict({ localRows: [{ id: 'L1', mail: 'ann@3nweb.com' }] });

      await t.run();

      expect(t.sqlite.reloadDb).toHaveBeenCalled();
      expect(t.sqlite.reloadDb.mock.invocationCallOrder[0])
        .toBeGreaterThan(t.contactDbSrv.updateContactsTable.mock.invocationCallOrder[0]);
    });

    // An empty list gives updateContactsTable no insert to save on, so the
    // dropped table would stay unsaved and reloadDb would undo the merge.
    it('saves the file itself when the merged list is empty', async () => {
      const t = setupConflict();

      await t.run();

      expect(t.sqlite.saveToFile).toHaveBeenCalledWith({ skipUpload: true });
      expect(t.sqlite.saveToFile.mock.invocationCallOrder[0])
        .toBeLessThan(t.sqlite.reloadDb.mock.invocationCallOrder[0]);
    });

    it('is left alone when the remote branch has no db of its own', async () => {
      const t = setupConflict({ diff: { nameOverlaps: [IMAGES_FOLDER] } });

      await t.run();

      expect(t.sync.getRemoteFileItem).not.toHaveBeenCalled();
      expect(t.contactDbSrv.updateContactsTable).not.toHaveBeenCalled();
      expect(t.sqlite.reloadDb).not.toHaveBeenCalled();
    });

    it('merges a db the remote branch added rather than overlapped', async () => {
      const t = setupConflict({
        diff: { added: { inRemote: [CONTACTS_DB_FILE] } },
        remoteRows: [{ id: 'R1', mail: 'bob@3nweb.com' }],
      });

      await t.run();

      expect(mergedList(t.contactDbSrv).map(c => c.mail)).toEqual(['bob@3nweb.com']);
    });

  });

  describe('the images folder', () => {

    it('copies over the avatars only the remote branch has', async () => {
      const t = setupConflict({
        localImages: [fileEntry('local-av')],
        remoteImages: [fileEntry('local-av'), fileEntry('remote-av')],
        remoteImageTexts: { 'remote-av': 'BASE64-REMOTE', 'local-av': 'BASE64-OTHER' },
      });

      await t.run();

      // The local file of an overlapping name is kept: avatar names are random,
      // so the same name means the same file.
      expect(t.fsCalls.writeTxtFile).toHaveBeenCalledTimes(1);
      expect(t.fsCalls.writeTxtFile)
        .toHaveBeenCalledWith(`${IMAGES_FOLDER}/remote-av`, 'BASE64-REMOTE');
    });

    it('reads the folder out of the root\'s remote version', async () => {
      const t = setupConflict();

      await t.run();

      expect(t.sync.getRemoteFolderItem)
        .toHaveBeenCalledWith('', IMAGES_FOLDER, REMOTE_ROOT_VERSION);
    });

    it('carries on when one remote avatar cannot be read', async () => {
      const t = setupConflict({
        remoteImages: [fileEntry('bad'), fileEntry('good')],
        remoteImageTexts: { good: 'BASE64-GOOD' },
      });
      const remoteFolder = await t.sync.getRemoteFolderItem('', IMAGES_FOLDER);
      (remoteFolder.readTxtFile as ReturnType<typeof vi.fn>)
        .mockImplementation(async (name: string) => {
          if (name === 'bad') {
            throw new Error('cannot read');
          }
          return 'BASE64-GOOD';
        });

      await t.run();

      expect(t.fsCalls.writeTxtFile)
        .toHaveBeenCalledWith(`${IMAGES_FOLDER}/good`, 'BASE64-GOOD');
      expect(w3n.w3n.log)
        .toHaveBeenCalledWith('warning', expect.stringContaining('bad'), expect.any(Error));
    });

    it('is left alone when the remote branch has no folder of its own', async () => {
      const t = setupConflict({ diff: { nameOverlaps: [CONTACTS_DB_FILE] } });

      await t.run();

      expect(t.sync.getRemoteFolderItem).not.toHaveBeenCalled();
      expect(t.fsCalls.writeTxtFile).not.toHaveBeenCalled();
    });

  });

  describe('publication', () => {

    // A folder whose child was never uploaded is refused with
    // fs-sync/childNeverUploaded, so the order here is not a preference.
    it('uploads both children before the root', async () => {
      const t = setupConflict();

      await t.run();

      expect(t.sync.upload.mock.calls).toEqual([
        [CONTACTS_DB_FILE, undefined],
        [IMAGES_FOLDER, undefined],
        ['', { uploadVersion: REMOTE_ROOT_VERSION + 1 }],
      ]);
    });

    // Without an explicit version syncUpload declines a conflicting path
    // silently, and the conflict would simply stay.
    it('publishes the root at the remote version plus one', async () => {
      const t = setupConflict();

      await t.run();

      expect(t.sync.upload).toHaveBeenLastCalledWith('', { uploadVersion: 7 });
    });

  });

  describe('reporting', () => {

    it('emits paired sync:start and sync:end for the root', async () => {
      const t = setupConflict();

      await t.run();

      const rootStarts = t.collector.pathsOf('sync:start').filter(p => p === 'root');
      const rootEnds = t.collector.pathsOf('sync:end').filter(p => p === 'root');
      expect(rootStarts.length).toBe(rootEnds.length);
      expect(rootStarts.length).toBeGreaterThan(0);
      expect(t.collector.names()[0]).toBe('sync:start');
    });

    it('asks the ui to reread the contact list', async () => {
      const t = setupConflict({ localRows: [{ id: 'L1', mail: 'ann@3nweb.com' }] });

      await t.run();

      expect(t.collector.names()).toContain('update:contact-list');
    });

    it('closes the root sync indicator even when the merge fails', async () => {
      const t = setupConflict();
      t.sync.getRemoteFileItem.mockRejectedValue(new Error('boom'));

      await expect(t.run()).rejects.toThrow('boom');

      expect(t.collector.pathsOf('sync:end')).toContain('root');
      expect(t.collector.names()).not.toContain('update:contact-list');
    });

    it('warns about a diff shape it does not act on', async () => {
      const t = setupConflict({
        diff: { nameOverlaps: [CONTACTS_DB_FILE], removed: { inRemote: [IMAGES_FOLDER] } },
      });

      await t.run();

      expect(w3n.w3n.log).toHaveBeenCalledWith(
        'warning', 'Unexpected shape of root folder conflict', expect.any(Object),
      );
    });

    it('does not warn about the shape this app produces', async () => {
      const t = setupConflict();

      await t.run();

      expect(w3n.w3n.log).not.toHaveBeenCalledWith(
        'warning', 'Unexpected shape of root folder conflict', expect.anything(),
      );
    });

    it('reports a conflicting root without a diff', async () => {
      const t = setupConflict();
      t.sync.diffCurrentAndRemoteFolderVersions.mockResolvedValue(undefined as never);

      await t.run();

      expect(w3n.w3n.log).toHaveBeenCalledWith('warning', expect.stringContaining('no diff'));
      expect(t.sync.upload).not.toHaveBeenCalled();
      expect(t.collector.pathsOf('sync:end')).toContain('root');
    });

  });

});
