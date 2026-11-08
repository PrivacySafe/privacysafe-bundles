/*
 Copyright (C) 2020 - 2025 3NSoft Inc.

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
import { ChatIdObj } from "./asmail-msgs.types";

export type IncomingMessage = web3n.asmail.IncomingMessage;
export type AttachmentsContainer = web3n.asmail.AttachmentsContainer;
export type FS = web3n.files.FS;
export type FileW = web3n.files.File;
export type ReadonlyFS = web3n.files.ReadonlyFS;
export type WritableFS = web3n.files.WritableFS;
export type ReadonlyFile = web3n.files.ReadonlyFile;
export type WritableFile = web3n.files.WritableFile;

export interface FileWithId extends ReadonlyFile {
  fileId: string;
}

export interface ReadonlyFsWithId extends ReadonlyFS {
  id: string;
}

export interface WritableFsWithId extends WritableFS {
  id: string;
}

export type AvailableLanguage = 'en';

export type ConnectivityStatus = 'offline' | 'online';

export interface MessageDeliveryStatusUI {
  icon: string;
  color: string;
}

export interface AppConfig {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
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

export interface Ui3nTextEnterEvent {
  value: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * What the avatar menu can ask for. One list for the desktop menu and the phone
 * drawer, so the two cannot drift apart in what they offer.
 */
export type AppMenuAction = 'make-backup' | 'restore-backup' | 'exit';

export interface AppMenuItem {
  id: AppMenuAction;
  icon: string;
  label: string;
}

export interface AppGlobalEvents {
  'message:sent': { chatId: ChatIdObj; };
  'message:added': { chatId: ChatIdObj };
}

export type Task = () => Promise<void>;

export interface TaskRunnerInstance {
  addTask: (task: Task) => void;
  cancelTasks: () => void;
}
