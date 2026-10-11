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
import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';

export type AvailableLanguage = 'en';

export type ConnectivityStatus = 'offline' | 'online';

export interface AppConfig {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
  systemFoldersDisplaying?: boolean;
  customLogo?: string;
}

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
