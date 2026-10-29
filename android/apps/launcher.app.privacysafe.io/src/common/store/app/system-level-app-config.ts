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
import { inject, ref } from 'vue';
import { THEME_KEY, type ThemeId, type ThemePlugin } from '@v1nt1248/3nclient-lib/plugins';
import { makeAppConfigs } from '@/common/store/app/ui-settings';
import { blobFromDataURL } from '@/common/utils/image-files';
import type { AppConfig, AvailableLanguage } from '@/common/types';

function getActiveTheme(value: ThemeId | 'default' | 'dark1' | 'dark2'): ThemeId {
  if (value === 'default') {
    return 'light';
  }

  if (value === 'dark1' || value === 'dark2') {
    return 'dark';
  }

  return value;
}

export function makeSystemLevelAppConfig() {
  const { setTheme } = inject<ThemePlugin>(THEME_KEY)!;
  const appVersion = ref<string>('');
  const user = ref<string>('');
  const lang = ref<AvailableLanguage>('en');
  const colorTheme = ref<ThemeId>('dark');
  const systemFoldersDisplaying = ref(false);
  const allowShowingDevtool = ref(false);
  const customLogoSrc = ref<string>();

  function setLang(value: AvailableLanguage) {
    lang.value = value;
  }

  function setColorTheme(theme: ThemeId) {
    colorTheme.value = theme;
    setTheme(theme);
  }

  function setSystemFoldersDisplaying(value: boolean) {
    systemFoldersDisplaying.value = value;
  }

  function setAllowShowingDevtool(value: boolean) {
    allowShowingDevtool.value = value;
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

  async function readAndStartWatchingAppConfig() {
    try {
      const config = await makeAppConfigs();
      const { lang, colorTheme, systemFoldersDisplaying, allowShowingDevtool, customLogo } = await config.getAll();
      setLang(lang);
      const theme = getActiveTheme(colorTheme);
      setColorTheme(theme);
      setSystemFoldersDisplaying(systemFoldersDisplaying);
      setAllowShowingDevtool(allowShowingDevtool);
      setCustomLogo(customLogo);

      unsubFromConfigWatch = config.watchConfig({
        next: appConfig => {
          const { lang, colorTheme, systemFoldersDisplaying, allowShowingDevtool, customLogo } = appConfig;
          setLang(lang);
          setColorTheme(getActiveTheme(colorTheme));
          setSystemFoldersDisplaying(!!systemFoldersDisplaying);
          setAllowShowingDevtool(!!allowShowingDevtool);
          setCustomLogo(customLogo);
        },
      });
    } catch (e) {
      console.error('Load the app config error: ', e);
    }
  }

  async function initialize(): Promise<void> {
    await Promise.all([
      w3n.myVersion().then(v => {
        appVersion.value = v;
      }),

      w3n.mailerid!.getUserId().then(addr => {
        user.value = addr;
      }),

      readAndStartWatchingAppConfig(),
    ]);
  }

  async function stopWatching() {
    unsubFromConfigWatch?.();
  }

  return {
    appVersion,
    user,
    lang,
    colorTheme,
    systemFoldersDisplaying,
    allowShowingDevtool,
    customLogoSrc,

    initialize,
    stopWatching,
  };
}
