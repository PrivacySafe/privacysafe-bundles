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
// Settings of this app on this device. They are stored by the service, which
// broadcasts every change as a 'settings' event, so that both windows - and
// this one after a change made in the other - show the same value.
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { appContactsSrvProxy } from '@main/common/services/services-provider';
import { APP_SETTINGS_DEFAULT, sanitizeAppSettings } from '@main/common/utils/app-settings';
import type { ContactsAppSettings, ContactsDateFormat } from '@main/types';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<ContactsAppSettings>({ ...APP_SETTINGS_DEFAULT });

  const dateFormat = computed<ContactsDateFormat>(() => settings.value.dateFormat);

  /** Settings as the service has them now, e.g. from a 'settings' event. */
  function applySettings(value: unknown): void {
    settings.value = sanitizeAppSettings(value);
  }

  /** Reads the stored settings; the defaults stay when they cannot be read. */
  async function loadSettings(): Promise<void> {
    try {
      applySettings(await appContactsSrvProxy.getAppSettings());
    } catch (err) {
      await w3n.log('error', 'Could not read the app settings, the defaults apply', err);
    }
  }

  /**
   * Shown at once and saved after: the service resolves with what it stored.
   * A failed save puts the previous value back and rethrows, for the caller
   * to tell the user.
   */
  async function setSetting<K extends keyof ContactsAppSettings>(
    field: K,
    value: ContactsAppSettings[K],
  ): Promise<void> {
    const previous = settings.value;
    settings.value = { ...previous, [field]: value };
    try {
      applySettings(await appContactsSrvProxy.saveAppSettings({ [field]: value }));
    } catch (err) {
      settings.value = previous;
      throw err;
    }
  }

  return {
    settings,
    dateFormat,
    applySettings,
    loadSettings,
    setSetting,
  };
});
