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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleImagesFolderSyncStatus } from '@deno/utils/handle-images-folder-sync-status.ts';
import { IMAGES_FOLDER } from '@deno/constants';
import {
  fileEntry,
  makeEventCollector,
  makeFakeFs,
  scriptSyncStatuses as scriptStatuses,
} from '../../helpers/fake-fs.ts';

const imgPath = (name: string) => `${IMAGES_FOLDER}/${name}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleImagesFolderSyncStatus', () => {

  it('does nothing when the platform reports no status for the folder', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    scriptStatuses(sync, {});

    await handleImagesFolderSyncStatus({ fs, emitStorageEvent: collector.emitStorageEvent });

    expect(sync.upload).not.toHaveBeenCalled();
    expect(sync.adoptRemote).not.toHaveBeenCalled();
    expect(collector.events).toEqual([]);
  });

  describe('unsynced folder', () => {

    it('uploads a locally-changed file and then the folder itself', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'unsynced' },
        [imgPath('av1')]: { state: 'unsynced' },
      });

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.startUpload).toHaveBeenCalledWith(imgPath('av1'), undefined);
      // The folder upload is the immediate one, so the caller can rely on it
      // having actually happened when this resolves.
      expect(sync.upload).toHaveBeenCalledWith(IMAGES_FOLDER, undefined);
    });

    it('adopts and downloads a file that is behind', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'unsynced' },
        [imgPath('av1')]: { state: 'behind', remote: { latest: 4 } },
      });

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.adoptRemote).toHaveBeenCalledWith(imgPath('av1'), { remoteVersion: 4 });
      expect(sync.startDownload).toHaveBeenCalledWith(imgPath('av1'), 4);
    });

    // Re-downloading bytes already on disk would waste the whole images folder
    // worth of traffic on every start, so the on-disk check gates it.
    it('skips the download of a synced file whose bytes are already on disk', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'unsynced' },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 2 } },
      });
      sync.isRemoteVersionOnDisk.mockResolvedValue('complete');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.startDownload).not.toHaveBeenCalled();
    });

    it('downloads a synced file whose bytes are missing locally', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'unsynced' },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 2 } },
      });
      sync.isRemoteVersionOnDisk.mockResolvedValue('none');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.startDownload).toHaveBeenCalledWith(imgPath('av1'), 2);
    });

    it('skips files the platform reports no status for, still uploading the folder', async () => {
      const { fs, sync } = makeFakeFs({
        [IMAGES_FOLDER]: [fileEntry('av1'), fileEntry('av2')],
      });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'unsynced' },
        [imgPath('av2')]: { state: 'unsynced' },
      });

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.startUpload).toHaveBeenCalledTimes(1);
      expect(sync.startUpload).toHaveBeenCalledWith(imgPath('av2'), undefined);
      expect(sync.upload).toHaveBeenCalledWith(IMAGES_FOLDER, undefined);
    });

  });

  describe('folder behind remote', () => {

    it('adopts the remote folder version and then fills in missing files', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'behind', remote: { latest: 7 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.isRemoteVersionOnDisk.mockResolvedValue('none');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.adoptRemote).toHaveBeenCalledWith(IMAGES_FOLDER, { remoteVersion: 7 });
      expect(sync.startDownload).toHaveBeenCalledWith(imgPath('av1'), 3);
    });

    // The fill-in runs as syncAdopt's actionIfSuccess, so a failed adoption
    // must not trigger downloads against a version we did not take.
    it('does not fill in files when the adoption failed', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'behind', remote: { latest: 7 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.adoptRemote.mockRejectedValue({ runtimeException: true, type: 'connect' });

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.startDownload).not.toHaveBeenCalled();
    });

  });

  describe('conflicting folder', () => {

    it('absorbs the remote changes, keeping both sides of a name clash', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      const collector = makeEventCollector();
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'conflicting', remote: { latest: 9 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.diffCurrentAndRemoteFolderVersions.mockResolvedValue({ nameOverlaps: ['av1'] });
      sync.isRemoteVersionOnDisk.mockResolvedValue('complete');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: collector.emitStorageEvent });

      expect(sync.absorbRemoteFolderChanges)
      .toHaveBeenCalledWith(IMAGES_FOLDER, { postfixForNameOverlaps: '_[ keep ]' });
      expect(collector.names()).toEqual(['sync:start', 'sync:end']);
    });

    it('downloads files that are missing after absorbing', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'conflicting', remote: { latest: 9 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.diffCurrentAndRemoteFolderVersions.mockResolvedValue({ added: { inRemote: ['av1'] } });
      sync.isRemoteVersionOnDisk.mockResolvedValue('none');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.startDownload).toHaveBeenCalledWith(imgPath('av1'), 3);
    });

    // Without this the folder stayed `conflicting` for the life of the process:
    // the branch merged the two sides and then left the result sitting there.
    // Out of a conflicting state the platform wants the version named.
    it('publishes the merged folder past the remote version', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'conflicting', remote: { latest: 9 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.diffCurrentAndRemoteFolderVersions.mockResolvedValue({ added: { inRemote: ['av1'] } });
      sync.isRemoteVersionOnDisk.mockResolvedValue('complete');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.upload).toHaveBeenCalledWith(IMAGES_FOLDER, { uploadVersion: 10 });
    });

    // Absorbing writes a new local folder version every time it is called. The
    // watchdog runs this pass once a minute while the upload cannot get
    // through, and in the live test of 2026-09-14 that took the local version
    // to 75 against a remote of 3.
    it('does not absorb when the remote side brought nothing', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'conflicting', remote: { latest: 9 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.diffCurrentAndRemoteFolderVersions.mockResolvedValue({ added: { inLocal: ['av2'] } });

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: () => undefined });

      expect(sync.absorbRemoteFolderChanges).not.toHaveBeenCalled();
      // The publishing attempt still happens - that is how the conflict ends.
      expect(sync.upload).toHaveBeenCalledWith(IMAGES_FOLDER, { uploadVersion: 10 });
    });

  });

  // An avatar whose bytes have just landed is not on screen yet: while they
  // were missing, getImage answered '[error]', and the list item retries that
  // only three times, 30s apart. So a finished download has to be reported.
  describe('reporting a finished download', () => {

    it('asks the ui to reread the list after absorbing and downloading', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      const collector = makeEventCollector();
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'conflicting', remote: { latest: 9 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.diffCurrentAndRemoteFolderVersions.mockResolvedValue({ added: { inRemote: ['av1'] } });
      sync.isRemoteVersionOnDisk.mockResolvedValue('none');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: collector.emitStorageEvent });

      // Reported last, once the bytes are actually on disk.
      expect(collector.names().at(-1)).toBe('update:contact-list');
    });

    it('asks the ui to reread the list after adopting a behind folder', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      const collector = makeEventCollector();
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'behind', remote: { latest: 9 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.isRemoteVersionOnDisk.mockResolvedValue('none');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: collector.emitStorageEvent });

      expect(sync.startDownload).toHaveBeenCalledWith(imgPath('av1'), 3);
      expect(collector.names()).toContain('update:contact-list');
    });

    it('asks the ui to reread the list after downloading a file of an unsynced folder', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      const collector = makeEventCollector();
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'unsynced' },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.isRemoteVersionOnDisk.mockResolvedValue('none');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: collector.emitStorageEvent });

      expect(collector.names()).toContain('update:contact-list');
    });

    it('says nothing when there was nothing to download', async () => {
      const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
      const collector = makeEventCollector();
      scriptStatuses(sync, {
        [IMAGES_FOLDER]: { state: 'conflicting', remote: { latest: 9 } },
        [imgPath('av1')]: { state: 'synced', synced: { latest: 3 } },
      });
      sync.isRemoteVersionOnDisk.mockResolvedValue('complete');

      await handleImagesFolderSyncStatus({ fs, emitStorageEvent: collector.emitStorageEvent });

      expect(collector.names()).not.toContain('update:contact-list');
    });

  });

  it('leaves a synced folder alone', async () => {
    const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1')] });
    const collector = makeEventCollector();
    scriptStatuses(sync, { [IMAGES_FOLDER]: { state: 'synced', synced: { latest: 3 } } });

    await handleImagesFolderSyncStatus({ fs, emitStorageEvent: collector.emitStorageEvent });

    expect(sync.upload).not.toHaveBeenCalled();
    expect(sync.adoptRemote).not.toHaveBeenCalled();
    expect(sync.absorbRemoteFolderChanges).not.toHaveBeenCalled();
    expect(collector.events).toEqual([]);
  });

});
