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
import { makeServiceCaller } from '@shared/utils/ipc/ipc-service-caller';
import type { StorageAppDenoService } from '@deno/types';

function showMessage() {
  const mainContainer = document.getElementById('main');
  console.log('[MAIN] => ', mainContainer);
  if (!mainContainer) {
    w3n?.closeSelf();
    return;
  }

  mainContainer.innerHTML = `
    <div
      style="
        display: flex;
        width: 100vw;
        height: 100vh;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        row-gap: 16px;
        padding: 24px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 16px;
        font-weight: 500;
        line-height: 24px;
        text-align: center;
        color: rgba(0, 0, 0, 0.87);
      "
    >
      <span>Oops...</span>
      <span>Something went wrong 🙁.</span>
      <span>The app will close in 10 seconds.</span>
      <span>Please try again later.</span>
    </div>
  `;

  setTimeout(() => {
    w3n?.closeSelf();
  }, 15000);
}

export let appStorageSrv: StorageAppDenoService;

export async function initializationServices() {
  try {
    const srvConnection = await w3n.rpc!.thisApp!('AppStorageInternal');
    appStorageSrv = makeServiceCaller<StorageAppDenoService>(srvConnection, [
      'getTrashFolderName',
      'loadConfigFile',
      'saveConfigFile',

      'getFavorites',
      'getFavorite',
      'addFavorite',
      'updateFavorite',
      'deleteFavorite',

      'getFsItem',
      'getFsList',
      'getFsRootFolderList',
      'initializeFsItems',

      'getSyncQueue',
      'isSyncQueueItemPresence',
      'addSyncQueueItem',
      'updateSyncQueueItem',
      'deleteSyncQueueItem',
      'clearSubtreeFromQueue',
      'resetItemAttempts',
      'startSyncUpload',
      'startSyncDownload',
      'startSyncAdopt',

      'setFolderAsFavorite',
      'unsetFolderAsFavorite',
      'removeFavoriteFolderFromList',

      'isEntityPresent',
      'getEntityXAttrs',
      'updateEntityXAttrs',
      'deleteEntityXAttrs',
      'getEntityStats',
      'getSyncedStatus',
      'isRemoteVersionOnDisk',
      'makeFolder',
      'getFolderContentList',
      'getFolderContentFilledList',
      'copyEntities',
      'moveEntity',
      'moveEntities',
      'copyMoveEntities',
      'renameEntity',
      'deleteEntities',
      'restoreEntities',
    ]) as StorageAppDenoService;

    console.info('<- SERVICES ARE INITIALIZED ->');
  } catch (e) {
    console.error('# ERROR WHILE SERVICES INITIALISE # ', e);
    showMessage();
  }
}
