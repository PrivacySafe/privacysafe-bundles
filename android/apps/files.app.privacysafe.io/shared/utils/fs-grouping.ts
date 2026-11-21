import type { RootFsFolderView } from '../types/index.ts';
import { USER_FS, USER_DEVICE_FS, USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER } from '../constants/index.ts';

export type FsCategoryKey = 'home' | 'device' | 'system-synced' | 'system-local' | 'device-system';

export interface FsCategory {
  key: FsCategoryKey;
  labelKey: string;
  mode: 'single' | 'collection';
  roots: RootFsFolderView[]; // length 1 when mode === 'single'
}

const SYSTEM_SYNCED_PREFIX = 'system-synced-';
const SYSTEM_LOCAL_PREFIX = 'system-local-';
const SYSTEM_DEVICE_PREFIX = 'system-device';

const CATEGORY_LABEL_KEYS: Record<FsCategoryKey, string> = {
  home: 'file_picker.category.home',
  device: 'file_picker.category.device',
  'system-synced': 'file_picker.category.system_synced',
  'system-local': 'file_picker.category.system_local',
  'device-system': 'file_picker.category.device_system',
};

// Trash shares fsId with Home / Home(local)...fsId equality alone can't
// tell them apart, must exclude by id explicitly.
const EXCLUDED_IDS = new Set<string>([USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER]);

/*
 * Groups the platform's flat fsFolderList into the 5 fixed filesystem
 * categories, in display order (Home always first). A category resolving
 * to exactly one root renders as a single labeled row (real folder name
 * ignored); more than one root renders the label a s a section header with
 * each root's own name underneath.
 */
export function groupFsRoots(fsFolderList: RootFsFolderView[]): FsCategory[] {
  const buckets: Record<FsCategoryKey, RootFsFolderView[]> = {
    home: [],
    device: [],
    'system-synced': [],
    'system-local': [],
    'device-system': [],
  };

  for (const f of fsFolderList) {
    if (EXCLUDED_IDS.has(f.id)) {
      continue;
    }

    if (f.fsId === USER_FS) {
      buckets.home.push(f);
    } else if (f.fsId === USER_DEVICE_FS || f.fsId.startsWith(`${USER_DEVICE_FS}-`)) {
      buckets.device.push(f);
    } else if (f.fsId.startsWith(SYSTEM_SYNCED_PREFIX)) {
      buckets['system-synced'].push(f);
    } else if (f.fsId.startsWith(SYSTEM_LOCAL_PREFIX)) {
      buckets['system-local'].push(f);
    } else if (f.fsId.startsWith(SYSTEM_DEVICE_PREFIX)) {
      buckets['device-system'].push(f);
    }
    // Other roots (e.g. user-local) are handled separately by each sidebar.
  }

  const order: FsCategoryKey[] = ['home', 'device', 'system-synced', 'system-local', 'device-system'];

  return order
    .filter(key => buckets[key].length > 0)
    .map(key => ({
      key,
      labelKey: CATEGORY_LABEL_KEYS[key],
      mode: buckets[key].length > 1 ? 'collection' : 'single',
      roots: buckets[key],
    }));
}

/** Remove only the platform-generated storage suffix when displaying a root. */
export function getFsRootDisplayName(root: Pick<RootFsFolderView, 'fsId' | 'name'>): string {
  const [use, type] = root.fsId.split('-');
  if (!['user', 'system'].includes(use) || !['synced', 'local', 'device'].includes(type)) {
    return root.name;
  }

  const suffix = ` (${use}, ${type})`;
  return root.name.endsWith(suffix) ? root.name.slice(0, -suffix.length) : root.name;
}
