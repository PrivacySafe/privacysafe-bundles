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
import { CONFIG_FILE, TRASH_FOLDER_NAME_PREFIX } from '../constants.ts';
import type { StorageAppConfig } from '../../shared/types/index.ts';
import type { AppConfigService } from '../types.ts';

export async function appConfigService(): Promise<AppConfigService> {
  const appLocalFs = await w3n.storage!.getAppLocalFS();

  let trashFolderName = '';

  async function getDefaultTrashFolderName(): Promise<string> {
    const user = await w3n.mailerid?.getUserId().catch(err => {
      w3n.log('error', 'Error getting the user id for the trash folder name. ', err);
      return undefined;
    });
    return `${TRASH_FOLDER_NAME_PREFIX}-${user || ''}`;
  }

  /**
   * The trash folder name must never be empty: with an empty name "delete"
   * would move entities to the root folder instead of the trash.
   */
  async function initialize() {
    try {
      const isPresentConfigFile = await appLocalFs.checkFilePresence(CONFIG_FILE);
      const configFileData = isPresentConfigFile ? await loadConfigFile() : undefined;
      if (configFileData?.trashFolderName) {
        trashFolderName = configFileData.trashFolderName;
        return;
      }

      trashFolderName = await getDefaultTrashFolderName();
      // a config that could not be read is not overwritten, to keep its other settings
      if (!isPresentConfigFile || configFileData) {
        await appLocalFs.writeJSONFile(CONFIG_FILE, { ...configFileData, trashFolderName });
      }
    } catch (err) {
      w3n.log('error', 'Error making the config file. ', err);
      if (!trashFolderName) {
        trashFolderName = await getDefaultTrashFolderName();
      }
    }
  }

  async function loadConfigFile(): Promise<StorageAppConfig | undefined> {
    try {
      return await appLocalFs.readJSONFile(CONFIG_FILE);
    } catch (err) {
      w3n.log('error', 'Error loading the config file. ', err);
    }
  }

  async function saveConfigFile(value: StorageAppConfig): Promise<void> {
    try {
      return await appLocalFs.writeJSONFile(CONFIG_FILE, value);
    } catch (err) {
      w3n.log('error', 'Error saving the config file. ', err);
    }
  }

  async function getTrashFolderName(): Promise<string> {
    return trashFolderName;
  }

  await initialize();

  return {
    appLocalFs,
    trashFolderName,
    getTrashFolderName,
    loadConfigFile,
    saveConfigFile,
  };
}
