/*
 Copyright (C) 2025 3NSoft Inc.

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
import {
  APP_FS_ITEMS,
  FS_ITEM_INITIALIZE_BY_USE,
  DEFAULT_FOLDERS,
  USER_FS,
  USER_LOCAL_FS,
} from '../../shared/constants/index.ts';
import type { FsListItem, RootFsFolderView, StorageType, WritableFS } from '../../shared/types/index.ts';
import type { FsStore } from '../types.ts';

export async function prepareFsListAndFsRootFolderList(): Promise<FsStore> {
  const fsList: Record<string, FsListItem> = {};
  const fsRootFolderList: RootFsFolderView[] = [];

  async function getFsItem(fsId: string): Promise<FsListItem> {
    const fs = fsList[fsId];
    if (!fs) {
      throw new Error(`No FS found for id ${fsId}`);
    }

    return fs;
  }

  async function getFsList(): Promise<Record<string, FsListItem>> {
    return fsList;
  }

  async function getFsRootFolderList(): Promise<RootFsFolderView[]> {
    return fsRootFolderList;
  }

  function prepareFsRootFolderList() {
    for (const folder of DEFAULT_FOLDERS) {
      fsRootFolderList.push(JSON.parse(JSON.stringify(folder)));
    }

    Object.keys(fsList).forEach(fsId => {
      if (![USER_FS, USER_LOCAL_FS].includes(fsId)) {
        const fsRootFolder: RootFsFolderView = {
          id: `${fsId}-root`,
          fsId,
          name: fsList[fsId].name,
          icon: fsId.includes('system') ? 'round-folder-data' : 'outline-hard-drive',
        };
        fsRootFolderList.push(fsRootFolder);
      }
    });
  }

  async function initializeFsItems() {
    for (const itemKind of APP_FS_ITEMS) {
      const [itemUse, itemType] = itemKind.split(':') as ['user' | 'system', StorageType];
      const initFunction = FS_ITEM_INITIALIZE_BY_USE[itemUse];
      const fsItem = await w3n.storage![initFunction]!(itemType);

      if (fsItem.isCollection) {
        const items = await (fsItem.item as web3n.files.FSCollection).getAll();
        for (const val of items) {
          if (!val[1].isCollection) {
            const fsId = `${itemUse}-${itemType}-${val[0]
              .replaceAll(' ', '_')
              .replace(/[.*+?^$&{}()|[\]\\]/g, '')
              .toLowerCase()}`;
            fsList[fsId] = {
              fsId,
              name: `${val[0]} (${itemUse}, ${itemType})`,
              entity: val[1].item as WritableFS,
            };
          }
        }
      } else {
        const fsId = `${itemUse}-${itemType}`;
        fsList[fsId] = {
          fsId,
          name: `${(fsItem.item as WritableFS).name} (${itemUse}, ${itemType})`,
          entity: fsItem.item as WritableFS,
        };
      }
    }

    prepareFsRootFolderList();
  }

  await initializeFsItems();

  return {
    fsList,
    fsRootFolderList,
    getFsItem,
    getFsList,
    getFsRootFolderList,
    initializeFsItems,
  };
}
