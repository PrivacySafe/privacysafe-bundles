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

import { toRO } from "@main/common/utils/readonly.ts";
import { getActiveTheme, SystemSettings } from "@main/common/utils/ui-settings.ts";
import { ref } from "vue";
import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';
import { AppConfig, AvailableLanguage, SettingsJSON } from '~/app.types.ts';
import { blobFromDataURL } from '@main/common/utils/image-files.ts';
import { makeLogger, setDebugLogging } from '@shared/logger';

const log = makeLogger('AppConfig');

export function useSystemLevelAppConfig() {

  const appVersion = ref<string>('');
  const user = ref<string>('');
  const lang = ref<AvailableLanguage>('en');
  const colorTheme = ref<ThemeId>('dark');
  const customLogoSrc = ref<string>();

  function setLang(value: AvailableLanguage) {
    lang.value = value;
  }

  /**
   * Only the id is kept here. Putting a class on <html> is the theme plugin's
   * job, and windows tie this ref to it with useThemeSync.
   */
  function setColorTheme(theme: ThemeId) {
    colorTheme.value = theme;
  }

  async function setCustomLogo(dataURL: AppConfig['customLogo']): Promise<void> {
    if (dataURL) {
      try {
        const imgBlob = blobFromDataURL(dataURL);
        customLogoSrc.value = URL.createObjectURL(imgBlob);
      } catch (err) {
        log.error('Parsing dataURL with customLogo throws error.' , err);
      }
    } else {
      customLogoSrc.value = undefined;
    }
  }

  let unsubFromConfigWatch: (() => void)|undefined = undefined;

  /**
   * The app's "developer mode" flag doubles as the switch for diagnostic
   * logging (see shared-libs/logger.ts) - it is watched here, so that turning
   * it on in the launcher takes effect without restarting anything.
   */
  function applyDebugLoggingFlag(config: Partial<SettingsJSON>): void {
    setDebugLogging(!!config.allowShowingDevtool);
  }

  async function readAndStartWatchingAppConfig() {
    try {
      const config = await SystemSettings.makeResourceReader();
      const settings = await config.getAll();
      const { lang, colorTheme, customLogo } = settings;
      setLang(lang);
      setColorTheme(getActiveTheme(colorTheme));
      setCustomLogo(customLogo);
      applyDebugLoggingFlag(settings);
      unsubFromConfigWatch = config.watchConfig({
        next: appConfig => {
          const { lang, colorTheme, customLogo } = appConfig;
          setLang(lang);
          setColorTheme(getActiveTheme(colorTheme));
          setCustomLogo(customLogo);
          applyDebugLoggingFlag(appConfig as Partial<SettingsJSON>);
        },
      });
    } catch (e) {
      log.error('Load the app config error. ', e);
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

      readAndStartWatchingAppConfig()
    ]);
  }

  async function stopWatching() {
    unsubFromConfigWatch?.();
  }

  return {
    appVersion: toRO(appVersion),
    user: toRO(user),
    lang: toRO(lang),
    colorTheme: toRO(colorTheme),
    customLogoSrc: toRO(customLogoSrc),

    initialize,
    stopWatching
  };
}
