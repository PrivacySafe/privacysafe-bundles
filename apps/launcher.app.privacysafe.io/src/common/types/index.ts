/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';

export interface AppInfo {
  readonly appId: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly tags?: string[];

  readonly publisher?: string;

  readonly website?: string;

  readonly contact?: string;

  readonly policy?: string;

  readonly terms?: string;

  readonly license?: string;

  readonly source?: string;

  iconBytes?: Uint8Array;
  readonly versions: {
    latest: string;
    current?: string;
    bundled?: string;
    packs?: string[];
    afterRestart?: string;
  };
  updates?: ChannelVersion[];
  updateFromBundle?: string;
}

export interface ChannelVersion {
  channel: string;
  version: string;
}

export interface Launcher extends web3n.caps.Launcher {
  iconBytes?: Uint8Array;
}

export interface AppLaunchers {
  appId: string;
  version: string;
  name: string;
  tags?: string[];
  description: string;
  icon: string;
  iconBytes?: Uint8Array;
  defaultLauncher?: Launcher;
  staticLaunchers: Launcher[];
  dynamicLaunchers: Launcher[];
}

export type AvailableLanguage = 'en';

export interface AppConfig {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
  systemFoldersDisplaying?: boolean;
  allowShowingDevtool?: boolean;
  customLogo?: string;
}

export type ConnectivityStatus = 'offline' | 'online';

export interface GlobalEvents {
  'init-setup:start': {
    bundledAppsForInstall: string[];
  };
  'init-setup:done': null;
  'platform:restart-to-update': null;
}

export interface AppEventData {
  appId: string | null;
  version: string;
}
