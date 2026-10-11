/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

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

import { defineStore } from 'pinia';
import { makeAppSize } from './app/app-size';
import { makeConnectivityStatus } from './app/connectivity';
import { makeSystemLevelAppConfig } from './app/system-level-app-config';
import { SettingsJSON, makeAppConfigsInternal } from '@/common/store/app/ui-settings';

export const useAppStore = defineStore('app', () => {
  const appSize = makeAppSize();
  const { appElement } = appSize;

  const connectivity = makeConnectivityStatus();
  const { connectivityStatus } = connectivity;

  const commonAppConfs = makeSystemLevelAppConfig();
  const { appVersion, user, lang, colorTheme, systemFoldersDisplaying, allowShowingDevtool, customLogoSrc } =
    commonAppConfs;

  async function initialize() {
    await Promise.all([connectivity.initialize(), commonAppConfs.initialize()]);
  }

  function stopWatching() {
    appSize.stopWatching();
    connectivity.stopConnectivityCheck();
    commonAppConfs.stopWatching();
  }

  async function updateSettings(appConfig: Partial<SettingsJSON>) {
    const config = await makeAppConfigsInternal();
    const updatedAppConfig = {
      ...(await config.getAll()),
      ...appConfig,
    };
    await config.saveSettingsFile(updatedAppConfig);
  }

  return {
    appElement,
    appVersion,
    user,
    lang,
    colorTheme,
    systemFoldersDisplaying,
    allowShowingDevtool,
    connectivityStatus,
    customLogoSrc,
    initialize,
    stopWatching,
    updateSettings,
  };
});
