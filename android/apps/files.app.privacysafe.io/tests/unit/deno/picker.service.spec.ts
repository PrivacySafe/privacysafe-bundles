import { describe, expect, it, vi } from 'vitest';
import type { FsListItem, RootFsFolderView } from '../../../shared/types/index.ts';
import { USER_DEVICE_FS, USER_FS, USER_LOCAL_FS } from '../../../shared/constants/index.ts';
import { makePickerService } from '../../../src_deno/services/picker.service.ts';
import { TRASH } from '../helpers/services.ts';

const SYSTEM_FS = 'system-synced-files.app.privacysafe.io';

function setup(config: Record<string, unknown> = {}) {
  const fsIds = [USER_FS, USER_LOCAL_FS, USER_DEVICE_FS, SYSTEM_FS];
  const fsList = Object.fromEntries(
    fsIds.map(fsId => [fsId, { fsId, name: fsId, entity: {} } as unknown as FsListItem]),
  );
  const roots = fsIds.map(fsId => ({ id: `${fsId}-root`, fsId, name: fsId, icon: '' }) as RootFsFolderView);
  const getFolderContentFilledList = vi.fn(async () => []);
  const srv = makePickerService({
    getFsList: async () => fsList,
    getFsRootFolderList: async () => roots,
    getFolderContentFilledList,
    loadConfigFile: async () => ({ trashFolderName: TRASH, ...config }) as never,
    trashFolderName: TRASH,
  });
  return { srv, getFolderContentFilledList };
}

const list = (srv: ReturnType<typeof setup>['srv'], fsId: string, path: string) =>
  srv.getFolderContentFilledList({ fsId, path, operatingSystem: 'macos' });

// Security audit 2026-11: a picker runs as a dialog of another app; it used to get every
// storage of the user and of the system as a writable FS, hidden ones included.
describe('picker service', () => {
  it('gives only the storages of the visible roots', async () => {
    const { srv } = setup({ localFoldersDisplaying: false, deviceFoldersDisplaying: true });

    expect(Object.keys(await srv.getFsList()).sort()).toEqual([USER_DEVICE_FS, USER_FS].sort());
  });

  it('does not list a hidden storage', async () => {
    const { srv, getFolderContentFilledList } = setup({ systemFoldersDisplaying: false });

    await expect(list(srv, SYSTEM_FS, '')).rejects.toThrow();
    expect(getFolderContentFilledList).not.toHaveBeenCalled();
  });

  it.each(['../x', 'a/../b', `${TRASH}`, `${TRASH}/a`])('does not list %j', async path => {
    const { srv, getFolderContentFilledList } = setup();

    await expect(list(srv, USER_FS, path)).rejects.toThrow();
    expect(getFolderContentFilledList).not.toHaveBeenCalled();
  });

  it('lists a folder without xattrs', async () => {
    const { srv, getFolderContentFilledList } = setup();

    await list(srv, USER_FS, 'Docs');

    expect(getFolderContentFilledList).toHaveBeenCalledWith(
      expect.objectContaining({ fsId: USER_FS, path: 'Docs', withXAttrs: false }),
    );
  });
});
