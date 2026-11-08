/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/
import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';
import type { AppConfig, AvailableLanguage } from '@/common/types';
import { SingleProc } from '@v1nt1248/3nclient-lib/utils';

export interface AppConfigsInternal {
  getAll: () => Promise<SettingsJSON>;
  saveSettingsFile: (data: AppConfig) => Promise<void>;
  getCurrentLanguage: () => Promise<AvailableLanguage>;
  getCurrentColorTheme: () => Promise<ThemeId>;
  getSystemFoldersDisplaying: () => Promise<boolean>;
  getAllowShowingDevtool: () => Promise<boolean>;
}

export interface AppConfigs {
  getCurrentLanguage: () => Promise<AvailableLanguage>;
  getCurrentColorTheme: () => Promise<ThemeId>;
  getSystemFoldersDisplaying: () => Promise<boolean>;
  getAllowShowingDevtool: () => Promise<boolean>;
  getAll: () => Promise<SettingsJSON>;
  watchConfig(obs: web3n.Observer<AppConfig>): () => void;
}

export interface SettingsJSON {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
  systemFoldersDisplaying: boolean;
  allowShowingDevtool: boolean;
  customLogo: AppConfig['customLogo'];
}

export interface AppSettings {
  currentConfig: SettingsJSON;
}

const resourceName = 'ui-settings';
const resourceApp = 'launcher.app.privacysafe.io';
const settingsPath = '/constants/settings.json';

export async function makeAppConfigsInternal(): Promise<AppConfigsInternal> {
  // this implicitly initializes resource, and will fail if it isn't launcher
  await w3n.shell!.getFSResource!(undefined, resourceName);
  const localStore = await w3n.storage!.getAppLocalFS!();

  const syncProc = new SingleProc();
  const file = await localStore.writableFile(settingsPath);
  if (file.isNew) {
    const defaultSettings = await (await fetch(settingsPath)).json();
    await file.writeJSON(defaultSettings);
  }

  async function saveSettingsFile(data: AppConfig): Promise<void> {
    const settingsJSON = data as SettingsJSON;
    await syncProc.startOrChain(() => file.writeJSON(settingsJSON));
  }

  return {
    saveSettingsFile,
    ...makeAppConfsReader(file),
  };
}

type ReadonlyFile = web3n.files.ReadonlyFile;

function makeAppConfsReader(file: ReadonlyFile): AppConfigs {
  async function getCurrentLanguage(): Promise<AvailableLanguage> {
    const { lang } = await file.readJSON<SettingsJSON>();
    return lang;
  }

  async function getCurrentColorTheme(): Promise<ThemeId> {
    const { colorTheme } = await file.readJSON<SettingsJSON>();
    return colorTheme;
  }

  async function getSystemFoldersDisplaying(): Promise<boolean> {
    const { systemFoldersDisplaying } = await file.readJSON<SettingsJSON>();
    return systemFoldersDisplaying;
  }

  async function getAllowShowingDevtool(): Promise<boolean> {
    const { allowShowingDevtool } = await file.readJSON<SettingsJSON>();
    return allowShowingDevtool;
  }

  async function getAll(): Promise<SettingsJSON> {
    return await file.readJSON<SettingsJSON>();
  }

  function watchConfig(obs: web3n.Observer<AppConfig>): () => void {
    return file.watch({
      next: obs.next
        ? async event => {
            if (event.type === 'file-change') {
              const confs = await getAll();
              obs.next!({ ...confs });
            }
          }
        : undefined,
      complete: obs.complete,
      error: obs.error,
    });
  }

  return {
    getAll,
    getAllowShowingDevtool,
    getCurrentColorTheme,
    getCurrentLanguage,
    getSystemFoldersDisplaying,
    watchConfig,
  };
}

export async function makeAppConfigs(): Promise<AppConfigs> {
  const confFile = (await w3n.shell!.getFSResource!(resourceApp, resourceName)) as ReadonlyFile;
  return makeAppConfsReader(confFile);
}
