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
import { handleRootFolderSyncStatus } from '@deno/utils/handle-root-folder-sync-status.ts';
import { makeEventCollector, makeFakeFs } from '../../helpers/fake-fs.ts';

const sqlite = {} as never;
const contactDbSrv = {} as never;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleRootFolderSyncStatus', () => {

  it('does nothing when the platform reports no status', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue(undefined);

    await handleRootFolderSyncStatus({
      fs,
      sqlite,
      contactDbSrv,
      emitStorageEvent: () => undefined,
    });

    expect(sync.upload).not.toHaveBeenCalled();
    expect(sync.adoptRemote).not.toHaveBeenCalled();
  });

  it('uploads the root immediately when it is unsynced', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.status.mockResolvedValue({ state: 'unsynced' });

    await handleRootFolderSyncStatus({
      fs,
      sqlite,
      contactDbSrv,
      emitStorageEvent: collector.emitStorageEvent,
    });

    expect(sync.upload).toHaveBeenCalledWith('', undefined);
    // The empty root path is reported as 'root' in the sync indicator.
    expect(collector.pathsOf('sync:start')).toEqual(['root']);
    expect(collector.pathsOf('sync:end')).toEqual(['root']);
  });

  it('adopts the remote root version when behind', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue({ state: 'behind', remote: { latest: 4 } });

    await handleRootFolderSyncStatus({
      fs,
      sqlite,
      contactDbSrv,
      emitStorageEvent: () => undefined,
    });

    expect(sync.adoptRemote).toHaveBeenCalledWith('', { remoteVersion: 4 });
  });

  // A conflicting root used to be diffed and logged only, leaving the conflict
  // in place forever. It is now handed to resolveRootFolderConflict, whose own
  // behaviour is covered in resolve-root-folder-conflict.spec.ts.
  it('resolves a conflicting root instead of only logging it', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.diffCurrentAndRemoteFolderVersions.mockResolvedValue({});
    sync.status.mockResolvedValue({ state: 'conflicting', remote: { latest: 6 } });

    await handleRootFolderSyncStatus({
      fs,
      sqlite,
      contactDbSrv,
      emitStorageEvent: collector.emitStorageEvent,
    });

    expect(sync.diffCurrentAndRemoteFolderVersions).toHaveBeenCalledWith('', 6);
    // The local branch is published over the remote one; adopting it would
    // discard the local contacts db.
    expect(sync.adoptRemote).not.toHaveBeenCalled();
    expect(sync.upload).toHaveBeenCalledWith('', { uploadVersion: 7 });
    expect(collector.pathsOf('sync:start')).toContain('root');
    expect(collector.pathsOf('sync:end')).toContain('root');
  });

  it('leaves a synced root alone', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue({ state: 'synced', synced: { latest: 2 } });

    await handleRootFolderSyncStatus({
      fs,
      sqlite,
      contactDbSrv,
      emitStorageEvent: () => undefined,
    });

    expect(sync.upload).not.toHaveBeenCalled();
    expect(sync.adoptRemote).not.toHaveBeenCalled();
  });

});
