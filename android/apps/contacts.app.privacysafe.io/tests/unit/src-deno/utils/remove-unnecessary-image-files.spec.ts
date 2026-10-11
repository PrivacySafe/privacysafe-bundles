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
import { removeUnnecessaryImageFiles } from '@deno/utils/remove-unnecessary-image-files.ts';
import { IMAGES_FOLDER } from '@deno/constants';
import { fileEntry, folderEntry, makeEventCollector, makeFakeFs } from '../../helpers/fake-fs.ts';

const deletedPaths = (fsCalls: { deleteFile: { mock: { calls: unknown[][] } } }) =>
  fsCalls.deleteFile.mock.calls.map(call => call[0] as string).sort();

describe('removeUnnecessaryImageFiles', () => {

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // An avatar is stored as two files: the full size under the id returned by
  // addImage, and a thumbnail under `${id}-mini`. Only the full-size id is
  // recorded in the db, so the collector has to derive the '-mini' companion —
  // otherwise every thumbnail in use would be treated as garbage.
  it('keeps both the avatar and its -mini companion', async () => {
    const { fs, fsCalls } = makeFakeFs({
      [IMAGES_FOLDER]: [fileEntry('av1'), fileEntry('av1-mini')],
    });

    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => ['av1'],
      emitStorageEvent: () => undefined,
    });

    expect(fsCalls.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes files that no contact references', async () => {
    const { fs, fsCalls } = makeFakeFs({
      [IMAGES_FOLDER]: [
        fileEntry('av1'), fileEntry('av1-mini'),
        fileEntry('orphan'), fileEntry('orphan-mini'),
      ],
    });

    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => ['av1'],
      emitStorageEvent: () => undefined,
    });

    expect(deletedPaths(fsCalls)).toEqual([
      `${IMAGES_FOLDER}/orphan`, `${IMAGES_FOLDER}/orphan-mini`,
    ]);
  });

  it('deletes everything when no avatar is in use', async () => {
    const { fs, fsCalls } = makeFakeFs({
      [IMAGES_FOLDER]: [fileEntry('av1'), fileEntry('av2-mini')],
    });

    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => [],
      emitStorageEvent: () => undefined,
    });

    expect(deletedPaths(fsCalls)).toEqual([
      `${IMAGES_FOLDER}/av1`, `${IMAGES_FOLDER}/av2-mini`,
    ]);
  });

  it('ignores folders sitting inside the images folder', async () => {
    const { fs, fsCalls } = makeFakeFs({
      [IMAGES_FOLDER]: [folderEntry('nested'), fileEntry('orphan')],
    });

    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => [],
      emitStorageEvent: () => undefined,
    });

    expect(deletedPaths(fsCalls)).toEqual([`${IMAGES_FOLDER}/orphan`]);
  });

  // Uploading the folder is what makes the deletions visible on other devices,
  // but doing it when nothing was deleted would be pointless traffic on every
  // 24h sweep and on every app start.
  it('uploads the images folder only when something was deleted', async () => {
    const withGarbage = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('orphan')] });
    const collectorA = makeEventCollector();

    await removeUnnecessaryImageFiles({
      fs: withGarbage.fs,
      getIdsOfAllFilesInUse: () => [],
      emitStorageEvent: collectorA.emitStorageEvent,
    });

    expect(withGarbage.sync.upload).toHaveBeenCalledWith(IMAGES_FOLDER, undefined);
    expect(collectorA.names()).toEqual(['sync:start', 'sync:end']);

    const clean = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('av1'), fileEntry('av1-mini')] });
    const collectorB = makeEventCollector();

    await removeUnnecessaryImageFiles({
      fs: clean.fs,
      getIdsOfAllFilesInUse: () => ['av1'],
      emitStorageEvent: collectorB.emitStorageEvent,
    });

    expect(clean.sync.upload).not.toHaveBeenCalled();
    expect(collectorB.events).toEqual([]);
  });

  it('does nothing for an empty images folder', async () => {
    const { fs, fsCalls, sync } = makeFakeFs({ [IMAGES_FOLDER]: [] });

    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => ['av1'],
      emitStorageEvent: () => undefined,
    });

    expect(fsCalls.deleteFile).not.toHaveBeenCalled();
    expect(sync.upload).not.toHaveBeenCalled();
  });

  // Deletions go through Promise.allSettled, so one file that refuses to be
  // removed must not abort the sweep or block the follow-up upload.
  it('completes the sweep even when one deletion fails', async () => {
    const { fs, fsCalls, sync } = makeFakeFs({
      [IMAGES_FOLDER]: [fileEntry('bad'), fileEntry('good')],
    });
    fsCalls.deleteFile.mockImplementation(async (path: string) => {
      if (path.endsWith('bad')) {
        throw new Error('cannot delete');
      }
    });

    await expect(removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => [],
      emitStorageEvent: () => undefined,
    })).resolves.toBeUndefined();

    expect(deletedPaths(fsCalls)).toEqual([
      `${IMAGES_FOLDER}/bad`, `${IMAGES_FOLDER}/good`,
    ]);
    expect(sync.upload).toHaveBeenCalled();
  });

  // Deleting a file whose upload is in flight makes the core reject its own
  // background removeCurrentVersion with file/concurrentUpdate, and that
  // rejection is unhandled: our deleteFile has already resolved. An orphan is
  // never urgent, so it waits for the next sweep.
  it('leaves an orphan alone while its upload is in flight', async () => {
    const { fs, fsCalls, sync } = makeFakeFs({
      [IMAGES_FOLDER]: [fileEntry('uploading'), fileEntry('idle')],
    });
    sync.status.mockImplementation(async (path: string) => (
      path.endsWith('uploading')
        ? {
          state: 'unsynced',
          uploading: {
            localVersion: 2, remoteVersion: 3, bytesLeftToUpload: 512, uploadStarted: true,
          },
        }
        : undefined
    ));

    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => [],
      emitStorageEvent: () => undefined,
    });

    expect(deletedPaths(fsCalls)).toEqual([`${IMAGES_FOLDER}/idle`]);
  });

  it('collects the deferred orphan on a later sweep', async () => {
    const { fs, fsCalls, sync } = makeFakeFs({
      [IMAGES_FOLDER]: [fileEntry('orphan')],
    });
    sync.status.mockResolvedValue({
      state: 'unsynced',
      uploading: {
        localVersion: 2, remoteVersion: 3, bytesLeftToUpload: 512, uploadStarted: true,
      },
    });
    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => [],
      emitStorageEvent: () => undefined,
    });
    expect(fsCalls.deleteFile).not.toHaveBeenCalled();

    sync.status.mockResolvedValue({ state: 'synced', synced: { latest: 3 } });
    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => [],
      emitStorageEvent: () => undefined,
    });

    expect(deletedPaths(fsCalls)).toEqual([`${IMAGES_FOLDER}/orphan`]);
  });

  it('still uploads the folder when every orphan was deferred', async () => {
    const { fs, sync } = makeFakeFs({ [IMAGES_FOLDER]: [fileEntry('orphan')] });
    sync.status.mockResolvedValue({
      state: 'unsynced',
      uploading: {
        localVersion: 2, remoteVersion: 3, bytesLeftToUpload: 512, uploadStarted: true,
      },
    });

    await removeUnnecessaryImageFiles({
      fs,
      getIdsOfAllFilesInUse: () => [],
      emitStorageEvent: () => undefined,
    });

    // Nothing was removed, so there is nothing to publish either.
    expect(sync.upload).not.toHaveBeenCalled();
  });

});
