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
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import cloneDeep from 'lodash/cloneDeep';
import hasIn from 'lodash/hasIn';
import { SystemSettings, getActiveTheme } from '@/utils/ui-settings';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';
import type {
  AvailableLanguage,
  ConnectivityStatus,
  AppConfig,
  StorageAppSettings,
  StorageAppConfig,
} from '@shared/types';
import { blobFromDataURL } from '@/utils/image-files';
import { APP_SETTINGS_DEFAULT } from '@shared/constants';
import { appStorageSrv } from '@/services/services-provider';

export const useAppStore = defineStore('app', () => {
  const appVersion = ref<string>('');
  const connectivityStatus = ref<string>('offline');
  const user = ref<Nullable<string>>(null);
  const lang = ref<AvailableLanguage>('en');
  const colorTheme = ref<ThemeId>('dark');
  const customLogoSrc = ref<string>();
  const appWindowSize = ref<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  // @ts-ignore
  const operatingSystem = ref<'macos' | 'linux' | 'windows'>(navigator.userAgentData?.platform.toLowerCase());

  const appStorageSettings = ref<StorageAppSettings>(cloneDeep(APP_SETTINGS_DEFAULT));
  const commonLoading = ref<boolean>(false);

  const trashFolderName = computed(() => `.trash-folder-${user.value || ''}`);

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

  function setConnectivityStatus(value: boolean) {
    connectivityStatus.value = value ? 'online' : 'offline';
  }

  async function getUser() {
    user.value = await w3n.mailerid!.getUserId();
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

  let unsubFromConfigWatch: (() => void) | undefined = undefined;

  async function readAndStartWatchingAppConfig(): Promise<void> {
    try {
      const config = await SystemSettings.makeResourceReader();
      const { lang, colorTheme, customLogo } = await config.getAll();
      setLang(lang);
      setColorTheme(getActiveTheme(colorTheme));
      setCustomLogo(customLogo);
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

  function stopWatchingAppConfig() {
    unsubFromConfigWatch?.();
    unsubFromConfigWatch = undefined;
  }

  async function getAppStorageSettings(): Promise<StorageAppConfig> {
    const data = await appStorageSrv.loadConfigFile();
    if (data) {
      Object.keys(APP_SETTINGS_DEFAULT).forEach(field => {
        if (hasIn(data, field)) {
          appStorageSettings.value[field as keyof StorageAppSettings] = data[field as keyof StorageAppSettings];
        }
      });
    }

    return {
      ...appStorageSettings.value,
      trashFolderName: data!.trashFolderName,
    };
  }

  async function setAppStorageSettings<K extends keyof StorageAppSettings>(field: K, value: StorageAppSettings[K]) {
    const appStorageConfig = await getAppStorageSettings();

    appStorageSettings.value[field] = value;
    appStorageConfig[field] = value;
    await appStorageSrv.saveConfigFile(appStorageConfig);
  }

  return {
    appVersion,
    operatingSystem,
    connectivityStatus,
    user,
    lang,
    colorTheme,
    customLogoSrc,
    appWindowSize,
    appStorageSettings,
    commonLoading,
    trashFolderName,
    getAppVersion,
    getConnectivityStatus,
    getUser,
    setConnectivityStatus,
    setAppWindowSize,
    setCommonLoading,
    setLang,
    setColorTheme,
    setCustomLogo,
    readAndStartWatchingAppConfig,
    stopWatchingAppConfig,
    getAppStorageSettings,
    setAppStorageSettings,
  };
});
