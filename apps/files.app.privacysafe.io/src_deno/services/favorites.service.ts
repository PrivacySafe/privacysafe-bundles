/*
 Copyright (C) 2025 - 2026 3NSoft Inc.

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
/// <reference path="../../@types/platform-defs/injected-w3n.d.ts" />
import type { FavoriteFolder, StorageEvent } from '../../shared/types/index.ts';
import type { FavoritesService } from '../types.ts';
import { SingleProc } from '../../shared/utils/processes/single.ts';
import { checkServerConnection } from './sync-service.utils/check-server-connection.ts';
import { FAVORITES_DATA_FILE } from '../constants.ts';
import { randomStr } from '../../src/utils/random.ts';
import { debounce } from '../utils/debounce.ts';

export async function favoritesService({
  appSyncedFs,
  emitStorageEvent,
}: {
  appSyncedFs: web3n.files.WritableFS;
  emitStorageEvent: (event: StorageEvent) => void;
}): Promise<FavoritesService> {
  const singleProc = new SingleProc();

  let favorites = {} as Record<string, FavoriteFolder>;
  let isServerConnectionAvailable = !!(await w3n.connectivity?.isOnline())?.startsWith('online');

  async function syncFavoritesFile() {
    if (!(await checkServerConnection(appSyncedFs))) {
      return;
    }

    const fileSyncStatus = await appSyncedFs.v!.sync!.status(FAVORITES_DATA_FILE);
    if (!fileSyncStatus) {
      return;
    }

    switch (fileSyncStatus.state) {
      case 'synced': {
        const isFileOnFs = await appSyncedFs.v!.sync!.isRemoteVersionOnDisk(
          FAVORITES_DATA_FILE,
          fileSyncStatus.synced!.latest!,
        );
        if (isFileOnFs !== 'complete') {
          await appSyncedFs.v!.sync!.startDownload(FAVORITES_DATA_FILE, fileSyncStatus.synced!.latest!);
        }
        break;
      }

      case 'unsynced': {
        await appSyncedFs.v!.sync!.startUpload(FAVORITES_DATA_FILE);
        break;
      }

      case 'behind': {
        await appSyncedFs.v!.sync!.adoptRemote(FAVORITES_DATA_FILE, {
          remoteVersion: fileSyncStatus.remote!.latest,
        });
        await appSyncedFs.v!.sync!.startDownload(FAVORITES_DATA_FILE, fileSyncStatus.remote!.latest!);
        break;
      }

      case 'conflicting': {
        const remoteFileData =
          await appSyncedFs.v!.readJSONFile<Record<string, FavoriteFolder>>(FAVORITES_DATA_FILE);
        if (!remoteFileData) {
          throw `The remote file ${FAVORITES_DATA_FILE} is missing`;
        }

        const currentFileData =
          await appSyncedFs.readJSONFile<Record<string, FavoriteFolder>>(FAVORITES_DATA_FILE);
        const currentFileDataFavIds = new Set(Object.keys(currentFileData) || []);
        const updatedFavorites = [
          ...Object.values(currentFileData),
          ...(Object.values(remoteFileData.json) || []).filter(f => !currentFileDataFavIds.has(f.favId)),
        ];
        favorites = updatedFavorites.reduce(
          (res, f) => {
            res[f.favId] = f;
            return res;
          },
          {} as Record<string, FavoriteFolder>,
        );

        await saveFavoritesFileData();
        await appSyncedFs.v!.sync!.startUpload(FAVORITES_DATA_FILE, {
          uploadVersion: fileSyncStatus.remote!.latest! + 1,
        });
        break;
      }
    }

    const rootFolderStatus = await appSyncedFs.v!.sync!.status('');
    if (!rootFolderStatus) {
      return;
    }

    switch (rootFolderStatus.state) {
      case 'unsynced': {
        await appSyncedFs.v!.sync!.upload('');
       break;
      }

      case 'behind': {
        await appSyncedFs.v!.sync!.adoptRemote('');
        break;
      }

      // no default
    }
  }

  async function loadFavoritesFileData() {
    const data = await appSyncedFs.readJSONFile<Record<string, FavoriteFolder>>(FAVORITES_DATA_FILE);
    favorites = data || ({} as Record<string, FavoriteFolder>);
    emitStorageEvent({
      event: 'favorites:update',
      payload: { favorites: Object.values(favorites) },
    });
  }

  async function saveFavoritesFileData() {
    await singleProc.startOrChain(async () => {
      await appSyncedFs.writeJSONFile(FAVORITES_DATA_FILE, favorites);
    });
    emitStorageEvent({
      event: 'favorites:update',
      payload: { favorites: Object.values(favorites) },
    });
  }

  const debouncedSaveFavoritesFileData = debounce(() => saveFavoritesFileData(), 5000);

  async function checkForFavoritesDataAvailability() {
    if (!favorites || Object.values(favorites).length === 0) {
      await loadFavoritesFileData();
    }
  }

  async function getFavorites(): Promise<FavoriteFolder[]> {
    await checkForFavoritesDataAvailability();
    return Object.values(favorites);
  }

  async function getFavorite(favId: string): Promise<FavoriteFolder | undefined> {
    await checkForFavoritesDataAvailability();
    return favorites[favId];
  }

  async function addFavorite(
    fullPath: string,
    fsId: string,
    withoutSaveDbFile?: boolean,
  ): Promise<FavoriteFolder> {
    const newFavoriteItem = {
      favId: randomStr(10),
      fsId,
      fullPath,
    };

    favorites[newFavoriteItem.favId] = newFavoriteItem;

    if (!withoutSaveDbFile) {
      debouncedSaveFavoritesFileData();
    }

    emitStorageEvent({
      event: 'favorites:update',
      payload: { favorites: Object.values(favorites) },
    });

    return newFavoriteItem;
  }

  async function updateFavorite(value: FavoriteFolder): Promise<void> {
    const { favId, fsId, fullPath } = value;
    await checkForFavoritesDataAvailability();
    favorites[favId] = {
      favId,
      fsId,
      fullPath,
    };

    debouncedSaveFavoritesFileData();

    emitStorageEvent({
      event: 'favorites:update',
      payload: { favorites: Object.values(favorites) },
    });
  }

  async function deleteFavorite(favId: string, returnUpdatedList?: boolean) {
    await checkForFavoritesDataAvailability();
    delete favorites[favId];

    debouncedSaveFavoritesFileData();

    emitStorageEvent({
      event: 'favorites:update',
      payload: { favorites: Object.values(favorites) },
    });

    if (returnUpdatedList) {
      return Object.values(favorites);
    }
  }

  async function initialize() {
    const rootFolderSyncStatus = await appSyncedFs.v!.sync!.status('');
    if (rootFolderSyncStatus) {
      switch (rootFolderSyncStatus.state) {
        case 'unsynced': {
          await appSyncedFs.v!.sync!.upload('');
          break;
        }

        case 'behind': {
          await appSyncedFs.v!.sync!.adoptRemote('');
          break;
        }

        // no default
      }
    }

    const doesFavoritesDataFileExist = await appSyncedFs.checkFilePresence(FAVORITES_DATA_FILE);
    console.log('[###] doesFavoritesDataFileExist => ', doesFavoritesDataFileExist);
    if (!doesFavoritesDataFileExist) {
      await appSyncedFs.writeJSONFile(FAVORITES_DATA_FILE, {});
      if (await checkServerConnection(appSyncedFs)) {
        await appSyncedFs.v!.sync!.upload(FAVORITES_DATA_FILE);
        await appSyncedFs.v!.sync!.upload('');
      }
    } else {
      await loadFavoritesFileData();
    }

    appSyncedFs.watchFile(FAVORITES_DATA_FILE, {
      next: async val => {
        console.log(`⭐ WATCH FAVORITES FILE => `, JSON.stringify(val), '\n');
        const { type } = val;

        switch (type) {
          case 'download-done': {
            await loadFavoritesFileData();
            break;
          }

          default: {
            await syncFavoritesFile();
          }
        }
      },
      error: err => console.error('🔥 Error watching the favorites file. ', err),
    });

    w3n.connectivity?.watch({
      next: async val => {
        const { isOnline } = val;
        if (isOnline !== isServerConnectionAvailable) {
          isServerConnectionAvailable = isOnline;
          await syncFavoritesFile();
        }
      },
    });
  }

  await initialize();

  return {
    getFavorites,
    getFavorite,
    addFavorite,
    updateFavorite,
    deleteFavorite,
  };
}
