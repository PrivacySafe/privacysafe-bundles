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
import { syncUpload } from '@deno/utils/sync-upload.ts';
import { syncDownload } from '@deno/utils/sync-download.ts';
import { syncAdopt } from '@deno/utils/sync-adopt.ts';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from '@deno/constants';
import {
  alreadyUploadingException,
  childNeverUploadedException,
  connectException,
  makeEventCollector,
  makeFakeFs,
} from '../../helpers/fake-fs.ts';
import { installFakeW3n } from '../../helpers/fake-w3n.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('syncUpload', () => {

  // The two modes are different contracts. With immediately:true the platform's
  // `upload` awaits completion, so this wrapper both opens and closes the sync
  // indicator itself. With immediately:false it calls `startUpload`, which only
  // kicks the transfer off — the closing sync:end then arrives later, from the
  // fs.watchTree 'upload-done' handler in contacts-deno-srv.
  describe('immediate mode', () => {

    it('awaits the platform upload and brackets it with paired events', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();

      await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent, immediately: true,
      });

      expect(sync.upload).toHaveBeenCalledWith(CONTACTS_DB_FILE, undefined);
      expect(sync.startUpload).not.toHaveBeenCalled();
      expect(collector.names()).toEqual(['sync:start', 'sync:end']);
    });

    it('returns whatever the platform upload returned', async () => {
      const { fs, sync } = makeFakeFs();
      sync.upload.mockResolvedValue({ uploadVersion: 7, uploadTaskId: 3 });

      const result = await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined, immediately: true,
      });

      expect(result).toEqual({ uploadVersion: 7, uploadTaskId: 3 });
    });

    it('forwards the upload options', async () => {
      const { fs, sync } = makeFakeFs();

      await syncUpload({
        fs,
        path: CONTACTS_DB_FILE,
        opts: { uploadVersion: 12 },
        emitStorageEvent: () => undefined,
        immediately: true,
      });

      expect(sync.upload).toHaveBeenCalledWith(CONTACTS_DB_FILE, { uploadVersion: 12 });
    });

  });

  describe('deferred mode', () => {

    it('only starts the upload, leaving sync:end to the watchTree handler', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();

      await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent,
      });

      expect(sync.startUpload).toHaveBeenCalledWith(CONTACTS_DB_FILE, undefined);
      expect(sync.upload).not.toHaveBeenCalled();
      expect(collector.names()).toEqual(['sync:start']);
    });

  });

  it('reports the synced FS root as "root"', async () => {
    const { fs } = makeFakeFs();
    const collector = makeEventCollector();

    await syncUpload({
      fs, path: '', emitStorageEvent: collector.emitStorageEvent, immediately: true,
    });

    expect(collector.pathsOf('sync:start')).toEqual(['root']);
    expect(collector.pathsOf('sync:end')).toEqual(['root']);
  });

  it('swallows a connect exception and closes the indicator', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.upload.mockRejectedValue(connectException());

    const result = await syncUpload({
      fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent, immediately: true,
    });

    expect(result).toBeUndefined();
    // Being offline must not leave the path stuck in the sync indicator for the
    // rest of the session.
    expect(collector.names()).toEqual(['sync:start', 'sync:end']);
  });

  // Starting a second upload of a path that is already uploading is rejected by
  // the platform, and that rejection used to fail the whole calling operation —
  // every contact save failed while an upload of the db file was in flight.
  describe('an upload already in flight', () => {

    it('is detected before anything is started or announced', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      sync.status.mockResolvedValue({
        state: 'unsynced',
        uploading: {
          localVersion: 4, remoteVersion: 5, bytesLeftToUpload: 2048, uploadStarted: true,
        },
      });

      const result = await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent,
      });

      expect(result).toBeUndefined();
      expect(sync.startUpload).not.toHaveBeenCalled();
      expect(sync.upload).not.toHaveBeenCalled();
      // No sync:start either, or the indicator would be left unpaired.
      expect(collector.events).toEqual([]);
    });

    it('proceeds when the status reports no upload in flight', async () => {
      const { fs, sync } = makeFakeFs();
      sync.status.mockResolvedValue({ state: 'unsynced', local: { latest: 4 } });

      await syncUpload({ fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined });

      expect(sync.startUpload).toHaveBeenCalled();
    });

    // No status means the server could not be asked, and starting an upload
    // then is what leaves the platform holding a task that never settles - the
    // sync indicator ran for a whole offline period, and IPC calls awaiting
    // such an upload hang with it. See syncUpload.
    it('does not start an upload when the status cannot be read at all', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      sync.status.mockRejectedValue(new Error('no status'));

      const res = await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent,
      });

      expect(res).toBeUndefined();
      expect(sync.startUpload).not.toHaveBeenCalled();
      expect(sync.upload).not.toHaveBeenCalled();
      // Nothing is announced either, or the indicator would never be closed.
      expect(collector.events).toEqual([]);
    });

    it('does not start an upload while the server is out of reach', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      sync.status.mockRejectedValue(connectException());

      await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent, immediately: true,
      });

      expect(sync.upload).not.toHaveBeenCalled();
      expect(collector.events).toEqual([]);
    });

    // Local work is never lost by that skip: the version stays unsynced, and
    // the reconnection pass uploads it.
    it('leaves the local version to be uploaded later', async () => {
      const { fs, sync } = makeFakeFs();
      sync.status.mockRejectedValue(connectException());

      await syncUpload({ fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined });
      sync.status.mockResolvedValue({ state: 'unsynced', local: { latest: 4 } });
      await syncUpload({ fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined });

      expect(sync.startUpload).toHaveBeenCalledOnce();
    });

    // The check above is only an optimisation: an upload can begin between it
    // and the call, so the rejection has to be tolerated too. The platform's own
    // doc for startUpload says this outcome belongs in the RETURN value, and the
    // exception even carries the same uploadTaskId a success would.
    it('is tolerated when it starts between the check and the call', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      sync.status.mockResolvedValueOnce({ state: 'unsynced' } as never);
      sync.status.mockResolvedValue({
        state: 'unsynced', uploading: { localVersion: 2 },
      } as never);
      sync.startUpload.mockRejectedValue(alreadyUploadingException());

      const result = await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent,
      });

      expect(result).toBeUndefined();
      expect(collector.names()).toEqual(['sync:start']);
    });

    it('is tolerated in immediate mode as well', async () => {
      const { fs, sync } = makeFakeFs();
      sync.status.mockResolvedValueOnce({ state: 'unsynced' } as never);
      sync.status.mockResolvedValue({
        state: 'unsynced', uploading: { localVersion: 2 },
      } as never);
      sync.upload.mockRejectedValue(alreadyUploadingException());

      await expect(syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined, immediately: true,
      })).resolves.toBeUndefined();
    });

    // The same rejection means something else entirely when the platform's own
    // status says nothing is uploading: a failed upload task that the platform
    // never took out of its map. It refuses every later upload of that file for
    // the life of the process, so the indicator must not be left running under
    // a transfer that will never happen. Seen in the live test of 2026-09-13,
    // where a device sat in `conflicting` for half an hour being told
    // `alreadyUploading` once a minute.
    it('closes the indicator when nothing is actually uploading', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      const w3n = installFakeW3n();
      sync.status.mockResolvedValue({ state: 'unsynced' } as never);
      sync.startUpload.mockRejectedValue(alreadyUploadingException());

      try {
        await syncUpload({
          fs, path: 'stuck-path', emitStorageEvent: collector.emitStorageEvent,
        });

        expect(collector.names()).toEqual(['sync:start', 'sync:end']);
        expect(w3n.w3n.log)
        .toHaveBeenCalledWith('warning', expect.stringContaining('stuck-path'));
      } finally {
        w3n.uninstall();
      }
    });

    // The watchdog asks once a minute for the rest of the session; one line is
    // a report, sixty an hour buries everything else in the log.
    it('reports an unpublishable path once, not once per attempt', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      const w3n = installFakeW3n();
      sync.status.mockResolvedValue({ state: 'unsynced' } as never);
      sync.startUpload.mockRejectedValue(alreadyUploadingException());

      try {
        for (let i = 0; i < 3; i++) {
          await syncUpload({
            fs, path: 'noisy-path', emitStorageEvent: collector.emitStorageEvent,
          });
        }

        expect(w3n.w3n.log).toHaveBeenCalledOnce();
        // Only the first attempt announced anything. The watchdog asks again
        // every minute, and a pair of events per ask made the progress bar
        // blink for the rest of the session.
        expect(collector.names()).toEqual(['sync:start', 'sync:end']);
      } finally {
        w3n.uninstall();
      }
    });

    // Giving up on the path entirely would be wrong: the block is the
    // platform's, and a later attempt can find it gone.
    it('announces again once an attempt gets through', async () => {
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      const w3n = installFakeW3n();
      sync.status.mockResolvedValue({ state: 'unsynced' } as never);
      sync.startUpload.mockRejectedValueOnce(alreadyUploadingException());

      try {
        await syncUpload({
          fs, path: 'recovering-path', emitStorageEvent: collector.emitStorageEvent,
        });
        await syncUpload({
          fs, path: 'recovering-path', emitStorageEvent: collector.emitStorageEvent,
        });
        await syncUpload({
          fs, path: 'recovering-path', emitStorageEvent: collector.emitStorageEvent,
        });

        // First attempt: the pair that reported the block. Second: silent, and
        // it succeeded, which clears the path. Third: announced normally again.
        expect(collector.names()).toEqual(['sync:start', 'sync:end', 'sync:start']);
      } finally {
        w3n.uninstall();
      }
    });

  });

  // "Upload in conflicting and behind state of sync requires explicit upload
  // version" — the platform's own words. Guessing a version here would publish
  // local state over a remote divergence nobody absorbed, so the upload is left
  // to the handler whose job that is. Seen for real: an `images` folder in
  // conflicting state made addImage's folder upload fail, taking the avatar the
  // user was saving with it.
  describe('a state that needs an explicit version', () => {

    for (const state of ['conflicting', 'behind'] as const) {

      it(`is not uploaded blindly from ${state}`, async () => {
        const { fs, sync } = makeFakeFs();
        const collector = makeEventCollector();
        sync.status.mockResolvedValue({ state, remote: { latest: 9 } });

        const result = await syncUpload({
          fs, path: IMAGES_FOLDER, emitStorageEvent: collector.emitStorageEvent,
          immediately: true,
        });

        expect(result).toBeUndefined();
        expect(sync.upload).not.toHaveBeenCalled();
        expect(collector.events).toEqual([]);
      });

      it(`is uploaded from ${state} when the version is given`, async () => {
        const { fs, sync } = makeFakeFs();
        sync.status.mockResolvedValue({ state, remote: { latest: 9 } });

        await syncUpload({
          fs,
          path: CONTACTS_DB_FILE,
          opts: { uploadVersion: 10 },
          emitStorageEvent: () => undefined,
          immediately: true,
        });

        expect(sync.upload).toHaveBeenCalledWith(CONTACTS_DB_FILE, { uploadVersion: 10 });
      });

    }

    it('uploads from an unsynced state without a version', async () => {
      const { fs, sync } = makeFakeFs();
      sync.status.mockResolvedValue({ state: 'unsynced', local: { latest: 4 } });

      await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined, immediately: true,
      });

      expect(sync.upload).toHaveBeenCalled();
    });

  });

  it('rethrows an unexpected error after closing the sync indicator', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.upload.mockRejectedValue({ runtimeException: true, type: 'fs-sync', message: 'nope' });

    await expect(syncUpload({
      fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent, immediately: true,
    })).rejects.toBeDefined();

    expect(collector.names()).toEqual(['sync:start', 'sync:end']);
    expect(collector.events.at(-1)).toMatchObject({
      payload: { path: CONTACTS_DB_FILE, error: 'nope' },
    });
  });

  describe('childNeverUploaded retry', () => {

    it('resolves to undefined and retries after 10 seconds', async () => {
      vi.useFakeTimers();
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      sync.upload.mockRejectedValueOnce(childNeverUploadedException());

      const result = await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent, immediately: true,
      });

      expect(result).toBeUndefined();
      expect(sync.upload).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(sync.upload).toHaveBeenCalledTimes(2);
    });

    // The unpaired sync:start left by the failed attempt is harmless because
    // the sync store is a set keyed by path, not a counter: the retry's own
    // sync:start collapses into the same entry, and its sync:end clears it.
    it('closes the indicator once the retry succeeds', async () => {
      vi.useFakeTimers();
      const { fs, sync } = makeFakeFs();
      const collector = makeEventCollector();
      sync.upload.mockRejectedValueOnce(childNeverUploadedException());

      await syncUpload({
        fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent, immediately: true,
      });
      expect(collector.names()).toEqual(['sync:start']);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(collector.names()).toEqual(['sync:start', 'sync:start', 'sync:end']);
    });

  });

  // The deferred path used to return the platform promise WITHOUT awaiting it,
  // so an async rejection bypassed the tolerance below and surfaced at the
  // caller — and addContact/updateContact await syncUpload without
  // `immediately`, so an offline save failed instead of being tolerated. The
  // call is awaited now, which is what makes these two cases behave alike.
  it('absorbs an async connect failure in deferred mode', async () => {
    const { fs, sync } = makeFakeFs();
    sync.startUpload.mockReturnValue(Promise.reject(connectException()));

    await expect(syncUpload({
      fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined,
    })).resolves.toBeUndefined();
  });

  it('does absorb a synchronous connect failure in deferred mode', async () => {
    const { fs, sync } = makeFakeFs();
    sync.startUpload.mockImplementation(() => {
      throw connectException();
    });

    await expect(syncUpload({
      fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined,
    })).resolves.toBeUndefined();
  });

});

describe('syncDownload', () => {

  it('starts the download for the requested version', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();

    await syncDownload({
      fs, path: CONTACTS_DB_FILE, version: 5, emitStorageEvent: collector.emitStorageEvent,
    });

    expect(sync.startDownload).toHaveBeenCalledWith(CONTACTS_DB_FILE, 5);
    expect(collector.names()).toEqual(['sync:start']);
  });

  it('swallows a synchronous connect exception', async () => {
    const { fs, sync } = makeFakeFs();
    sync.startDownload.mockImplementation(() => {
      throw connectException();
    });

    await expect(syncDownload({
      fs, path: CONTACTS_DB_FILE, version: 5, emitStorageEvent: () => undefined,
    })).resolves.toBeUndefined();
  });

  it('closes the indicator with an error before rethrowing', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.startDownload.mockImplementation(() => {
      throw { runtimeException: true, type: 'fs-sync', message: 'broken' };
    });

    await expect(syncDownload({
      fs, path: CONTACTS_DB_FILE, version: 5, emitStorageEvent: collector.emitStorageEvent,
    })).rejects.toBeDefined();

    expect(collector.names()).toEqual(['sync:start', 'sync:end']);
  });

});

describe('syncAdopt', () => {

  it('adopts the requested remote version and always closes the indicator', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();

    await syncAdopt({
      fs,
      path: CONTACTS_DB_FILE,
      opts: { remoteVersion: 9 },
      emitStorageEvent: collector.emitStorageEvent,
    });

    expect(sync.adoptRemote).toHaveBeenCalledWith(CONTACTS_DB_FILE, { remoteVersion: 9 });
    expect(collector.names()).toEqual(['sync:start', 'sync:end']);
  });

  it('runs actionIfSuccess after a successful adoption', async () => {
    const { fs } = makeFakeFs();
    const actionIfSuccess = vi.fn(async () => undefined);

    await syncAdopt({
      fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined, actionIfSuccess,
    });

    expect(actionIfSuccess).toHaveBeenCalled();
  });

  it('skips actionIfSuccess when the adoption failed', async () => {
    const { fs, sync } = makeFakeFs();
    const actionIfSuccess = vi.fn(async () => undefined);
    sync.adoptRemote.mockRejectedValue(connectException());

    await syncAdopt({
      fs, path: CONTACTS_DB_FILE, emitStorageEvent: () => undefined, actionIfSuccess,
    });

    expect(actionIfSuccess).not.toHaveBeenCalled();
  });

  it('refuses a non-function actionIfSuccess', async () => {
    const { fs } = makeFakeFs();

    await expect(syncAdopt({
      fs,
      path: CONTACTS_DB_FILE,
      emitStorageEvent: () => undefined,
      actionIfSuccess: 'nope' as unknown as () => void,
    })).rejects.toThrow(/'actionIfSuccess' is not a function/);
  });

  it('closes the indicator with the error text on a connect failure', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.adoptRemote.mockRejectedValue({
      runtimeException: true, type: 'connect', message: 'no network',
    });

    await syncAdopt({
      fs, path: CONTACTS_DB_FILE, emitStorageEvent: collector.emitStorageEvent,
    });

    expect(collector.names()).toEqual(['sync:start', 'sync:end']);
    expect(collector.events.at(-1)).toMatchObject({ payload: { error: 'no network' } });
  });

});
