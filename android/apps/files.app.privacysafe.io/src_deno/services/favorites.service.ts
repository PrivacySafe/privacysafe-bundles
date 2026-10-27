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
import { randomStr } from '../../shared/utils/random.ts';
import { isIpcConnectionLost } from '../../shared/utils/ipc/ipc-connection-lost.ts';

type FavoritesData = Record<string, FavoriteFolder>;

// events of our own upload/download progress: reacting to them only causes extra sync rounds
const IGNORED_FILE_EVENTS = new Set([
  'upload-started',
  'upload-progress',
  'upload-done',
  'upload-disconnected',
  'download-started',
  'download-progress',
]);

const FILE_WATCH_RETRY_DELAY = 5000;

export async function favoritesService({
  appSyncedFs,
  emitStorageEvent,
}: {
  appSyncedFs: web3n.files.WritableFS;
  emitStorageEvent: (event: StorageEvent) => void;
}): Promise<FavoritesService> {
  const singleProc = new SingleProc();

  let favorites = {} as FavoritesData;
  // An empty list is a valid state; only the very first read comes from the file.
  let isLoaded = false;
  let isServerConnectionAvailable = !!(await w3n.connectivity?.isOnline())?.startsWith('online');

  function emitFavoritesUpdate() {
    emitStorageEvent({
      event: 'favorites:update',
      payload: { favorites: Object.values(favorites) },
    });
  }

  function mergeFavorites(local: FavoritesData, remote: FavoritesData): FavoritesData {
    // A union keeps what either device added. Without deletion markers a favorite
    // deleted on one device comes back from the other one; that is preferred to
    // losing a favorite added there.
    return { ...remote, ...local };
  }

  async function syncFavoritesFile() {
    if (!(await checkServerConnection(appSyncedFs))) {
      return;
    }

    const sync = appSyncedFs.v!.sync!;
    const fileSyncStatus = await sync.status(FAVORITES_DATA_FILE);

    switch (fileSyncStatus.state) {
      case 'synced': {
        const isFileOnFs = await sync.isRemoteVersionOnDisk(FAVORITES_DATA_FILE, fileSyncStatus.synced!.latest!);
        if (isFileOnFs !== 'complete') {
          await sync.startDownload(FAVORITES_DATA_FILE, fileSyncStatus.synced!.latest!);
        }
        break;
      }

      case 'unsynced': {
        // waits for the upload: the root below can be uploaded only after the file is on the server
        await sync.upload(FAVORITES_DATA_FILE);
        break;
      }

      case 'behind': {
        const remoteVersion = fileSyncStatus.remote!.latest!;
        await sync.adoptRemote(FAVORITES_DATA_FILE, { remoteVersion });
        const download = await sync.startDownload(FAVORITES_DATA_FILE, remoteVersion);
        if (!download) {
          // the bytes are on disk already, so no 'download-done' event will come
          await loadFavoritesFileData();
        }
        break;
      }

      case 'conflicting': {
        const remoteVersion = fileSyncStatus.remote!.latest!;
        const { json: remoteFileData } = await appSyncedFs.v!.readJSONFile<FavoritesData>(FAVORITES_DATA_FILE, {
          remoteVersion,
        });
        const localFileData = await appSyncedFs.readJSONFile<FavoritesData>(FAVORITES_DATA_FILE);

        favorites = mergeFavorites(localFileData || {}, remoteFileData || {});
        await saveFavoritesFileData();
        await sync.upload(FAVORITES_DATA_FILE, { uploadVersion: remoteVersion + 1 });
        break;
      }
    }

    const rootFolderStatus = await sync.status('');
    switch (rootFolderStatus.state) {
      case 'unsynced': {
        await sync.upload('');
        break;
      }

      case 'behind': {
        await sync.adoptRemote('');
        break;
      }

      // no default
    }
  }

  /*
   Sync rounds run one at a time; a request during a round is served by one
   more round after it.
  */
  let syncRound: Promise<void> | null = null;
  let isSyncRequested = false;

  function requestFavoritesSync(): void {
    if (syncRound) {
      isSyncRequested = true;
      return;
    }

    syncRound = syncFavoritesFile()
      .catch(err => w3n.log('error', 'Error while synchronizing the favorites file. ', err))
      .finally(() => {
        syncRound = null;
        if (isSyncRequested) {
          isSyncRequested = false;
          requestFavoritesSync();
        }
      });
  }

  async function loadFavoritesFileData() {
    const data = await appSyncedFs.readJSONFile<FavoritesData>(FAVORITES_DATA_FILE);
    favorites = data || ({} as FavoritesData);
    isLoaded = true;
    emitFavoritesUpdate();
  }

  async function saveFavoritesFileData() {
    const dataToSave = { ...favorites };
    // the action never rejects: a failed write must not cancel the writes chained after it
    await singleProc.startOrChain(async () => {
      try {
        await appSyncedFs.writeJSONFile(FAVORITES_DATA_FILE, dataToSave);
      } catch (err) {
        await w3n.log('error', 'Error while saving the favorites file. ', err);
      }
    });
    emitFavoritesUpdate();
  }

  async function checkForFavoritesDataAvailability() {
    if (!isLoaded) {
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

  // Changes are saved at once: they are rare, and a delayed save could be lost
  // on exit or be overwritten by a file downloaded meanwhile.

  async function addFavorite(
    fullPath: string,
    fsId: string,
    withoutSaveDbFile?: boolean,
  ): Promise<FavoriteFolder> {
    await checkForFavoritesDataAvailability();
    const newFavoriteItem = {
      favId: randomStr(10),
      fsId,
      fullPath,
    };

    favorites[newFavoriteItem.favId] = newFavoriteItem;

    if (withoutSaveDbFile) {
      emitFavoritesUpdate();
    } else {
      await saveFavoritesFileData();
    }

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

    await saveFavoritesFileData();
  }

  async function deleteFavorite(favId: string, returnUpdatedList?: boolean) {
    await checkForFavoritesDataAvailability();
    delete favorites[favId];

    await saveFavoritesFileData();

    if (returnUpdatedList) {
      return Object.values(favorites);
    }
  }

  function watchFavoritesFile() {
    const watchAgainLater = (err: unknown) => {
      if (isIpcConnectionLost(err)) {
        // nothing can be watched until the app is restarted
        w3n.log('error', 'Error watching the favorites file: the connection to the platform is lost. ', err);
        return;
      }
      w3n.log('error', 'Error watching the favorites file; it will be watched again. ', err);
      setTimeout(watchFavoritesFile, FILE_WATCH_RETRY_DELAY);
    };

    try {
      appSyncedFs.watchFile(FAVORITES_DATA_FILE, {
        next: val => {
          const { type } = val as { type: string };

          if (type === 'download-done') {
            loadFavoritesFileData().catch(err => w3n.log('error', 'Error loading the favorites file. ', err));
          } else if (!IGNORED_FILE_EVENTS.has(type)) {
            requestFavoritesSync();
          }
        },
        error: watchAgainLater,
      });
    } catch (err) {
      watchAgainLater(err);
    }
  }

  async function initialize() {
    // the server may be unreachable at the start; the sync then happens when the connection appears
    try {
      const rootFolderSyncStatus = await appSyncedFs.v!.sync!.status('');
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
    } catch (err) {
      if ((err as web3n.ConnectException).type !== 'connect') {
        w3n.log('error', 'Error synchronizing the app synced storage root. ', err);
      }
    }

    const doesFavoritesDataFileExist = await appSyncedFs.checkFilePresence(FAVORITES_DATA_FILE);
    if (!doesFavoritesDataFileExist) {
      await appSyncedFs.writeJSONFile(FAVORITES_DATA_FILE, {});
      isLoaded = true;
      requestFavoritesSync();
    } else {
      await loadFavoritesFileData();
    }

    watchFavoritesFile();

    w3n.connectivity?.watch({
      next: val => {
        const { isOnline } = val;
        if (isOnline !== isServerConnectionAvailable) {
          isServerConnectionAvailable = isOnline;
          if (isOnline) {
            requestFavoritesSync();
          }
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
