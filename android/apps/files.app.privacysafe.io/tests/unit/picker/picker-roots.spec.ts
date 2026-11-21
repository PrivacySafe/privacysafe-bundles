import { describe, expect, it } from 'vitest';
import type { RootFsFolderView } from '../../../shared/types/index.ts';
import {
  groupPickerFsRoots,
  isRootAvailableInMode,
  isSystemRoot,
} from '../../../src-file-picker/common/utils/picker-fs-grouping.ts';

const root = (id: string, fsId: string): RootFsFolderView => ({ id, fsId, name: id, icon: '' });

const roots = [
  root('user-synced-root', 'user-synced'),
  root('user-device-root', 'user-device'),
  root('system-synced-apps_code-root', 'system-synced-apps_code'),
  root('system-local-apps_data-root', 'system-local-apps_data'),
  root('system-device-root', 'system-device-'),
];

const keysFor = (mode: Parameters<typeof isRootAvailableInMode>[1]) =>
  groupPickerFsRoots(roots.filter(r => isRootAvailableInMode(r, mode))).map(c => c.key);

// Regression for the picker plan, item 1: system storages ("Apps Code",
// "Apps Data", the system disk) were handed out writable in every dialog mode.
describe('picker roots per dialog mode', () => {
  it('recognizes system roots', () => {
    expect(roots.map(isSystemRoot)).toEqual([false, false, true, true, true]);
  });

  it('offers system roots in openFile only', () => {
    expect(keysFor('openFile')).toEqual(['home', 'device', 'system-synced', 'system-local', 'device-system']);
    for (const mode of ['openFolder', 'saveFile', 'saveFolder'] as const) {
      expect(keysFor(mode), mode).toEqual(['home', 'device']);
    }
  });

  it('offers no system roots before a request arrives', () => {
    expect(keysFor(null)).toEqual(['home', 'device']);
  });
});
