/*
 Exercises the real RPC facade from src_deno/index.ts (the functions the GUI
 calls through appStorageSrv). Its platform-facing dependencies are replaced
 with in-memory fakes; fsService and all FS utils are the real ones.
*/
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageAppDenoService } from '../../../src_deno/types.ts';
import { USER_FS } from '../../../shared/constants/index.ts';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { TRASH, createFavorites } from '../helpers/services.ts';

const env = vi.hoisted(() => {
  let resolveSrv: (srv: unknown) => void = () => {};
  let rejectSrv: (err: unknown) => void = () => {};
  return {
    fs: undefined as unknown as MemoryFS,
    favorites: undefined as unknown as ReturnType<typeof createFavorites>,
    syncQueue: [] as string[],
    exposedServices: new Map<string, string[]>(),
    srvPromise: new Promise<unknown>((resolve, reject) => {
      resolveSrv = resolve;
      rejectSrv = reject;
    }),
    resolveSrv: (srv: unknown) => resolveSrv(srv),
    rejectSrv: (err: unknown) => rejectSrv(err),
  };
});

vi.mock('../../../shared/utils/error-handling.ts', () => ({
  setupGlobalReportingOfUnhandledErrors: () => {},
}));

vi.mock('../../../src_deno/services/app-config.service.ts', () => ({
  appConfigService: async () => ({
    appLocalFs: {},
    trashFolderName: TRASH,
    getTrashFolderName: async () => TRASH,
    loadConfigFile: async () => undefined,
    saveConfigFile: async () => {},
  }),
}));

vi.mock('../../../src_deno/utils/pre-initial-clean-procedure.ts', () => ({
  preInitialCleanProcedure: async () => ({ userSyncedFs: {}, appSyncedFs: {} }),
}));

vi.mock('../../../src_deno/utils/fs-and-folders.ts', () => ({
  prepareFsListAndFsRootFolderList: async () => ({
    getFsItem: async (fsId: string) => {
      if (fsId !== USER_FS) {
        throw new Error(`Unknown fsId '${fsId}' in test`);
      }
      return env.fs.asFsListItem(USER_FS);
    },
    getFsList: async () => ({}),
    getFsRootFolderList: async () => [],
    initializeFsItems: async () => {},
  }),
}));

vi.mock('../../../src_deno/services/favorites.service.ts', () => ({
  favoritesService: async () => ({
    getFavorites: (...args: unknown[]) => env.favorites.srv.getFavorites(...(args as [])),
    getFavorite: (favId: string) => env.favorites.srv.getFavorite(favId),
    addFavorite: (fullPath: string, fsId: string) => env.favorites.srv.addFavorite(fullPath, fsId),
    updateFavorite: (value: never) => env.favorites.srv.updateFavorite(value),
    deleteFavorite: (favId: string, ret?: boolean) => env.favorites.srv.deleteFavorite(favId, ret),
  }),
}));

vi.mock('../../../src_deno/services/sync.service.ts', () => ({
  syncService: async () => ({
    addSyncQueueItem: async (item: { path: string }) => {
      env.syncQueue.push(item.path);
    },
  }),
}));

vi.mock('../../../shared/utils/ipc/ipc-service.js', () => ({
  MultiConnectionIPCWrap: class {
    constructor(private readonly name: string) {}
    exposeReqReplyMethods(srv: unknown, methods: string[]) {
      env.exposedServices.set(this.name, methods);
      if (this.name === 'AppStorageInternal') {
        env.resolveSrv(srv);
      }
    }
    exposeObservableMethods() {}
    startIPC() {}
  },
}));

let srv: StorageAppDenoService;

function resetEnv() {
  env.fs = new MemoryFS('user', 'synced').addFolder(TRASH);
  env.favorites = createFavorites();
  env.syncQueue = [];
}

beforeAll(async () => {
  resetEnv();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // index.ts logs a startup failure and calls closeSelf(); surface it as a test error instead.
  const w3nStub = w3n as unknown as { log: ReturnType<typeof vi.fn>; closeSelf?: () => void };
  w3nStub.closeSelf = () => env.rejectSrv(w3nStub.log.mock.calls.at(-1)?.[2]);
  await import('../../../src_deno/index.ts');
  srv = (await env.srvPromise) as StorageAppDenoService;
});

beforeEach(resetEnv);

describe('RPC renameEntity (plan 1.1)', () => {
  it('renames a file inside a nested folder in place', async () => {
    env.fs.addFile('docs/a.txt');

    await srv.renameEntity({ fsId: USER_FS, entity: env.fs.entry('docs/a.txt'), newName: 'b.txt' });

    expect(env.fs.paths()).toEqual([TRASH, 'docs', 'docs/b.txt']);
  });

  it('renames a root-level file', async () => {
    env.fs.addFile('a.txt');

    await srv.renameEntity({ fsId: USER_FS, entity: env.fs.entry('a.txt'), newName: 'b.txt' });

    expect(env.fs.paths()).toEqual([TRASH, 'b.txt']);
  });

  it('queues the renamed entity and its parent folder for sync', async () => {
    env.fs.addFile('docs/a.txt');

    await srv.renameEntity({ fsId: USER_FS, entity: env.fs.entry('docs/a.txt'), newName: 'b.txt' });

    expect(env.syncQueue).toEqual(['docs/b.txt', 'docs']);
  });
});

describe('RPC copyMoveEntities, move mode (plan 1.3)', () => {
  it('moves the entities and does not try to copy them afterwards', async () => {
    env.fs.addFile('a.txt').addFolder('target');

    await srv.copyMoveEntities({
      sourceFsId: USER_FS,
      entities: [env.fs.entry('a.txt')],
      targetFsId: USER_FS,
      target: env.fs.entry('target'),
      moveMode: true,
    });

    expect(env.fs.paths()).toEqual([TRASH, 'target', 'target/a.txt']);
    expect(w3n.log).not.toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Error while copying'),
      expect.anything(),
    );
  });
});

// Live test round 2, item 11: a move inside the synced FS left the target folder unqueued,
// so other devices saw the entity removed from the source and not added to the target.
describe('RPC move inside the synced FS: sync queue', () => {
  it('queues both the source and the target folder', async () => {
    env.fs.addFolder('src/x').addFile('src/x/f.txt').addFolder('dst');

    await srv.moveEntities({
      fsId: USER_FS,
      entities: [env.fs.entry('src/x')],
      targetFsId: USER_FS,
      targetFolder: 'dst',
    });

    expect(env.syncQueue).toContain('src');
    expect(env.syncQueue).toContain('dst');
  });

  it('queues the target once for several entities, and every distinct source folder', async () => {
    env.fs.addFile('a/f1.txt').addFile('a/f2.txt').addFile('b/f3.txt').addFolder('dst/deep');

    await srv.moveEntities({
      fsId: USER_FS,
      entities: [env.fs.entry('a/f1.txt'), env.fs.entry('a/f2.txt'), env.fs.entry('b/f3.txt')],
      targetFsId: USER_FS,
      targetFolder: 'dst/deep',
    });

    expect(env.syncQueue.filter(p => p === 'dst/deep')).toHaveLength(1);
    expect(env.syncQueue).toContain('a');
    expect(env.syncQueue).toContain('b');
  });

  it('queues the root as the target of a move to the root', async () => {
    env.fs.addFile('a/f.txt');

    await srv.moveEntities({
      fsId: USER_FS,
      entities: [env.fs.entry('a/f.txt')],
      targetFsId: USER_FS,
      targetFolder: '',
    });

    expect(env.syncQueue).toContain('a');
    expect(env.syncQueue).toContain('');
  });

  it('queues the target folder of a single-entity move', async () => {
    env.fs.addFile('src/f.txt').addFolder('dst');

    await srv.moveEntity({
      fsId: USER_FS,
      entity: env.fs.entry('src/f.txt'),
      targetFsId: USER_FS,
      newPath: 'dst/f.txt',
    });

    expect(env.syncQueue).toContain('src');
    expect(env.syncQueue).toContain('dst');
  });
});

describe('RPC deleteEntities (plan 1.2)', () => {
  it('moves every selected entity to the trash', async () => {
    env.fs.addFile('docs/f1.txt').addFile('docs/f2.txt').addFile('docs/f3.txt');

    await srv.deleteEntities({
      fsId: USER_FS,
      entities: ['docs/f1.txt', 'docs/f2.txt', 'docs/f3.txt'].map(p => env.fs.entry(p)),
    });

    expect(env.fs.paths().filter(p => p.startsWith('docs/'))).toEqual([]);
  });
});

// Regression for plan 2.5: the folder an entity was deleted from was not queued,
// so other devices kept seeing the deleted entity.
describe('RPC deleteEntities: sync queue', () => {
  it('queues the source folder, the trashed entity and the trash', async () => {
    env.fs.addFile('docs/a.txt');

    await srv.deleteEntities({ fsId: USER_FS, entities: [env.fs.entry('docs/a.txt')] });

    expect(env.syncQueue).toContain('docs');
    expect(env.syncQueue).toContain(TRASH);
    expect(env.syncQueue).toContain(`${TRASH}/a.txt`);
  });

  it('queues every distinct source folder once', async () => {
    env.fs.addFile('a/1.txt').addFile('a/2.txt').addFile('b/3.txt');

    await srv.deleteEntities({
      fsId: USER_FS,
      entities: ['a/1.txt', 'a/2.txt', 'b/3.txt'].map(p => env.fs.entry(p)),
    });

    expect(env.syncQueue.filter(p => p === 'a')).toHaveLength(1);
    expect(env.syncQueue).toContain('b');
  });

  it('queues the trash when an entity is removed from it without the "completely" flag', async () => {
    env.fs.addFile(`${TRASH}/old.txt`);

    await srv.deleteEntities({ fsId: USER_FS, entities: [env.fs.entry(`${TRASH}/old.txt`)] });

    expect(env.fs.has(`${TRASH}/old.txt`)).toBe(false);
    expect(env.syncQueue).toEqual([TRASH]);
  });

  it('queues the source folder on a complete removal', async () => {
    env.fs.addFile('docs/a.txt');

    await srv.deleteEntities({ fsId: USER_FS, entities: [env.fs.entry('docs/a.txt')], completely: true });

    expect(env.syncQueue).toEqual(['docs']);
  });
});

// Regression for plan 3.6: names and paths from the GUI and the pickers were
// used without checks; the FS utils build paths by plain string joins.
describe('RPC input validation', () => {
  it.each(['a/b.txt', '..', '.', '', '  ', 'a\\b'])('refuses to rename to %j', async newName => {
    env.fs.addFile('docs/a.txt');

    await expect(srv.renameEntity({ fsId: USER_FS, entity: env.fs.entry('docs/a.txt'), newName })).rejects.toThrow(
      'Invalid name',
    );
    expect(env.fs.paths()).toEqual([TRASH, 'docs', 'docs/a.txt']);
  });

  it.each(['../outside', 'a/../../b', 'a//b'])('refuses to make the folder %j', async path => {
    await expect(srv.makeFolder({ fsId: USER_FS, path })).rejects.toThrow('Invalid path');
  });

  it('refuses to move a folder into itself', async () => {
    env.fs.addFolder('a/b');

    await expect(
      srv.moveEntities({ fsId: USER_FS, entities: [env.fs.entry('a')], targetFsId: USER_FS, targetFolder: 'a/b' }),
    ).rejects.toThrow('into itself');
    expect(env.fs.has('a/b')).toBe(true);
  });

  it('refuses to copy a folder into itself', async () => {
    env.fs.addFolder('a');

    await expect(
      srv.copyEntities({ fsId: USER_FS, entities: [env.fs.entry('a')], targetFsId: USER_FS, targetFolder: 'a' }),
    ).rejects.toThrow('into itself');
  });

  it('moves a folder into a sibling with a common name prefix', async () => {
    env.fs.addFolder('a').addFolder('ab');

    await srv.moveEntities({
      fsId: USER_FS,
      entities: [env.fs.entry('a')],
      targetFsId: USER_FS,
      targetFolder: 'ab',
    });

    expect(env.fs.has('ab/a')).toBe(true);
  });
});

// Regression for plan 3.5: the pickers, which run as dialogs of other apps,
// had access to every method of the service, including queue and config changes.
describe('RPC services', () => {
  it('gives the pickers a separate service with read-only methods', () => {
    expect(env.exposedServices.get('AppStoragePicker')).toEqual([
      'getFsList',
      'getFsRootFolderList',
      'getFolderContentFilledList',
    ]);
    expect(env.exposedServices.get('AppStorageInternal')).toContain('deleteSyncQueueItem');
  });
});

describe('RPC deleteEntities with failures', () => {
  it('syncs what was deleted and then reports the failure', async () => {
    env.fs.addFile('docs/a.txt');
    const missing = { ...env.fs.entry('docs/a.txt'), name: 'gone.txt', fullPath: 'other/gone.txt' };

    await expect(
      srv.deleteEntities({ fsId: USER_FS, entities: [env.fs.entry('docs/a.txt'), missing] }),
    ).rejects.toThrow('could not be deleted');

    expect(env.syncQueue).toContain('docs');
    expect(env.syncQueue).not.toContain('other');
  });

  // Regression for live testing item 7: an entity moved to the trash and back (its
  // original location could not be stored) left both folders unsynced.
  it('syncs the folder and the trash of an entity moved there and back', async () => {
    env.fs.addFile('docs/a.txt');
    vi.spyOn(env.fs, 'updateXAttrs').mockRejectedValueOnce({ runtimeException: true, type: 'file', ioError: true });

    await expect(srv.deleteEntities({ fsId: USER_FS, entities: [env.fs.entry('docs/a.txt')] })).rejects.toThrow(
      'could not be deleted',
    );

    expect(env.fs.has('docs/a.txt')).toBe(true);
    expect(env.syncQueue).toContain('docs');
    expect(env.syncQueue).toContain(TRASH);
  });
});
