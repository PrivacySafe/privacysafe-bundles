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
import { prepareSyncedRoot } from '@deno/utils/prepare-synced-root.ts';
import { connectException, makeEventCollector, makeFakeFs } from '../../helpers/fake-fs.ts';
import { installFakeW3n } from '../../helpers/fake-w3n.ts';

let w3n: ReturnType<typeof installFakeW3n>;

beforeEach(() => {
  w3n = installFakeW3n();
});

afterEach(() => {
  w3n.uninstall();
  vi.restoreAllMocks();
});

describe('prepareSyncedRoot', () => {

  it('treats a storage without the sync api as nothing to reconcile', async () => {
    const { fs } = makeFakeFs();
    (fs as unknown as { v: undefined }).v = undefined;

    const state = await prepareSyncedRoot({ fs, emitStorageEvent: () => undefined });

    expect(state).toEqual({ verified: true, holdUploads: false, conflict: false });
  });

  // The whole point of the hold: offline, the app cannot tell whether the
  // server already has a contacts-db, so publishing the local one would create
  // a second object under the same name.
  it('holds uploads when the server cannot be reached', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.status.mockRejectedValue(connectException());

    const state = await prepareSyncedRoot({ fs, emitStorageEvent: collector.emitStorageEvent });

    expect(state).toEqual({ verified: false, holdUploads: true, conflict: false });
    expect(sync.upload).not.toHaveBeenCalled();
    expect(sync.startUpload).not.toHaveBeenCalled();
    expect(sync.adoptRemote).not.toHaveBeenCalled();
    expect(w3n.w3n.log).toHaveBeenCalledWith('info', expect.stringContaining('offline'));
  });

  // The caller retries this in a loop, and one identical line per attempt
  // buries everything else - eleven of them in six minutes was the live test of
  // 2026-08-22.
  it('says nothing about being offline when asked to be quiet', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockRejectedValue(connectException());

    const state = await prepareSyncedRoot({
      fs,
      emitStorageEvent: () => undefined,
      quiet: true,
    });

    expect(state).toEqual({ verified: false, holdUploads: true, conflict: false });
    expect(w3n.w3n.log).not.toHaveBeenCalled();
  });

  // Quiet is about the expected offline case only: anything else is a defect
  // and stays in the log however often it is retried.
  it('still reports an unexpected failure when quiet', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockRejectedValue(new Error('boom'));

    await prepareSyncedRoot({ fs, emitStorageEvent: () => undefined, quiet: true });

    expect(w3n.w3n.log).toHaveBeenCalledWith('error', expect.any(String), expect.any(Error));
  });

  it('holds uploads when the status cannot be read for any other reason', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockRejectedValue(new Error('boom'));

    const state = await prepareSyncedRoot({ fs, emitStorageEvent: () => undefined });

    expect(state).toEqual({ verified: false, holdUploads: true, conflict: false });
    expect(w3n.w3n.log).toHaveBeenCalledWith('error', expect.any(String), expect.any(Error));
  });

  it('adopts the remote version when the root is behind', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue({ state: 'behind', remote: { latest: 4 } });

    const state = await prepareSyncedRoot({ fs, emitStorageEvent: () => undefined });

    expect(sync.adoptRemote).toHaveBeenCalledWith('', { remoteVersion: 4 });
    expect(state).toEqual({ verified: true, holdUploads: false, conflict: false });
  });

  it('reports a conflicting root back when no resolver is given', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue({ state: 'conflicting', remote: { latest: 6 } });

    const state = await prepareSyncedRoot({ fs, emitStorageEvent: () => undefined });

    expect(state).toEqual({ verified: false, holdUploads: true, conflict: true });
    // Nothing is adopted: adoptRemote('') here would drop the local db.
    expect(sync.adoptRemote).not.toHaveBeenCalled();
    expect(sync.upload).not.toHaveBeenCalled();
  });

  it('calls the given resolver for a conflicting root', async () => {
    const { fs, sync } = makeFakeFs();
    const resolveConflict = vi.fn(async () => undefined);
    sync.status.mockResolvedValue({ state: 'conflicting', remote: { latest: 6 } });

    const state = await prepareSyncedRoot({
      fs,
      emitStorageEvent: () => undefined,
      resolveConflict,
    });

    expect(resolveConflict).toHaveBeenCalledOnce();
    expect(state).toEqual({ verified: true, holdUploads: false, conflict: false });
  });

  it('leaves a synced root alone', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue({ state: 'synced', synced: { latest: 2 } });

    const state = await prepareSyncedRoot({ fs, emitStorageEvent: () => undefined });

    expect(sync.adoptRemote).not.toHaveBeenCalled();
    expect(sync.upload).not.toHaveBeenCalled();
    expect(state).toEqual({ verified: true, holdUploads: false, conflict: false });
  });

  // An unsynced root is local-ahead, so its children already are the ones this
  // app knows about. Uploading it is handleRootFolderSyncStatus' job.
  it('leaves an unsynced root to the initial sync pass', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue({ state: 'unsynced' });

    const state = await prepareSyncedRoot({ fs, emitStorageEvent: () => undefined });

    expect(sync.upload).not.toHaveBeenCalled();
    expect(sync.startUpload).not.toHaveBeenCalled();
    expect(state).toEqual({ verified: true, holdUploads: false, conflict: false });
  });

});
