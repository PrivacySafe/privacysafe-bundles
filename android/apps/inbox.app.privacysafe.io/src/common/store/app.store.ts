/*
 Copyright (C) 2024-2025 3NSoft Inc.

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
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { inboxSrv } from '@common/services/services-provider';
import { SystemSettings, getActiveTheme } from '@common/utils/ui-settings';
import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';
import type { AvailableLanguage, ConnectivityStatus, AppState, AppConfig } from '@common/types';
import type { SyncActivityView } from '@deno/services/sync/sync-activity';
import { blobFromDataURL } from '../utils/image-files';

export const useAppStore = defineStore('app', () => {
  const appVersion = ref<string>('');
  const connectivityStatus = ref<string>('offline');
  const user = ref<string>('');
  const lang = ref<AvailableLanguage>('en');
  const colorTheme = ref<ThemeId>('dark');
  const customLogoSrc = ref<string>();
  const appWindowSize = ref<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const commonLoading = ref<boolean>(false);
  const isMobileMode = ref<boolean>(false);
  const appState = ref<AppState>({
    lastReceivingTimestamp: 0,
  });
  /**
   * What synchronization with the user's other devices is doing.
   *
   * Both asked for once and subscribed to: events are built only while a GUI is
   * attached, and the backend's catch-up scan often finishes before this page
   * subscribes. `seq` settles the race - a snapshot never overwrites a newer
   * event.
   */
  const syncActivity = ref<SyncActivityView>({
    seq: 0,
    syncing: false,
    pending: 0,
    phase: 'idle',
    stalled: false,
  });

  async function getAppVersion() {
    const v = await w3n.myVersion();
    if (v) {
      appVersion.value = v;
    }
  }

  async function getConnectivityStatus() {
    const status = await w3n.connectivity!.isOnline();
    if (status) {
      const parsedStatus = status.split('_');
      connectivityStatus.value = parsedStatus[0] as ConnectivityStatus;
    }
  }

  async function getUser() {
    user.value = await w3n.mailerid!.getUserId();
  }

  async function getAppState() {
    appState.value = await inboxSrv.getAppState();
  }

  // Merges, and does not replace: the `app-state` event carries whatever the
  // backend happened to change, so assigning it whole would drop every field
  // that event did not mention.
  function applyAppState(state: Partial<AppState>) {
    appState.value = { ...appState.value, ...state };
  }

  async function getSyncActivityState() {
    applySyncActivity(await inboxSrv.getSyncActivityState());
  }

  function applySyncActivity(view: SyncActivityView) {
    if (view.seq >= syncActivity.value.seq) {
      syncActivity.value = view;
    }
  }

  function setAppWindowSize({ width = 0, height = 0 }) {
    appWindowSize.value = {
      ...appWindowSize.value,
      ...(width && { width }),
      ...(height && { height }),
    };
  }

  function setCommonLoading(value: boolean) {
    commonLoading.value = value;
  }

  function setMobileMode(value: boolean) {
    isMobileMode.value = value;
  }

  function setLang(value: AvailableLanguage) {
    lang.value = value;
  }

  function setColorTheme(theme: ThemeId) {
    colorTheme.value = theme;
  }

  async function setCustomLogo(dataURL: AppConfig['customLogo']): Promise<void> {
    if (dataURL) {
      try {
        const imgBlob = blobFromDataURL(dataURL);
        customLogoSrc.value = URL.createObjectURL(imgBlob);
      } catch (err) {
        console.error(`Parsing dataURL with customLogo throws error:`, err);
      }
    } else {
      customLogoSrc.value = undefined;
    }
  }

  /**
   * Held here rather than in the page: the config is read and watched in one
   * place, so a value arriving later goes through the same setters as the first
   * read, and the subscription has an owner that can end it.
   */
  let unsubFromConfigWatch: (() => void) | undefined = undefined;

  async function readAndStartWatchingAppConfig(): Promise<void> {
    try {
      const config = await SystemSettings.makeResourceReader();
      const { lang, colorTheme, customLogo } = await config.getAll();
      setLang(lang);
      setColorTheme(getActiveTheme(colorTheme));
      setCustomLogo(customLogo);

      unsubFromConfigWatch?.();
      unsubFromConfigWatch = config.watchConfig({
        next: appConfig => {
          const { lang, colorTheme, customLogo } = appConfig;
          setLang(lang);
          setColorTheme(getActiveTheme(colorTheme));
          setCustomLogo(customLogo);
        },
      });
    } catch (e) {
      console.error('Load the app config error: ', e);
    }
  }

  function stopWatchingAppConfig(): void {
    unsubFromConfigWatch?.();
    unsubFromConfigWatch = undefined;
  }

  async function setAppState(state: Partial<AppState>) {
    applyAppState(state);
  }

  return {
    appVersion,
    isMobileMode,
    connectivityStatus,
    user,
    lang,
    colorTheme,
    appWindowSize,
    commonLoading,
    customLogoSrc,
    appState,
    syncActivity,
    getSyncActivityState,
    applySyncActivity,
    getAppVersion,
    getConnectivityStatus,
    getUser,
    getAppState,
    applyAppState,
    setAppWindowSize,
    setCommonLoading,
    setMobileMode,
    setLang,
    setColorTheme,
    setCustomLogo,
    readAndStartWatchingAppConfig,
    stopWatchingAppConfig,
    setAppState,
  };
});
