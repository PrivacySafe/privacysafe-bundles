import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteFolder, StorageEvent } from '../../../shared/types/index.ts';
import { favoritesService } from '../../../src_deno/services/favorites.service.ts';
import { FAVORITES_DATA_FILE } from '../../../src_deno/constants.ts';

type FavoritesData = Record<string, FavoriteFolder>;

const fav = (favId: string, fullPath = favId): FavoriteFolder => ({ favId, fsId: 'user-synced', fullPath });

/** App synced FS with one JSON file and a sync API driven by the test. */
function createAppSyncedFs({ file, online = true }: { file?: FavoritesData; online?: boolean } = {}) {
  const files = new Map<string, unknown>(file ? [[FAVORITES_DATA_FILE, file]] : []);
  const remoteFiles = new Map<number, unknown>();
  let fileState: Partial<web3n.files.SyncStatus> = { state: 'synced', synced: { latest: 1 } };
  let rootState: Partial<web3n.files.SyncStatus> = { state: 'synced' };
  let isOnline = online;
  let fileObserver: web3n.Observer<web3n.files.FileEvent> | undefined;

  const status = vi.fn(async (path: string) => {
    if (!isOnline) {
      throw { type: 'connect' };
    }
    return (path === FAVORITES_DATA_FILE ? fileState : rootState) as web3n.files.SyncStatus;
  });

  const sync = {
    status,
    isRemoteVersionOnDisk: vi.fn(async () => 'complete'),
    startDownload: vi.fn<() => Promise<{ downloadTaskId: number } | undefined>>(async () => undefined),
    startUpload: vi.fn(async () => ({ uploadVersion: 2, uploadTaskId: 1 })),
    adoptRemote: vi.fn(async () => {}),
    upload: vi.fn<(path: string, opts?: web3n.files.OptionsToUploadLocal) => Promise<void>>(async () => {}),
  };

  const fs = {
    v: {
      sync,
      readJSONFile: vi.fn(async (_path: string, flags?: web3n.files.VersionedReadFlags) => ({
        json: structuredClone(
          flags?.remoteVersion !== undefined
            ? remoteFiles.get(flags.remoteVersion)
            : files.get(FAVORITES_DATA_FILE),
        ),
        version: 1,
      })),
    },
    checkFilePresence: async (path: string) => files.has(path),
    // like a real FS, reads and writes copy the data
    readJSONFile: async (path: string) => structuredClone(files.get(path)),
    writeJSONFile: vi.fn(async (path: string, value: unknown) => {
      files.set(path, structuredClone(value));
    }),
    watchFile: vi.fn((_path: string, observer: web3n.Observer<web3n.files.FileEvent>) => {
      fileObserver = observer;
      return () => {};
    }),
  };

  return {
    fs: fs as unknown as web3n.files.WritableFS,
    raw: fs,
    sync,
    fileData: () => files.get(FAVORITES_DATA_FILE) as FavoritesData,
    setFileData: (data: FavoritesData) => files.set(FAVORITES_DATA_FILE, data),
    setRemoteFile: (version: number, data: FavoritesData) => remoteFiles.set(version, data),
    setFileState: (state: Partial<web3n.files.SyncStatus>) => {
      fileState = state;
    },
    setRootState: (state: Partial<web3n.files.SyncStatus>) => {
      rootState = state;
    },
    setOnline: (value: boolean) => {
      isOnline = value;
    },
    emit: (type: string) =>
      fileObserver?.next?.({ type, path: FAVORITES_DATA_FILE } as unknown as web3n.files.FileEvent),
    failWatcher: (err: unknown) => fileObserver?.error?.(err),
  };
}

beforeEach(() => {
  (w3n as unknown as Record<string, unknown>).connectivity = {
    isOnline: async () => 'online_80%',
    watch: () => () => {},
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete (w3n as unknown as Record<string, unknown>).connectivity;
});

async function setup(options?: Parameters<typeof createAppSyncedFs>[0]) {
  const appFs = createAppSyncedFs(options);
  const events: StorageEvent[] = [];
  const srv = await favoritesService({ appSyncedFs: appFs.fs, emitStorageEvent: ev => events.push(ev) });
  return { srv, appFs, events };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('favoritesService', () => {
  // Regression for plan 2.14: an empty in-memory list made the service re-read
  // the not-yet-saved file, so the last deleted favorite came back.
  it('does not bring back the last deleted favorite', async () => {
    const { srv, appFs } = await setup({ file: { a: fav('a') } });

    await srv.deleteFavorite('a');

    expect(await srv.getFavorites()).toEqual([]);
    expect(appFs.fileData()).toEqual({});
  });

  it('saves changes to the file at once', async () => {
    const { srv, appFs } = await setup({ file: {} });

    const added = await srv.addFavorite('docs', 'user-synced');

    expect(appFs.fileData()).toEqual({ [added.favId]: added });
  });

  // Regression for plan 2.14: fs.service called deleteFavorite without
  // returnUpdatedList and got undefined instead of the list.
  it('returns the updated list on request', async () => {
    const { srv } = await setup({ file: { a: fav('a'), b: fav('b') } });

    expect(await srv.deleteFavorite('a', true)).toEqual([fav('b')]);
  });

  // Regression for plan 2.14: the conflict merge read the local version twice,
  // so the favorites added on the other device were lost.
  it('merges the remote version on a conflict', async () => {
    const { appFs } = await setup({ file: { local: fav('local') } });
    appFs.setRemoteFile(5, { remote: fav('remote') });
    appFs.setFileState({ state: 'conflicting', remote: { latest: 5 } });

    appFs.emit('remote-change');
    await settle();
    await settle();

    expect(appFs.raw.v.readJSONFile).toHaveBeenCalledWith(FAVORITES_DATA_FILE, { remoteVersion: 5 });
    expect(Object.keys(appFs.fileData()).sort()).toEqual(['local', 'remote']);
    expect(appFs.sync.upload).toHaveBeenCalledWith(FAVORITES_DATA_FILE, { uploadVersion: 6 });
  });

  // Regression for live testing item 8: the root was uploaded while the file upload
  // had only been started, and the platform refused it with childNeverUploaded.
  it('uploads the root only after the upload of the file has finished', async () => {
    const { appFs } = await setup({ file: {} });
    const order: string[] = [];
    appFs.sync.upload.mockImplementation(async (path: string) => {
      order.push(`start:${path}`);
      await settle();
      order.push(`end:${path}`);
    });
    appFs.setFileState({ state: 'unsynced' });
    appFs.setRootState({ state: 'unsynced' });

    appFs.emit('file-change');
    for (let i = 0; i < 5; i += 1) {
      await settle();
    }

    expect(order.slice(0, 4)).toEqual([
      `start:${FAVORITES_DATA_FILE}`,
      `end:${FAVORITES_DATA_FILE}`,
      'start:',
      'end:',
    ]);
    expect(appFs.sync.startUpload).not.toHaveBeenCalled();
  });

  // Regression for plan 2.14: every event, including the progress of its own
  // upload, started another sync round.
  it('ignores the events of its own upload', async () => {
    const { appFs } = await setup({ file: {} });
    const callsBefore = appFs.sync.status.mock.calls.length;

    appFs.emit('upload-started');
    appFs.emit('upload-progress');
    appFs.emit('upload-done');
    await settle();

    expect(appFs.sync.status.mock.calls.length).toBe(callsBefore);
  });

  it('runs one sync round at a time for a burst of events', async () => {
    const { appFs } = await setup({ file: {} });
    appFs.setFileState({ state: 'unsynced' });

    for (let i = 0; i < 5; i += 1) {
      appFs.emit('file-change');
    }
    await settle();
    await settle();
    await settle();

    // one round for the first event and one for all the events that came during it
    expect(appFs.sync.upload.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('reloads the file when the adopted version is already on disk', async () => {
    const { srv, appFs } = await setup({ file: { old: fav('old') } });
    appFs.setFileState({ state: 'behind', remote: { latest: 3 } });
    appFs.sync.startDownload.mockResolvedValue(undefined);
    appFs.sync.adoptRemote.mockImplementation(async () => {
      appFs.setFileData({ fresh: fav('fresh') });
    });

    appFs.emit('remote-change');
    await settle();
    await settle();

    expect(await srv.getFavorites()).toEqual([fav('fresh')]);
  });

  it('watches the file again after a watcher error', async () => {
    const { appFs } = await setup({ file: {} });
    vi.useFakeTimers();
    try {
      appFs.failWatcher(new Error('watcher broke'));
      await vi.advanceTimersByTimeAsync(5000);

      expect(appFs.raw.watchFile).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression for live testing item 10: after the IPC connection was lost the file
  // was watched again every 5 seconds, flooding the log.
  it('does not watch the file again after the IPC connection is lost', async () => {
    const { appFs } = await setup({ file: {} });
    vi.useFakeTimers();
    try {
      appFs.failWatcher({ runtimeException: true, type: 'ipc', connectorStop: true });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(appFs.raw.watchFile).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression for plan 2.14: the start failed when the server was unreachable.
  it('starts offline', async () => {
    const { srv } = await setup({ file: { a: fav('a') }, online: false });

    expect(await srv.getFavorites()).toEqual([fav('a')]);
  });
});
