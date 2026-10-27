import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageEvent, SyncQueueItem } from '../../../shared/types/index.ts';
import { syncService } from '../../../src_deno/services/sync.service.ts';
import { SYNC_QUEUE_DATA_FILE } from '../../../src_deno/constants.ts';

type SyncState = web3n.files.SyncState;

/**
 * A synced FS whose sync API is driven by the test: per-path states, the
 * results of startUpload/adoptRemote, and FS events delivered to watchTree.
 */
function createSyncedFs() {
  const states = new Map<string, Partial<web3n.files.SyncStatus>>();
  let online = true;
  let treeObserver: web3n.Observer<web3n.files.FSEvent> | undefined;

  const sync = {
    status: vi.fn(async (path: string) => {
      if (!online) {
        throw { type: 'connect', message: 'offline' };
      }
      return { state: 'synced' as SyncState, ...states.get(path) } as web3n.files.SyncStatus;
    }),
    startUpload: vi.fn<(path: string) => Promise<{ uploadVersion: number; uploadTaskId: number } | undefined>>(
      async () => ({ uploadVersion: 2, uploadTaskId: 1 }),
    ),
    adoptRemote: vi.fn<(path: string) => Promise<void>>(async () => {}),
    startDownload: vi.fn(async () => undefined),
  };

  const fs = {
    v: { sync },
    listFolder: vi.fn(async () => [] as web3n.files.ListingEntry[]),
    stat: vi.fn(async () => ({ isFile: true, size: 1 }) as web3n.files.Stats),
    watchTree: vi.fn((_path: string, _depth: unknown, observer: web3n.Observer<web3n.files.FSEvent>) => {
      treeObserver = observer;
      return () => {};
    }),
  };

  return {
    fs: fs as unknown as web3n.files.WritableFS,
    sync,
    setState: (path: string, status: Partial<web3n.files.SyncStatus>) => states.set(path, status),
    setOnline: (value: boolean) => {
      online = value;
    },
    emit: (event: Record<string, unknown> & { type: string; path: string }) =>
      treeObserver?.next?.(event as unknown as web3n.files.FSEvent),
    failWatcher: (err: unknown) => treeObserver?.error?.(err),
    watchTree: fs.watchTree,
  };
}

function createAppLocalFs(initialQueue?: Record<string, SyncQueueItem>) {
  const files = new Map<string, unknown>(initialQueue ? [[SYNC_QUEUE_DATA_FILE, initialQueue]] : []);
  return {
    files,
    fs: {
      checkFilePresence: async (path: string) => files.has(path),
      // like a real FS, reads and writes copy the data
      readJSONFile: async (path: string) => structuredClone(files.get(path)),
      writeJSONFile: async (path: string, value: unknown) => {
        files.set(path, structuredClone(value));
      },
    } as unknown as web3n.files.WritableFS,
  };
}

const pending = (path: string, extra: Partial<SyncQueueItem> = {}): SyncQueueItem => ({
  path,
  status: 'pending',
  attempts: 0,
  lastError: '',
  lastChanged: 0,
  ...extra,
});

let connectivityObserver: web3n.Observer<{ isOnline: boolean }> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  (w3n as unknown as Record<string, unknown>).connectivity = {
    watch: (obs: web3n.Observer<{ isOnline: boolean }>) => {
      connectivityObserver = obs;
      return () => {};
    },
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  delete (w3n as unknown as Record<string, unknown>).connectivity;
});

async function setup(
  initialQueue?: Record<string, SyncQueueItem>,
  prepare?: (synced: ReturnType<typeof createSyncedFs>) => void,
) {
  const synced = createSyncedFs();
  prepare?.(synced);
  const local = createAppLocalFs(initialQueue);
  const events: StorageEvent[] = [];
  const srv = await syncService({
    appLocalFs: local.fs,
    userSyncedFs: synced.fs,
    emitStorageEvent: ev => events.push(ev),
  });
  return { srv, synced, local, events };
}

/** Lets planned queue passes and their async steps run. */
async function runQueue() {
  await vi.advanceTimersByTimeAsync(3000);
}

describe('syncService queue', () => {
  it('uploads an unsynced item and removes it after upload-done', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);
    expect((await srv.getSyncQueue())['a.txt']?.status).toBe('inProgress');

    synced.setState('a.txt', { state: 'synced' });
    synced.emit({ type: 'upload-done', path: 'a.txt' });
    await runQueue();

    expect(await srv.getSyncQueue()).not.toHaveProperty('a.txt');
  });

  // Regression for plan 2.2: a failed upload was only logged, the item stayed
  // 'inProgress' forever and the attempts counter never grew.
  it('returns a failed upload to pending and counts the attempt', async () => {
    const { srv, synced, events } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });
    synced.sync.startUpload.mockRejectedValue(new Error('server error'));

    await srv.addSyncQueueItem(pending('a.txt'));
    await vi.advanceTimersByTimeAsync(600 + 3 * 1000); // first pass with the upload retries

    const item = (await srv.getSyncQueue())['a.txt'];
    expect(item.status).toBe('pending');
    expect(item.attempts).toBe(1);
    expect(item.lastError).toContain('error');
    expect(events.some(e => e.event === 'sync:error')).toBe(true);
  });

  it('stops retrying after the attempts limit', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });
    synced.sync.startUpload.mockRejectedValue(new Error('server error'));

    await srv.addSyncQueueItem(pending('a.txt'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect((await srv.getSyncQueue())['a.txt'].attempts).toBe(3);
    // 3 queue attempts, each with 3 calls (retryCount: 2)
    expect(synced.sync.startUpload).toHaveBeenCalledTimes(9);
  });

  // Regression for plan 2.2: startUpload returns undefined when there is nothing
  // to upload; no upload-done event follows, so the item used to stay forever.
  it('finishes the item when there is nothing to upload', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });
    synced.sync.startUpload.mockResolvedValue(undefined);

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    expect(await srv.getSyncQueue()).not.toHaveProperty('a.txt');
  });

  // Regression for plans 2.1 and 2.6: a failed adoption threw a TypeError in the
  // error handler, never emitted adoptRemote:end and left the item stuck.
  it('counts a failed adoption and always emits adoptRemote:end', async () => {
    const { srv, synced, events } = await setup();
    synced.setState('a.txt', { state: 'behind', remote: { latest: 5 } });
    synced.sync.adoptRemote.mockRejectedValue({ type: 'file', message: 'adopt failed' });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    const item = (await srv.getSyncQueue())['a.txt'];
    expect(item.status).toBe('pending');
    expect(item.attempts).toBeGreaterThanOrEqual(1);
    expect(events.filter(e => e.event === 'adoptRemote:end').length).toBeGreaterThanOrEqual(1);
    expect(events.filter(e => e.event === 'adoptRemote:start').length).toBe(
      events.filter(e => e.event === 'adoptRemote:end').length,
    );
  });

  it('removes the item after a successful adoption', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'behind', remote: { latest: 5 } });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    expect(synced.sync.adoptRemote).toHaveBeenCalledWith('a.txt', { remoteVersion: 5 });
    expect(await srv.getSyncQueue()).not.toHaveProperty('a.txt');
  });

  // Regression for plan 2.2: a synced folder whose child got into the queue
  // during the pass went to 'inProgress' with no action and blocked its branch.
  it('returns a synced parent to pending when a child is queued during the pass', async () => {
    const { srv, synced } = await setup();
    synced.setState('x.txt', { state: 'unsynced' });
    synced.setState('docs', { state: 'synced' });
    let finishUpload: (v: undefined) => void = () => {};
    synced.sync.startUpload.mockImplementationOnce(() => new Promise(resolve => (finishUpload = resolve)));

    await srv.addSyncQueueItem(pending('x.txt'));
    await srv.addSyncQueueItem(pending('docs'));
    await vi.advanceTimersByTimeAsync(600); // the pass waits for the upload of x.txt

    synced.setState('docs/new.txt', { state: 'unsynced' });
    synced.sync.startUpload.mockImplementation(() => new Promise(() => {})); // later uploads never end
    await srv.addSyncQueueItem(pending('docs/new.txt')); // the user adds a file meanwhile
    finishUpload(undefined);
    await vi.advanceTimersByTimeAsync(100); // the pass reaches 'docs'

    expect((await srv.getSyncQueue())['docs'].status).toBe('pending');
  });

  // Regression for plan 2.2: items saved as 'inProgress' stayed so after a restart.
  it('resets items left in progress by a previous run', async () => {
    const { srv, synced } = await setup({ 'a.txt': pending('a.txt', { status: 'inProgress' }) });
    synced.setState('a.txt', { state: 'unsynced' });

    await srv.addSyncQueueItem(pending('b.txt'));
    await runQueue();

    expect(synced.sync.startUpload).toHaveBeenCalledWith('a.txt', undefined);
  });

  // Regression for plan 2.8: '/a.txt' and 'a.txt' were different keys, and the
  // '/a.txt' item could never be processed.
  it('normalizes queue keys', async () => {
    const { srv } = await setup();

    await srv.addSyncQueueItem(pending('/a.txt'));
    await srv.addSyncQueueItem(pending('./b.txt'));

    const queue = await srv.getSyncQueue();
    expect(Object.keys(queue).sort()).toEqual(expect.arrayContaining(['a.txt', 'b.txt']));
    expect(queue).not.toHaveProperty('/a.txt');
    expect(await srv.isSyncQueueItemPresence('/a.txt')).toBe(true);
  });

  // Regression for plan 2.4: upload-done used to remove the item even if the
  // entity was changed during the upload, so the newer version was never uploaded.
  it('keeps the item when the entity changed during the upload', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();
    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);

    // the upload of the old version ends, but the local version is newer already
    synced.emit({ type: 'upload-done', path: 'a.txt' });
    await runQueue();

    expect(synced.sync.startUpload).toHaveBeenCalledTimes(2);
    expect(await srv.getSyncQueue()).toHaveProperty('a.txt');
  });

  // Regression for plan 2.7: after a connection flap a second pass could run in
  // parallel with the first one and start the same upload again.
  it('does not run two queue passes at the same time', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });
    synced.setState('b.txt', { state: 'unsynced' });
    let finishFirstUpload: (v: { uploadVersion: number; uploadTaskId: number }) => void = () => {};
    synced.sync.startUpload.mockImplementationOnce(() => new Promise(resolve => (finishFirstUpload = resolve)));

    await srv.addSyncQueueItem(pending('a.txt'));
    await srv.addSyncQueueItem(pending('b.txt'));
    await vi.advanceTimersByTimeAsync(600); // the first pass is waiting for the first upload
    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);

    connectivityObserver?.next?.({ isOnline: true }); // the watcher learns the initial state
    connectivityObserver?.next?.({ isOnline: false }); // connection flap
    connectivityObserver?.next?.({ isOnline: true });
    await vi.advanceTimersByTimeAsync(600);

    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);

    finishFirstUpload({ uploadVersion: 2, uploadTaskId: 1 });
    synced.setState(synced.sync.startUpload.mock.calls[0][0], {
      state: 'unsynced',
      uploading: { uploadStarted: true, localVersion: 1, remoteVersion: 2, bytesLeftToUpload: 10 },
    });
    await runQueue();

    const uploadedPaths = synced.sync.startUpload.mock.calls.map(c => c[0]);
    expect(new Set(uploadedPaths).size).toBe(uploadedPaths.length);
  });

  // Regression for plan 2.13: every queued item and every queue step asked the
  // server for the root status just to check the connection.
  it('does not ask the server per queued item to check the connection', async () => {
    const { srv, synced } = await setup();
    const rootStatusCallsAtStart = synced.sync.status.mock.calls.filter(c => c[0] === '').length;

    for (let i = 0; i < 20; i += 1) {
      await srv.addSyncQueueItem(pending(`f${i}.txt`));
    }
    await runQueue();

    const rootStatusCalls = synced.sync.status.mock.calls.filter(c => c[0] === '').length;
    // the root is a regular queue item here (added by expandParents), so one more call is expected
    expect(rootStatusCalls - rootStatusCallsAtStart).toBeLessThanOrEqual(1);
  });

  it('does not count a connection error as a failed attempt', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });
    synced.setOnline(false); // the watcher has not noticed it yet

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    expect((await srv.getSyncQueue())['a.txt']).toMatchObject({ status: 'pending', attempts: 0 });

    synced.setOnline(true);
    connectivityObserver?.next?.({ isOnline: true });
    await runQueue();

    expect(synced.sync.startUpload).toHaveBeenCalledWith('a.txt', undefined);
  });

  // Regression for plan 2.10: when the app started offline, changes made while
  // it was not running were never looked for.
  it('scans for unsynced root-level entities when the connection appears after an offline start', async () => {
    const { srv, synced } = await setup(undefined, fs => {
      fs.setOnline(false);
      fs.setState('changed-offline.txt', { state: 'unsynced' });
      (fs.fs.listFolder as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: 'changed-offline.txt', isFile: true },
      ]);
    });
    expect(await srv.getSyncQueue()).toEqual({});

    synced.setOnline(true);
    connectivityObserver?.next?.({ isOnline: true });
    await runQueue();

    expect(synced.sync.startUpload).toHaveBeenCalledWith('changed-offline.txt', undefined);
  });

  // Regression for plan 2.12: after a watcher error no upload-done event came
  // anymore, and every upload stayed 'inProgress' forever.
  it('watches the tree again after a watcher error and re-checks items in progress', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();
    expect((await srv.getSyncQueue())['a.txt'].status).toBe('inProgress');

    synced.failWatcher(new Error('watcher broke'));
    synced.setState('a.txt', { state: 'synced' }); // the upload ended while nobody was watching
    await runQueue();

    expect(synced.watchTree).toHaveBeenCalledTimes(2);
    expect(await srv.getSyncQueue()).not.toHaveProperty('a.txt');
  });

  // Regression for plan 2.12: remote changes were adopted directly, without any
  // limit and in parallel with the queue.
  it('adopts a remote change through the queue', async () => {
    const { srv, synced } = await setup();
    synced.setState('docs/a.txt', { state: 'behind', remote: { latest: 7 } });

    synced.emit({ type: 'remote-change', path: 'docs/a.txt', syncStatus: { state: 'behind' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(synced.sync.adoptRemote).not.toHaveBeenCalled();
    expect(await srv.getSyncQueue()).toHaveProperty('docs/a.txt');

    await runQueue();
    expect(synced.sync.adoptRemote).toHaveBeenCalledWith('docs/a.txt', { remoteVersion: 7 });
  });

  it('reports a conflict that comes with a remote change', async () => {
    const { synced, events } = await setup();

    synced.emit({ type: 'remote-change', path: 'docs/a.txt', syncStatus: { state: 'conflicting' } });

    expect(events).toContainEqual({ event: 'arose:conflict', payload: { path: 'docs/a.txt' } });
  });

  // Regression for plan 2.3: an item that used up its attempts blocked its
  // parents forever, as nothing in the GUI could reset it.
  it('gives a failed item a new series of attempts later', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });
    synced.sync.startUpload.mockRejectedValue(new Error('server error'));

    await srv.addSyncQueueItem(pending('a.txt'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await srv.getSyncQueue())['a.txt'].attempts).toBe(3);

    synced.sync.startUpload.mockResolvedValue(undefined); // the server is fine again
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await runQueue();

    expect(await srv.getSyncQueue()).not.toHaveProperty('a.txt');
  });
});

const uploadingNewVersion = { uploadStarted: false, localVersion: 2, remoteVersion: 2, bytesLeftToUpload: 100 };

// Regression for live testing item 9: an upload is reported before its server
// transaction starts (uploadStarted: false). In that window the queue started a
// second upload, the platform refused it with alreadyUploading, and the GUI got
// a sync error and lost the progress of the running upload.
describe('syncService with an upload that is already running', () => {
  it('does not start another upload before the server transaction starts', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced', uploading: uploadingNewVersion });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    expect(synced.sync.startUpload).not.toHaveBeenCalled();
    expect((await srv.getSyncQueue())['a.txt'].status).toBe('inProgress');
  });

  it('joins the running upload when the platform refuses a second start', async () => {
    const { srv, synced, events } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });
    synced.sync.startUpload.mockImplementation(async () => {
      // another start got there first
      synced.setState('a.txt', { state: 'unsynced', uploading: uploadingNewVersion });
      throw { runtimeException: true, type: 'fs-sync', path: 'a.txt', alreadyUploading: true, uploadTaskId: 7 };
    });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);
    expect(events.some(e => e.event === 'sync:error')).toBe(false);
    expect(events.some(e => e.event === 'upload:end')).toBe(false);
    const item = (await srv.getSyncQueue())['a.txt'];
    expect(item.status).toBe('inProgress');
    expect(item.attempts).toBe(0);
  });

  // a failed upload may leave a stale task in the platform (platform report, P6):
  // then nothing is uploading, and the refusal is a real failure
  it('reports alreadyUploading without a running upload as a failure', async () => {
    const { srv, synced, events } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });
    synced.sync.startUpload.mockRejectedValue({
      runtimeException: true,
      type: 'fs-sync',
      path: 'a.txt',
      alreadyUploading: true,
      uploadTaskId: 7,
    });

    await srv.addSyncQueueItem(pending('a.txt'));
    await vi.advanceTimersByTimeAsync(600 + 3 * 1000);

    expect(events.some(e => e.event === 'sync:error')).toBe(true);
    expect((await srv.getSyncQueue())['a.txt'].attempts).toBe(1);
  });

  it('does not turn an item in progress back to pending when it is queued again', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();
    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);

    // e.g. the GUI row sees 'unsynced' during the upload and queues the entity again
    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);
    expect((await srv.getSyncQueue())['a.txt'].status).toBe('inProgress');
  });

  it('keeps the item for adoption when a remote change came during the upload', async () => {
    const { srv, synced } = await setup();
    synced.setState('a.txt', { state: 'unsynced' });

    await srv.addSyncQueueItem(pending('a.txt'));
    await runQueue();

    synced.setState('a.txt', { state: 'behind', remote: { latest: 9 } });
    synced.emit({ type: 'upload-done', path: 'a.txt' });
    await runQueue();

    expect(synced.sync.adoptRemote).toHaveBeenCalledWith('a.txt', { remoteVersion: 9 });
  });
});

// Regression for live testing item 6: the platform adopted the version but rejected
// (its cleanup of removed children failed); the queue repeated the adoption, and
// every check of a child after it could break the adopted folder further.
describe('syncService adoption', () => {
  it('finishes the item when the version is adopted despite an error', async () => {
    const { srv, synced, events } = await setup();
    synced.setState('a.txt', { state: 'behind', remote: { latest: 5 } });
    synced.sync.adoptRemote.mockImplementation(async () => {
      synced.setState('a.txt', { state: 'synced' });
      throw { runtimeException: true, type: 'file', notFound: true, inconsistentStateOfFS: true };
    });

    await srv.addSyncQueueItem(pending('a.txt'));
    await vi.advanceTimersByTimeAsync(600); // one pass, before any retry

    // finished at once, not counted as a failed attempt to be retried
    expect(await srv.getSyncQueue()).not.toHaveProperty('a.txt');
    await runQueue();
    expect(synced.sync.adoptRemote).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.event === 'adoptRemote:start')).toHaveLength(1);
  });

  it('checks only the files of an adopted folder, and a broken one does not keep the folder queued', async () => {
    const { srv, synced } = await setup();
    synced.setState('docs', { state: 'behind', remote: { latest: 3 } });
    (synced.fs.listFolder as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'sub', isFolder: true },
      { name: 'broken.txt', isFile: true },
      { name: 'ok.txt', isFile: true },
    ]);
    const stat = synced.fs.stat as ReturnType<typeof vi.fn>;
    stat.mockImplementation(async (path: string) => {
      if (path === 'docs') {
        return { isFolder: true };
      }
      if (path === 'docs/broken.txt') {
        throw { runtimeException: true, type: 'file', notFound: true };
      }
      return { isFile: true, size: 1 };
    });

    await srv.addSyncQueueItem(pending('docs'));
    await runQueue();

    expect(stat.mock.calls.map(c => c[0])).not.toContain('docs/sub');
    expect(stat.mock.calls.map(c => c[0])).toContain('docs/ok.txt');
    expect(await srv.getSyncQueue()).not.toHaveProperty('docs');
  });
});

describe('syncService start and lost connection', () => {
  // Regression for live testing item 6: one broken root entry stopped the whole scan.
  it('scans the other root entries when one of them fails', async () => {
    const { synced } = await setup(undefined, fs => {
      (fs.fs.listFolder as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: 'broken', isFolder: true },
        { name: 'changed.txt', isFile: true },
      ]);
      fs.setState('changed.txt', { state: 'unsynced' });
      const status = fs.sync.status.getMockImplementation()!;
      fs.sync.status.mockImplementation(async (path: string) => {
        if (path === 'broken') {
          throw { runtimeException: true, type: 'file', notFound: true, inconsistentStateOfFS: true };
        }
        return status(path);
      });
    });

    await runQueue();

    expect(synced.sync.startUpload).toHaveBeenCalledWith('changed.txt', undefined);
  });

  // Regression for live testing item 10: after the IPC connection was lost the
  // watcher was subscribed again and again, flooding the log.
  it('does not watch the tree again after the IPC connection is lost', async () => {
    const { synced } = await setup();

    synced.failWatcher({ runtimeException: true, type: 'ipc', ipcNotConnected: true });
    await vi.advanceTimersByTimeAsync(120_000);

    expect(synced.watchTree).toHaveBeenCalledTimes(1);
  });
});

// Live test round 2, item 12: a failed upload gives no platform event (P14), so its item
// stayed 'inProgress' with the banner and the progress indicator until a restart.
describe('syncService: uploads that end without upload-done', () => {
  const uploading = { localVersion: 2, remoteVersion: 2, bytesLeftToUpload: 10 } as web3n.files.UploadingState;

  async function startUploadOf(path: string) {
    const ctx = await setup();
    ctx.synced.setState(path, { state: 'unsynced' });
    ctx.synced.sync.startUpload.mockImplementationOnce(async () => {
      ctx.synced.setState(path, { state: 'unsynced', uploading });
      return { uploadVersion: 2, uploadTaskId: 1 };
    });
    await ctx.srv.addSyncQueueItem(pending(path));
    await runQueue();
    expect((await ctx.srv.getSyncQueue())[path]?.status).toBe('inProgress');
    return ctx;
  }

  it('returns a failed upload to pending after two checks and counts the attempt', async () => {
    const { srv, synced, events } = await startUploadOf('Docs');
    synced.sync.startUpload.mockImplementation(() => new Promise(() => {})); // a retry keeps running

    synced.setState('Docs', { state: 'unsynced' }); // the upload failed, no event
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await srv.getSyncQueue())['Docs'].status).toBe('inProgress'); // the first check only notes it

    await vi.advanceTimersByTimeAsync(15_000);
    const item = (await srv.getSyncQueue())['Docs'];
    expect(item.attempts).toBe(1);
    expect(item.lastError).toContain('without completion');
    expect(events.some(e => e.event === 'upload:end' && e.payload.path === 'Docs')).toBe(true);

    await runQueue();
    expect(synced.sync.startUpload).toHaveBeenCalledTimes(2); // retried
  });

  it('finishes an item whose upload is synced without the event', async () => {
    const { srv, synced } = await startUploadOf('Docs');

    synced.setState('Docs', { state: 'synced' });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await srv.getSyncQueue()).not.toHaveProperty('Docs');
  });

  it('reports a conflict found after the upload and removes the item', async () => {
    const { srv, synced, events } = await startUploadOf('Docs');

    synced.setState('Docs', { state: 'conflicting' });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(events.some(e => e.event === 'arose:conflict' && e.payload.path === 'Docs')).toBe(true);
    expect(await srv.getSyncQueue()).not.toHaveProperty('Docs');
  });

  it('keeps a long upload in progress while the status shows it', async () => {
    const { srv, synced } = await startUploadOf('video.mov');

    await vi.advanceTimersByTimeAsync(120_000);

    expect((await srv.getSyncQueue())['video.mov'].status).toBe('inProgress');
    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);
  });

  it('does not count an upload finished by upload-done between the checks', async () => {
    const { srv, synced } = await startUploadOf('Docs');

    synced.setState('Docs', { state: 'unsynced' }); // completion is being recorded
    await vi.advanceTimersByTimeAsync(15_000);
    synced.setState('Docs', { state: 'synced' });
    synced.emit({ type: 'upload-done', path: 'Docs' });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await srv.getSyncQueue()).not.toHaveProperty('Docs');
    expect(synced.sync.startUpload).toHaveBeenCalledTimes(1);
  });
});
