/*
 Copyright (C) 2025 3NSoft Inc.

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
import type { StorageType, RootFsFolderView, StorageAppSettings } from '../../shared/types/index.ts';

export const APP_SETTINGS_DEFAULT: StorageAppSettings = {
  localFoldersDisplaying: false,
  systemFoldersDisplaying: false,
  deviceFoldersDisplaying: true,
};

export const APP_ROUTES = {
  DASHBOARD: 'dashboard',
  SINGLE: 'single',
  DOUBLE: 'double',
} as const;

export const AUTOMATIC_DOWNLOAD_FILE_LIMIT_SIZE = 3145728; // 3 * 1024 * 1024

export const USER_FS = 'user-synced' as string;
export const USER_LOCAL_FS = 'user-local' as string;
export const USER_DEVICE_FS = 'user-device' as string;
export const START_OF_SYSTEM_FS_ID = 'system-';
export const END_OF_ROOT_FOLDER_ID = '-root';
export const USER_TRASH_FOLDER = 'user-synced-trash' as string;
export const USER_TRASH_LOCAL_FOLDER = 'user-local-trash' as string;

export const APP_FS_ITEMS: `${'user' | 'system'}:${StorageType}`[] = [
  'user:synced',
  'user:local',
  'user:device',
  'system:synced',
  'system:local',
  'system:device',
];

export const FS_ITEM_INITIALIZE_BY_USE: Record<'user' | 'system', 'getUserFS' | 'getSysFS'> = {
  user: 'getUserFS',
  system: 'getSysFS',
};

export const DEFAULT_FOLDERS: RootFsFolderView[] = [
  {
    id: `${USER_FS}-root`,
    fsId: USER_FS,
    name: 'fs.folder_name.user_synced_home',
    icon: 'outline-cloud',
    isSyncAvailable: true,
  },
  {
    id: `${USER_LOCAL_FS}-root`,
    fsId: USER_LOCAL_FS,
    name: 'fs.folder_name.user_local_home',
    icon: 'round-home',
    isSyncAvailable: false,
  },
  // {
  //   id: 'user-recent',
  //   fsId: [USER_FS, USER_LOCAL_FS],
  //   name: 'fs.folder_name.user_synced_recent',
  //   icon: 'round-schedule',
  //   disabled: true,
  // },
  {
    id: USER_TRASH_FOLDER,
    fsId: USER_FS,
    name: 'fs.folder_name.user_synced_trash',
    icon: 'cloud-remove',
  },
  {
    id: USER_TRASH_LOCAL_FOLDER,
    fsId: USER_LOCAL_FS,
    name: 'fs.folder_name.user_local_trash',
    icon: 'outline-delete',
  },
];

export const STUCK_SYNCHRONIZATION_TIME_CHECKING = 120000;
