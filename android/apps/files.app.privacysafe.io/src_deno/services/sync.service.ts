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
/// <reference path="../../@types/deft-plus__reactivity/index.d.ts" />
import type { StorageEvent, SyncQueueItem } from '../../shared/types/index.ts';
import type { SyncService } from '../types.ts';
import { SYNC_QUEUE_DATA_FILE } from '../constants.ts';
import { debounce } from '../utils/debounce.ts';
import { getParentPath } from '../../shared/utils/fs-utils/get-parent-path.ts';
import { round } from '../../shared/utils/round.ts';
import { formatPath } from '../../shared/utils/various.ts';
import { SingleProc } from '../../shared/utils/processes/single.ts';
import { AUTOMATIC_DOWNLOAD_FILE_LIMIT_SIZE } from '../../shared/constants/index.ts';
import { checkServerConnection } from './sync-service.utils/check-server-connection.ts';
import { syncUpload } from './sync-service.utils/sync-upload.ts';
import { syncAdopt } from './sync-service.utils/sync-adopt.ts';
import { syncDownload } from './sync-service.utils/sync-download.ts';

const MAX_ATTEMPTS = 3;

export async function syncService({
  appLocalFs,
  userSyncedFs,
  emitStorageEvent,
}: {
  appLocalFs: web3n.files.WritableFS;
  userSyncedFs: web3n.files.WritableFS;
  emitStorageEvent: (event: StorageEvent) => void;
}): Promise<SyncService> {
  const singleProc = new SingleProc();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  let isProcessing = false;
  let isServerConnectionAvailable = false;

  const syncQueue = new Map<string, SyncQueueItem>();

  function getReadyToSyncList(): SyncQueueItem[] {
    const allItems = Array.from(syncQueue.values());
    return allItems
      .filter(item => {
        if (item.status !== 'pending' || item.attempts >= MAX_ATTEMPTS) {
          return false;
        }

        const hasActiveChild = allItems.some(i => {
          const isDirectChild =
            item.path === ''
              ? i.path !== '' && !i.path.includes('/')
              : i.path.startsWith(`${item.path}/`) && i.path.replace(`${item.path}/`, '').indexOf('/') === -1;

          return isDirectChild;
        });

        return !hasActiveChild;
      })
      .sort((a, b) => {
        const depthA = a.path === '' ? 0 : a.path.split('/').length;
        const depthB = b.path === '' ? 0 : b.path.split('/').length;

        if (depthB !== depthA) {
          return depthB - depthA;
        }

        return a.attempts - b.attempts;
      });
  }

  async function loadSyncQueueFileData() {
    try {
      syncQueue.clear();
      const data = await appLocalFs.readJSONFile<Record<string, SyncQueueItem>>(SYNC_QUEUE_DATA_FILE);
      for (const [key, value] of Object.entries(data)) {
        syncQueue.set(key, value);
      }
    } catch (err) {
      console.error('Error while loading the sync queue data file. ', err);
      emitStorageEvent({
        event: 'fs_sync:error',
        payload: { failedAction: 'Queue loading' },
      });
    }
  }

  async function saveSyncQueueFileData() {
    const dataToSave = Object.fromEntries(syncQueue);
    await singleProc.startOrChain(async () => await appLocalFs.writeJSONFile(SYNC_QUEUE_DATA_FILE, dataToSave));
    // console.log(
    //   '⛳ SYNC QUEUE SAVED SUCCESSFULLY. ',
    //   JSON.stringify(Object.values(dataToSave).map(i => [i.path, i.status])),
    // );
  }

  const debouncedSaveSyncQueueFileData = debounce(() => {
    saveSyncQueueFileData();
  }, 5000);

  async function getSyncQueue(): Promise<Record<string, SyncQueueItem>> {
    return Object.fromEntries(syncQueue);
  }

  async function isSyncQueueItemPresence(path: string): Promise<boolean> {
    return syncQueue.has(path);
  }

  async function addSyncQueueItem(item: SyncQueueItem) {
    syncQueue.set(item.path, {
      ...item,
      lastChanged: Date.now(),
    });

    if (await checkServerConnection(userSyncedFs)) {
      planSync();
    }

    debouncedSaveSyncQueueFileData();
  }

  async function updateSyncQueueItem(item: SyncQueueItem, withoutEmitEvent?: boolean) {
    syncQueue.set(item.path, {
      ...item,
      lastChanged: Date.now(),
    });

    if (!withoutEmitEvent) {
      emitStorageEvent({
        event: 'sync_queue:item:update',
        payload: { item },
      });
    }

    debouncedSaveSyncQueueFileData();
  }

  async function deleteSyncQueueItem(path: string) {
    const res = syncQueue.delete(path);
    if (res) {
      emitStorageEvent({
        event: 'sync_queue:item:remove',
        payload: { path },
      });
      debouncedSaveSyncQueueFileData();
    }
  }

  async function clearSubtreeFromQueue(parentPath: string) {
    const formattedPath = formatPath(parentPath);
    let changed = false;

    for (const path of syncQueue.keys()) {
      const isTarget = path === formattedPath;
      const isChild = formattedPath === '' ? path !== '' : path.startsWith(`${formattedPath}/`);

      if (isTarget || isChild) {
        syncQueue.delete(path);
        changed = true;
      }
    }

    if (changed) {
      debouncedSaveSyncQueueFileData();
    }
  }

  function expandParents() {
    let changed = false;
    const currentPaths = Array.from(syncQueue.keys());

    for (const path of currentPaths) {
      if (path === '') {
        continue;
      }

      const parent = getParentPath(path);
      if (parent !== null && !syncQueue.has(parent)) {
        const newItem: SyncQueueItem = {
          path: parent,
          status: 'pending',
          attempts: 0,
          lastError: '',
          lastChanged: Date.now(),
        };
        syncQueue.set(newItem.path, newItem);
        changed = true;
      }
    }

    if (changed) {
      debouncedSaveSyncQueueFileData();
    }
  }

  function planSync(ms = 500) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      processQueue();
    }, ms);
  }

  function abortProcessing(reason?: string) {
    console.warn('⛔ Reason for abortion of processing: ', reason);
    isProcessing = false;

    for (const item of syncQueue.values()) {
      if (item.status === 'inProgress') {
        syncQueue.set(item.path, {
          ...item,
          status: 'pending',
        });
      }
    }
  }

  function handlePermanentFailure(item: SyncQueueItem) {
    console.error(`FS object ${item.path} could not be synchronized after ${MAX_ATTEMPTS} attempts.`);
    emitStorageEvent({
      event: 'sync:error',
      payload: {
        path: item.path,
        message: `FS object ${item.path} could not be synchronized after ${MAX_ATTEMPTS} attempts.`,
      },
    });
  }

  async function resetItemAttempts(path: string): Promise<void> {
    if (!(await checkServerConnection(userSyncedFs))) {
      return;
    }

    const formattedPath = formatPath(path);
    const item = syncQueue.get(formattedPath);
    if (item) {
      syncQueue.set(formattedPath, {
        ...item,
        status: 'pending',
        attempts: 0,
        lastError: '',
        lastChanged: Date.now(),
      });

      debouncedSaveSyncQueueFileData();
      planSync(100);
    }
  }

  async function actionAfterAdopt(path: string, stats: web3n.files.Stats) {
    if (stats?.isFile) {
      const entitySyncStatus = await userSyncedFs.v?.sync?.status(path);
      if (entitySyncStatus?.state === 'behind' && stats.size! <= AUTOMATIC_DOWNLOAD_FILE_LIMIT_SIZE) {
        startSyncDownload({ path, version: entitySyncStatus.remote!.latest! });
      }
    }
  }

  async function handleBehindSyncState(status: web3n.files.SyncStatus, formattedPath: string) {
    emitStorageEvent({
      event: 'adoptRemote:start',
      payload: { path: formattedPath },
    });
    await startSyncAdopt({ path: formattedPath, opts: { remoteVersion: status.remote!.latest } });
    emitStorageEvent({
      event: 'adoptRemote:end',
      payload: { path: formattedPath },
    });

    const entityStats = await userSyncedFs.stat(formattedPath);
    // console.log(`🎈 HANDLE BEHIND, ENTITY STATS FOR '${formattedPath}' => `, JSON.stringify(entityStats));

    if (entityStats.isFolder) {
      const folderList = await userSyncedFs.listFolder(formattedPath);
      for (const item of folderList) {
        const itemPath = `${formattedPath}/${item.name}`;
        const itemStats = await userSyncedFs.stat(itemPath);
        await actionAfterAdopt(itemPath, itemStats);
      }

      await deleteSyncQueueItem(formattedPath);
    } else if (entityStats.isFile) {
      await actionAfterAdopt(formattedPath, entityStats);
    }
  }

  async function startSyncAction(status: web3n.files.SyncStatus, path: string) {
    const formattedPath = formatPath(path);

    if (status.state === 'unsynced') {
      return startSyncUpload({ path: formattedPath, stopErrorPropagate: false }).catch(err =>
        console.error('🔥 UNSYNCED HANDLE: ', JSON.stringify(err, null, 2)),
      );
    }

    if (status.state === 'behind') {
      handleBehindSyncState(status, formattedPath);
      return;
    }

    if (status.state === 'conflicting') {
      emitStorageEvent({
        event: 'arose:conflict',
        payload: { path: formattedPath },
      });
      await deleteSyncQueueItem(formattedPath);
      return;
    }
  }

  async function handleSyncStep(path: string) {
    const formattedPath = formatPath(path);
    const item = syncQueue.get(formattedPath);
    if (!item || item.status !== 'pending') {
      return 'continue';
    }

    item.status = 'inProgress';
    await updateSyncQueueItem(item);

    try {
      const fsEntitySyncStatus = await userSyncedFs.v?.sync?.status(formattedPath);
      if (fsEntitySyncStatus && fsEntitySyncStatus.uploading?.uploadStarted) {
        await updateSyncQueueItem({
          ...item,
          status: 'inProgress',
        });
        return 'continue';
      }

      const allItems = Array.from(syncQueue.values());
      const hasAnyChildrenInQueue = allItems.some(i =>
        formattedPath === '' ? i.path !== '' : i.path.startsWith(`${formattedPath}/`),
      );

      if (!fsEntitySyncStatus || (fsEntitySyncStatus?.state === 'synced' && !hasAnyChildrenInQueue)) {
        await onSyncDone(formattedPath);
        return 'continue';
      }

      await startSyncAction(fsEntitySyncStatus, formattedPath);
    } catch (err) {
      if ((err as web3n.files.FileException).notFound) {
        // TODO проверить
        console.warn(`The FS entity '${formattedPath}' may have been removed`);
        await onSyncDone(formattedPath);
        return 'continue';
      }

      console.error(`🔥 Error (${item.attempts}/${MAX_ATTEMPTS}) for '${path}' . `, err);
      // @ts-ignore
      onSyncFailed(formattedPath, err.message || JSON.stringify(err));
      return 'break';
    }
  }

  async function processQueue() {
    if (isProcessing) {
      return;
    }

    if (!(await checkServerConnection(userSyncedFs))) {
      console.warn('No connection, processing delayed.');
      return;
    }

    isProcessing = true;
    expandParents();

    console.log(
      '⭐ QUEUE => ',
      JSON.stringify(Array.from(syncQueue.values()).map(i => [i.path, i.status, i.attempts])),
    );

    const localTasks = getReadyToSyncList();
    console.log('💢 LOCAL TASKS => ', JSON.stringify(localTasks.map(i => [i.path, i.status, i.attempts])));
    for (const task of localTasks) {
      if (!(await checkServerConnection(userSyncedFs))) {
        abortProcessing('Connection lost during synchronization');
        break;
      }

      if (!syncQueue.has(task.path)) {
        continue;
      }

      const res = await handleSyncStep(task.path);
      if (res === 'break') {
        break;
      }
    }

    isProcessing = false;
  }

  async function onSyncDone(path: string) {
    await deleteSyncQueueItem(path);
    planSync(100);
  }

  function onSyncFailed(path: string, error?: string) {
    const formattedPath = formatPath(path);
    const item = syncQueue.get(formattedPath);
    if (item) {
      item.status = 'pending';
      item.attempts += 1;
      item.lastError = error;
      item.lastChanged = Date.now();
      syncQueue.set(formattedPath, item);

      if (item.attempts >= MAX_ATTEMPTS) {
        handlePermanentFailure(item);
      }

      debouncedSaveSyncQueueFileData();
    }
    planSync(2000);
  }

  async function startSyncUpload({
    path,
    opts,
    stopErrorPropagate = true,
  }: {
    path: string;
    opts?: web3n.files.OptionsToUploadLocal;
    stopErrorPropagate?: boolean;
  }) {
    const formattedPath = formatPath(path);
    return syncUpload({
      fs: userSyncedFs,
      path: formattedPath,
      opts,
      emitEvent: emitStorageEvent,
      stopErrorPropagate,
    });
  }

  async function startSyncDownload({
    path,
    version,
    stopErrorPropagate = true,
  }: {
    path: string;
    version: number;
    stopErrorPropagate?: boolean;
  }) {
    const formattedPath = formatPath(path);
    return syncDownload({
      fs: userSyncedFs,
      path: formattedPath,
      version,
      emitEvent: emitStorageEvent,
      stopErrorPropagate,
    });
  }

  async function startSyncAdopt({
    path,
    opts,
    stopErrorPropagate = true,
  }: {
    path: string;
    opts?: web3n.files.OptionsToAdopteRemote;
    stopErrorPropagate?: boolean;
  }) {
    const formattedPath = formatPath(path);
    await syncAdopt({
      fs: userSyncedFs,
      path: formattedPath,
      opts,
      emitEvent: emitStorageEvent,
      stopErrorPropagate,
      actionIfSuccess: async () => {
        await deleteSyncQueueItem(path);
        planSync(100);
      },
    });
  }

  async function initialize() {
    console.log(`🌼 SYNC SERVICE INITIALIZATION HAS STARTED 🌼`);
    const doesSyncQueueFileExist = await appLocalFs.checkFilePresence(SYNC_QUEUE_DATA_FILE);

    if (!doesSyncQueueFileExist) {
      await appLocalFs.writeJSONFile(SYNC_QUEUE_DATA_FILE, {});
    } else {
      await loadSyncQueueFileData();
    }

    console.log(
      '🌼 QUEUE (from file) ',
      JSON.stringify(Array.from(syncQueue.values()).map(i => [i.path, i.status])),
    );

    if (await checkServerConnection(userSyncedFs)) {
      if (syncQueue.size > 0) {
        const allItems = Array.from(syncQueue.values());
        let changes = false;
        for (const item of allItems) {
          if (item.status === 'conflicting') {
            const itemSyncStatus = await userSyncedFs.v!.sync!.status(item.path);
            if (itemSyncStatus.state !== 'conflicting') {
              syncQueue.delete(item.path);
              changes = true;
            }
          }
        }
        if (changes) {
          debouncedSaveSyncQueueFileData();
        }

        emitStorageEvent({
          event: 'sync_queue:update',
          payload: { syncQueue: Object.fromEntries(syncQueue) },
        });
      }

      const rootFolderList = await userSyncedFs.listFolder('');
      const rootFolderSyncStatus = await userSyncedFs.v!.sync!.status('');

      let isSyncNecessary = syncQueue.size > 0;
      const promises = rootFolderList.map(entity =>
        userSyncedFs.v!.sync!.status(entity.name).then(syncStatus => {
          const formatted = formatPath(entity.name);
          if (['unsynced', 'behind'].includes(syncStatus.state)) {
            syncQueue.set(formatted, {
              path: formatted,
              status: 'pending',
              attempts: 0,
              lastError: '',
              lastChanged: Date.now(),
            });
            isSyncNecessary = true;
          } else {
            if (syncQueue.has(formatted)) {
              syncQueue.delete(formatted);
            }
          }
        }),
      );

      await Promise.all(promises);

      if (['unsynced', 'behind'].includes(rootFolderSyncStatus.state)) {
        syncQueue.set('', {
          path: '',
          status: 'pending',
          attempts: 0,
          lastError: '',
          lastChanged: Date.now(),
        });
        isSyncNecessary = true;
      } else {
        if (syncQueue.has('')) {
          syncQueue.delete('');
        }
      }

      if (isSyncNecessary && (await checkServerConnection(userSyncedFs))) {
        planSync();
      }
    }

    w3n.connectivity?.watch({
      next: async val => {
        const { isOnline } = val;

        if (isOnline !== isServerConnectionAvailable) {
          isServerConnectionAvailable = isOnline;
          emitStorageEvent({
            event: 'connectivity:change',
            payload: { isOnline },
          });

          if (isOnline && syncQueue.size > 0) {
            planSync(100);
          }

          if (!isOnline) {
            abortProcessing('Connection lost (watcher)');
          }
        }
      },
    });

    userSyncedFs.watchTree('', undefined, {
      next: async val => {
        console.log(`⭐ WATCH TREE => `, JSON.stringify(val), '\n');
        const { type, path: pathFromEvent } = val;
        const path = formatPath(pathFromEvent);

        switch (type) {
          case 'upload-started': {
            emitStorageEvent({
              event: 'upload:start',
              payload: { path },
            });
            break;
          }

          case 'upload-progress': {
            const { bytesLeftToUpload, totalBytesToUpload } = val as web3n.files.UploadProgressEvent;
            const progress = round((totalBytesToUpload - bytesLeftToUpload) / totalBytesToUpload, -3);
            emitStorageEvent({
              event: 'upload:progress',
              payload: { path, progress },
            });
            break;
          }

          case 'upload-done': {
            onSyncDone(path);
            emitStorageEvent({
              event: 'upload:end',
              payload: { path },
            });
            break;
          }

          case 'download-started': {
            emitStorageEvent({
              event: 'download:start',
              payload: { path },
            });
            break;
          }

          case 'download-progress': {
            const { bytesLeftToDownload, totalBytesToDownload } = val as web3n.files.DownloadProgressEvent;
            const progress = round((totalBytesToDownload - bytesLeftToDownload) / totalBytesToDownload, -3);
            emitStorageEvent({
              event: 'download:progress',
              payload: { path, progress },
            });
            break;
          }

          case 'download-done': {
            onSyncDone(path);
            emitStorageEvent({
              event: 'download:end',
              payload: { path },
            });
            break;
          }

          case 'remote-change': {
            const { syncStatus } = val as web3n.files.RemoteChangeEvent;
            console.log('🎃 REMOTE_CHANGE: ', path, JSON.stringify(syncStatus));

            if (syncStatus.state === 'behind') {
              handleBehindSyncState(syncStatus, path);
            }

            break;
          }

          // no default
        }
      },
      error: err => console.error('🔥 Error watching the synced FS tree. ', err),
    });

    console.log('🌼 SYNC SERVICE INITIALIZATION IS COMPLETE 🌼 ');
  }

  await initialize();

  return {
    getSyncQueue,
    isSyncQueueItemPresence,
    addSyncQueueItem,
    updateSyncQueueItem,
    deleteSyncQueueItem,
    clearSubtreeFromQueue,
    resetItemAttempts,
    startSyncUpload,
    startSyncDownload,
    startSyncAdopt,
  };
}
