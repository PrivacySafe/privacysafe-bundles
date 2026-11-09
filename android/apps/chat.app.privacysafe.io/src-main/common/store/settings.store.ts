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
// The app's settings on this device, and where its automatic backup stands.
//
// The settings live in the background component, not here: it is the one
// that writes the automatic backup, and it does that with no window open. The
// window reads them, changes them through the service, and is told about
// changes with 'auto-backup' events.
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { chatService } from '@main/common/services/external-services';
import { APP_SETTINGS_DEFAULT } from '@shared/constants/auto-backup';
import { makeLogger } from '@shared/logger';
import type { AppSettings, AutoBackupInfo } from '~/auto-backup.types';

const log = makeLogger('Settings');

export const useSettingsStore = defineStore('settings', () => {
  const autoBackupInfo = ref<AutoBackupInfo>({
    settings: { ...APP_SETTINGS_DEFAULT },
    inProgress: false,
  });

  function applyAutoBackupInfo(info: AutoBackupInfo): void {
    autoBackupInfo.value = info;
  }

  async function loadSettings(): Promise<void> {
    try {
      applyAutoBackupInfo(await chatService.getAutoBackupInfo());
    } catch (err) {
      log.error('Could not read the app settings; the defaults are shown', err);
    }
  }

  async function setSetting<K extends keyof AppSettings>(field: K, value: AppSettings[K]): Promise<void> {
    const before = autoBackupInfo.value;
    // At once, so the switch does not lag behind the click.
    autoBackupInfo.value = { ...before, settings: { ...before.settings, [field]: value } };
    try {
      applyAutoBackupInfo(await chatService.setAppSettings({ [field]: value }));
    } catch (err) {
      autoBackupInfo.value = before;
      log.error(`Could not change the setting ${field}`, err);
      throw err;
    }
  }

  return {
    autoBackupInfo,
    applyAutoBackupInfo,
    loadSettings,
    setSetting,
  };
});
