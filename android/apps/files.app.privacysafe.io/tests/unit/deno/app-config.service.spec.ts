import { afterEach, describe, expect, it, vi } from 'vitest';
import { appConfigService } from '../../../src_deno/services/app-config.service.ts';
import { CONFIG_FILE } from '../../../src_deno/constants.ts';

type W3nStub = Record<string, unknown>;

function setupPlatform({
  config,
  readFails = false,
  userId = 'user@example.com',
}: {
  config?: Record<string, unknown>;
  readFails?: boolean;
  userId?: string | Error;
}) {
  const files = new Map<string, unknown>(config ? [[CONFIG_FILE, config]] : []);
  const appLocalFs = {
    checkFilePresence: vi.fn(async (path: string) => files.has(path)),
    readJSONFile: vi.fn(async (path: string) => {
      if (readFails) {
        throw new Error('parsing error');
      }
      // like a real FS, reads and writes copy the data
      return structuredClone(files.get(path));
    }),
    writeJSONFile: vi.fn(async (path: string, value: unknown) => {
      files.set(path, structuredClone(value));
    }),
  };

  const w3nStub = w3n as unknown as W3nStub;
  w3nStub.storage = { getAppLocalFS: async () => appLocalFs };
  w3nStub.mailerid = {
    getUserId: async () => {
      if (userId instanceof Error) {
        throw userId;
      }
      return userId;
    },
  };

  return { files, appLocalFs };
}

afterEach(() => {
  const w3nStub = w3n as unknown as W3nStub;
  delete w3nStub.storage;
  delete w3nStub.mailerid;
});

// Regression for plan 1.12: an empty trash folder name made "delete" move
// entities into the root folder.
describe('appConfigService: trash folder name', () => {
  it('creates the config with a user-based name on the first start', async () => {
    const { files } = setupPlatform({});

    const srv = await appConfigService();

    expect(srv.trashFolderName).toBe('.trash-folder-user@example.com');
    expect(files.get(CONFIG_FILE)).toEqual({ trashFolderName: '.trash-folder-user@example.com' });
  });

  it('keeps the name stored in the config', async () => {
    const { appLocalFs } = setupPlatform({ config: { trashFolderName: '.trash-folder-old', theme: 'dark' } });

    const srv = await appConfigService();

    expect(srv.trashFolderName).toBe('.trash-folder-old');
    expect(await srv.getTrashFolderName()).toBe('.trash-folder-old');
    expect(appLocalFs.writeJSONFile).not.toHaveBeenCalled();
  });

  it('adds the missing name to an existing config and keeps other settings', async () => {
    const { files } = setupPlatform({ config: { theme: 'dark' } });

    const srv = await appConfigService();

    expect(srv.trashFolderName).toBe('.trash-folder-user@example.com');
    expect(files.get(CONFIG_FILE)).toEqual({ theme: 'dark', trashFolderName: '.trash-folder-user@example.com' });
  });

  it('falls back to the default name without overwriting an unreadable config', async () => {
    const { appLocalFs } = setupPlatform({ config: { trashFolderName: 'x' }, readFails: true });

    const srv = await appConfigService();

    expect(srv.trashFolderName).toBe('.trash-folder-user@example.com');
    expect(appLocalFs.writeJSONFile).not.toHaveBeenCalled();
  });

  it('never returns an empty name when the user id is unavailable', async () => {
    setupPlatform({ userId: new Error('no mailerid') });

    const srv = await appConfigService();

    expect(srv.trashFolderName).toBe('.trash-folder-');
  });
});
