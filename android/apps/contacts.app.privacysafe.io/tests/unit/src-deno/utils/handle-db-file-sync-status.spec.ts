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

// The module under test reaches the sqlite bundle only to read the remote
// db file; mocking it keeps the ~1MB precompiled runtime out of the test.
const makeReadonly = vi.fn();
vi.mock('@shared/sqlite-on-3nstorage/index.js', () => ({
  SQLiteOn3NStorage: { makeReadonly },
}));

const { handleDbFileSyncStatus } = await import('@deno/utils/handle-db-file-sync-status.ts');
const { CONTACTS_DB_FILE } = await import('@deno/constants');
const { makeEventCollector, makeFakeFs, connectException } =
  await import('../../helpers/fake-fs.ts');

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

/** Local sqlite handle: only db.exec and reloadDb are reached. */
function fakeSqlite(localRows: Row[]) {
  return {
    db: { exec: vi.fn(() => queryResult(localRows)) },
    reloadDb: vi.fn(async () => undefined),
  };
}

function fakeContactDbSrv() {
  return { updateContactsTable: vi.fn(async () => true) };
}

/** Points the mocked sqlite reader at the given remote rows. */
function scriptRemoteRows(rows: Row[]) {
  makeReadonly.mockResolvedValue({ db: { exec: vi.fn(() => queryResult(rows)) } });
}

function conflictingStatus(latest = 5) {
  return { state: 'conflicting', remote: { latest } };
}

beforeEach(() => {
  makeReadonly.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleDbFileSyncStatus', () => {

  it('does nothing when the platform reports no status', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.status.mockResolvedValue(undefined);

    await handleDbFileSyncStatus({
      fs,
      sqlite: fakeSqlite([]) as never,
      contactDbSrv: fakeContactDbSrv() as never,
      emitStorageEvent: collector.emitStorageEvent,
    });

    expect(sync.startUpload).not.toHaveBeenCalled();
    expect(sync.adoptRemote).not.toHaveBeenCalled();
    expect(collector.events).toEqual([]);
  });

  describe('unsynced', () => {

    it('uploads the local version', async () => {
      const { fs, sync } = makeFakeFs();
      sync.status.mockResolvedValue({ state: 'unsynced' });

      await handleDbFileSyncStatus({
        fs,
        sqlite: fakeSqlite([]) as never,
        contactDbSrv: fakeContactDbSrv() as never,
        emitStorageEvent: () => undefined,
      });

      expect(sync.startUpload).toHaveBeenCalledWith(CONTACTS_DB_FILE, undefined);
      expect(sync.adoptRemote).not.toHaveBeenCalled();
    });

    it('tolerates being offline', async () => {
      const { fs, sync } = makeFakeFs();
      sync.status.mockResolvedValue({ state: 'unsynced' });
      sync.startUpload.mockImplementation(() => {
        throw connectException();
      });

      await expect(handleDbFileSyncStatus({
        fs,
        sqlite: fakeSqlite([]) as never,
        contactDbSrv: fakeContactDbSrv() as never,
        emitStorageEvent: () => undefined,
      })).resolves.toBeUndefined();
    });

  });

  describe('behind', () => {

    it('adopts the remote version, reloads the db and announces the new list', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([]);
      const collector = makeEventCollector();
      sync.status.mockResolvedValue({ state: 'behind', remote: { latest: 8 } });
      sync.isRemoteVersionOnDisk.mockResolvedValue('complete');

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: fakeContactDbSrv() as never,
        emitStorageEvent: collector.emitStorageEvent,
      });

      expect(sync.adoptRemote).toHaveBeenCalledWith(CONTACTS_DB_FILE, { remoteVersion: 8 });
      expect(sync.startDownload).not.toHaveBeenCalled();
      expect(sqlite.reloadDb).toHaveBeenCalled();
      expect(collector.names()).toContain('update:contact-list');
    });

    // reloadDb reads the file off disk, so the bytes have to be there first.
    it('downloads the remote version when its bytes are not on disk', async () => {
      const { fs, sync } = makeFakeFs();
      sync.status.mockResolvedValue({ state: 'behind', remote: { latest: 8 } });
      sync.isRemoteVersionOnDisk.mockResolvedValue('none');

      await handleDbFileSyncStatus({
        fs,
        sqlite: fakeSqlite([]) as never,
        contactDbSrv: fakeContactDbSrv() as never,
        emitStorageEvent: () => undefined,
      });

      expect(sync.startDownload).toHaveBeenCalledWith(CONTACTS_DB_FILE, 8);
    });

  });

  describe('conflicting', () => {

    it('adopts remote and reloads when the merge found nothing new', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([{ id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 }]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValue(conflictingStatus(5));
      scriptRemoteRows([{ id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 }]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      expect(contactDbSrv.updateContactsTable).not.toHaveBeenCalled();
      expect(sync.adoptRemote).toHaveBeenCalledWith(CONTACTS_DB_FILE, { remoteVersion: 5 });
      expect(sqlite.reloadDb).toHaveBeenCalled();
    });

    it('adopts and reloads without rewriting when only the remote moved', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([{ id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 }]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValue(conflictingStatus(5));
      scriptRemoteRows([
        { id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 },
        { id: 'c2', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 6 },
      ]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      expect(sync.adoptRemote).toHaveBeenCalledWith(CONTACTS_DB_FILE, { remoteVersion: 5 });
      expect(sqlite.reloadDb).toHaveBeenCalled();
      expect(contactDbSrv.updateContactsTable).not.toHaveBeenCalled();
      expect(sync.startUpload).not.toHaveBeenCalled();
    });

    // THE invariant, and the reason this branch does not adopt: adoptRemote
    // drops the local branch outright, leaving the merge in memory only. The
    // live test of 2026-09-13 adopted first and then could not write the merge
    // back - the platform refused the version number as already used - and the
    // contact created offline was gone from disk.
    it('never adopts while this device holds rows the remote lacks', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([
        { id: 'c1', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 5 },
        { id: 'c2', mail: 'cid@3nweb.com', name: 'Cid', timestamp: 7 },
      ]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValue(conflictingStatus(21));
      scriptRemoteRows([{ id: 'c1', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 5 }]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      expect(sync.adoptRemote).not.toHaveBeenCalled();
      expect(sqlite.reloadDb).not.toHaveBeenCalled();
    });

    // While an upload cannot get through, the watchdog runs this pass once a
    // minute. Rewriting the table each time wrote an identical new local
    // version every minute: in the live test of 2026-09-14 the local version
    // went from 9 to 41 in half an hour.
    it('does not rewrite the table when the remote brought nothing', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([
        { id: 'c1', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 5 },
        { id: 'c2', mail: 'cid@3nweb.com', name: 'Cid', timestamp: 7 },
      ]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValue(conflictingStatus(21));
      scriptRemoteRows([{ id: 'c1', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 5 }]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      expect(contactDbSrv.updateContactsTable).not.toHaveBeenCalled();
      // The publishing attempt still happens - that is the point of the pass.
      expect(sync.startUpload).toHaveBeenCalledWith(CONTACTS_DB_FILE, { uploadVersion: 22 });
    });

    // An unpaired sync:start has no closer of its own, and the 'upload-done'
    // that would have closed it never arrives while the upload is blocked. The
    // watchdog then re-opened it every minute and the progress bar ran for the
    // rest of the session.
    it('opens no sync indicator of its own', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      const sqlite = fakeSqlite([
        { id: 'c1', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 5 },
        { id: 'c2', mail: 'cid@3nweb.com', name: 'Cid', timestamp: 7 },
      ]);
      sync.status.mockResolvedValue(conflictingStatus(21));
      scriptRemoteRows([{ id: 'c1', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 5 }]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: fakeContactDbSrv() as never,
        emitStorageEvent: collector.emitStorageEvent,
      });

      // Exactly one sync:start, and it is syncUpload's own - which the upload's
      // completion closes.
      expect(collector.names().filter(n => n === 'sync:start')).toHaveLength(1);
    });

    // The merge goes into the local branch first, where it is durable, and is
    // published from there. Writing at latest+1 is what makes it win over the
    // remote version that caused the conflict.
    it('writes the merge locally and publishes it past the remote version', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([{ id: 'c2', mail: 'cid@3nweb.com', name: 'Cid', timestamp: 7 }]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValue(conflictingStatus(21));
      scriptRemoteRows([{ id: 'c3', mail: 'dan@3nweb.com', name: 'Dan', timestamp: 8 }]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      expect(contactDbSrv.updateContactsTable.mock.invocationCallOrder[0])
      .toBeLessThan(sync.startUpload.mock.invocationCallOrder[0]);
      expect(sync.startUpload).toHaveBeenCalledWith(CONTACTS_DB_FILE, { uploadVersion: 22 });
    });

    // The loss this guards against: a contact created offline on THIS device,
    // while the other device published a version of its own. The remote brings
    // nothing new, so the merge reports no differences - and adopting the
    // remote version without writing the merge back replaces the table with
    // the server's, taking the local row with it. Seen for real in the live
    // test of 2026-09-13.
    it('writes back the rows only this device has', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([
        { id: 'c1', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 5 },
        { id: 'c2', mail: 'cid@3nweb.com', name: 'Cid', timestamp: 7 },
      ]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValue(conflictingStatus(21));
      // The remote brings a row of its own, so the table is rewritten from the
      // merge - and the local-only row has to survive that rewrite.
      scriptRemoteRows([
        { id: 'c1', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 5 },
        { id: 'c3', mail: 'dan@3nweb.com', name: 'Dan', timestamp: 8 },
      ]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      const [resolvedList, withoutSaveToFile] =
        contactDbSrv.updateContactsTable.mock.calls[0] as unknown as [{ mail: string }[], boolean];
      expect(resolvedList.map(c => c.mail).sort())
      .toEqual(['bob@3nweb.com', 'cid@3nweb.com', 'dan@3nweb.com']);
      // One save for the whole merge: insertContactInto saves the file after
      // EVERY row otherwise, which wrote a local version per contact and ran
      // the version numbers far ahead of the server's.
      expect(withoutSaveToFile).toBe(true);
    });

    // Both devices added a contact offline: the merge has to be written locally
    // AND published, and neither row may be dropped.
    it('keeps both sides when each added a contact of its own', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([{ id: 'c2', mail: 'cid@3nweb.com', name: 'Cid', timestamp: 7 }]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValue(conflictingStatus(21));
      scriptRemoteRows([{ id: 'c3', mail: 'dan@3nweb.com', name: 'Dan', timestamp: 8 }]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      const [resolvedList] = contactDbSrv.updateContactsTable.mock.calls[0] as unknown as [
        { mail: string }[],
      ];
      expect(resolvedList.map(c => c.mail).sort())
      .toEqual(['cid@3nweb.com', 'dan@3nweb.com']);
      expect(sync.startUpload).toHaveBeenCalledWith(CONTACTS_DB_FILE, { uploadVersion: 22 });
      expect(sync.adoptRemote).not.toHaveBeenCalled();
    });

    // Regression guard for the row normalisation feeding the merge: with a
    // `for...in` over Object.keys() every field came through as undefined, so
    // updateContactsTable was handed rows with numeric keys and the whole
    // conflict path silently rebuilt the table from garbage.
    it('hands updateContactsTable rows with real contact fields', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([
        { id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 },
        { id: 'c3', mail: 'zed@3nweb.com', name: 'Zed', timestamp: 7 },
      ]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValueOnce(conflictingStatus(5) as never);
      sync.status.mockResolvedValue({ state: 'unsynced' } as never);
      scriptRemoteRows([
        { id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 },
        { id: 'c2', mail: 'bob@3nweb.com', name: 'Bob', timestamp: 6 },
      ]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      const [resolvedList] = contactDbSrv.updateContactsTable.mock.calls[0] as unknown as [
        { id: string; mail: string; name?: string }[],
      ];
      expect(resolvedList.map(c => c.mail).sort())
      .toEqual(['ann@3nweb.com', 'bob@3nweb.com', 'zed@3nweb.com']);
      expect(resolvedList.every(c => Object.keys(c).every(k => !/^\d+$/.test(k)))).toBe(true);
      expect(resolvedList.find(c => c.mail === 'bob@3nweb.com')!.name).toBe('Bob');
    });

    // Two devices working offline can hand the same randomStr(8) to different
    // contacts; inserting the clashing row throws contactAlreadyExists and
    // loses the whole merge.
    it('renumbers a remote row whose id clashes with a local one', async () => {
      const { fs, sync } = makeFakeFs();
      const sqlite = fakeSqlite([{ id: 'same', mail: 'cid@3nweb.com', name: 'Cid', timestamp: 7 }]);
      const contactDbSrv = fakeContactDbSrv();
      sync.status.mockResolvedValueOnce(conflictingStatus(21) as never);
      sync.status.mockResolvedValue({ state: 'unsynced' } as never);
      scriptRemoteRows([{ id: 'same', mail: 'dan@3nweb.com', name: 'Dan', timestamp: 8 }]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: sqlite as never,
        contactDbSrv: contactDbSrv as never,
        emitStorageEvent: () => undefined,
      });

      const [resolvedList] = contactDbSrv.updateContactsTable.mock.calls[0] as unknown as [
        { id: string; mail: string }[],
      ];
      expect(new Set(resolvedList.map(c => c.id)).size).toBe(2);
      // The local row is the one that keeps its id.
      expect(resolvedList.find(c => c.mail === 'cid@3nweb.com')!.id).toBe('same');
    });

    it('reads the remote db bytes at the conflicting remote version', async () => {
      const { fs, sync, v } = makeFakeFs();
      sync.status.mockResolvedValue(conflictingStatus(11));
      scriptRemoteRows([]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: fakeSqlite([]) as never,
        contactDbSrv: fakeContactDbSrv() as never,
        emitStorageEvent: () => undefined,
      });

      expect(v.readBytes).toHaveBeenCalledWith(
        CONTACTS_DB_FILE, undefined, undefined, { remoteVersion: 11 },
      );
    });

    it('announces the new list either way', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      sync.status.mockResolvedValue(conflictingStatus(5));
      scriptRemoteRows([]);

      await handleDbFileSyncStatus({
        fs,
        sqlite: fakeSqlite([]) as never,
        contactDbSrv: fakeContactDbSrv() as never,
        emitStorageEvent: collector.emitStorageEvent,
      });

      expect(collector.names()).toContain('update:contact-list');
    });

  });

  it('leaves a synced file alone', async () => {
    const { fs, sync } = makeFakeFs();
    const sqlite = fakeSqlite([]);
    const collector = makeEventCollector();
    sync.status.mockResolvedValue({ state: 'synced', synced: { latest: 3 } });

    await handleDbFileSyncStatus({
      fs,
      sqlite: sqlite as never,
      contactDbSrv: fakeContactDbSrv() as never,
      emitStorageEvent: collector.emitStorageEvent,
    });

    expect(sync.startUpload).not.toHaveBeenCalled();
    expect(sync.adoptRemote).not.toHaveBeenCalled();
    expect(sqlite.reloadDb).not.toHaveBeenCalled();
    expect(collector.events).toEqual([]);
  });

});
