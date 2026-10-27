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
import { isUploadingNewVersion, syncUpload } from './sync-service.utils/sync-upload.ts';
import { isIpcConnectionLost } from '../../shared/utils/ipc/ipc-connection-lost.ts';
import { syncAdopt } from './sync-service.utils/sync-adopt.ts';
import { syncDownload } from './sync-service.utils/sync-download.ts';

const MAX_ATTEMPTS = 3;
// An item that used up its attempts blocks its parents; it gets a new series of
// attempts after this delay, as there is no manual "retry" in the GUI.
const FAILED_ITEM_RETRY_DELAY = 10 * 60 * 1000;
// The platform reports only a successful end of an upload ('upload-done'); a failed upload
// gives no event (platform report 4, P14). Running uploads are checked by status this often.
const RUNNING_UPLOADS_CHECK_INTERVAL = 15 * 1000;

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

  /*
   Only one queue pass runs at a time. A request that comes during a pass is
   remembered and served by a new pass right after the current one. An abort
   (connection lost) bumps the generation, so the running pass stops at its
   next step instead of overlapping with the pass started after reconnection.
  */
  let processing: Promise<void> | null = null;
  let rerunRequested = false;
  let processingGeneration = 0;
  /*
   Known connection state: checked by a server request once at the start, then
   kept up to date by the connectivity watcher and by connection errors of sync
   calls. Queue steps read it instead of asking the server for every item.
  */
  let isServerConnectionAvailable = false;
  let isInitialScanDone = false;

  const syncQueue = new Map<string, SyncQueueItem>();

  /** Items left 'inProgress' while their upload runs: path → time the upload was seen started. */
  const runningUploads = new Map<string, number>();
  /** Running uploads that the last check found ended while the entity is still unsynced. */
  const uploadsSeenEnded = new Set<string>();
  let runningUploadsCheckTimer: ReturnType<typeof setTimeout> | null = null;

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
    // the action never rejects: a failed write must not cancel the writes chained after it
    await singleProc.startOrChain(async () => {
      try {
        await appLocalFs.writeJSONFile(SYNC_QUEUE_DATA_FILE, dataToSave);
      } catch (err) {
        await w3n.log('error', 'Error while saving the sync queue data file. ', err);
      }
    });
  }

  // A busy queue changes all the time; maxWait keeps the file from staying stale
  // for long, so less is lost if the process ends before a save.
  const debouncedSaveSyncQueueFileData = debounce(
    () => {
      saveSyncQueueFileData();
    },
    1000,
    { maxWait: 5000 },
  );

  async function getSyncQueue(): Promise<Record<string, SyncQueueItem>> {
    return Object.fromEntries(syncQueue);
  }

  async function isSyncQueueItemPresence(path: string): Promise<boolean> {
    return syncQueue.has(formatPath(path));
  }

  // Queue keys are always normalized: '/a', './a' and 'a' are the same entity.
  // An item in progress is not turned back to 'pending': that would start its action
  // again while the running one (e.g. an upload) is not finished. The end of the
  // running action checks the state and queues the item again if needed.
  async function addSyncQueueItem(item: SyncQueueItem) {
    const path = formatPath(item.path);
    const existing = syncQueue.get(path);
    syncQueue.set(path, {
      ...item,
      ...(existing?.status === 'inProgress' ? { status: 'inProgress', attempts: existing.attempts } : {}),
      path,
      lastChanged: Date.now(),
    });

    if (isServerConnectionAvailable) {
      planSync();
    }

    debouncedSaveSyncQueueFileData();
  }

  async function updateSyncQueueItem(item: SyncQueueItem, withoutEmitEvent?: boolean) {
    const path = formatPath(item.path);
    syncQueue.set(path, {
      ...item,
      path,
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

  async function deleteSyncQueueItem(rawPath: string) {
    const path = formatPath(rawPath);
    untrackRunningUpload(path);
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
      processQueue().catch(err => w3n.log('error', 'Error while processing the sync queue. ', err));
    }, ms);
  }

  function resetInProgressItems(): boolean {
    runningUploads.clear();
    uploadsSeenEnded.clear();
    let changed = false;
    for (const item of syncQueue.values()) {
      if (item.status === 'inProgress') {
        syncQueue.set(item.path, {
          ...item,
          status: 'pending',
        });
        changed = true;
      }
    }
    return changed;
  }

  function abortProcessing(reason?: string) {
    console.warn('⛔ Reason for abortion of processing: ', reason);
    processingGeneration += 1;

    if (resetInProgressItems()) {
      debouncedSaveSyncQueueFileData();
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
    if (!isServerConnectionAvailable) {
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

  /**
   * Adopts the remote version. Throws when adoption fails, so that the caller
   * can count the attempt; on success the queue item is removed by startSyncAdopt.
   * The adoptRemote:start/end events are emitted by syncAdopt.
   */
  async function handleBehindSyncState(status: web3n.files.SyncStatus, formattedPath: string) {
    try {
      await startSyncAdopt({
        path: formattedPath,
        opts: { remoteVersion: status.remote!.latest },
        stopErrorPropagate: false,
      });
    } catch (err) {
      // The platform can reject after the version has been adopted (its cleanup of
      // removed children fails). Then there is nothing to repeat.
      const statusAfter = await userSyncedFs.v?.sync?.status(formattedPath).catch(() => undefined);
      if (statusAfter && statusAfter.state !== 'behind') {
        await w3n.log('error', `Adoption of '${formattedPath}' reported an error, but the version is adopted. `, err);
        await deleteSyncQueueItem(formattedPath);
        planSync(100);
        return;
      }
      throw err;
    }

    const entityStats = await userSyncedFs.stat(formattedPath);

    if (entityStats.isFolder) {
      const folderList = await userSyncedFs.listFolder(formattedPath);
      // only files are downloaded automatically; every access to a node may hit a platform
      // inconsistency (see the platform report, P2), so folders and links are not touched
      for (const item of folderList.filter(i => i.isFile)) {
        const itemPath = `${formattedPath}/${item.name}`;
        try {
          const itemStats = await userSyncedFs.stat(itemPath);
          await actionAfterAdopt(itemPath, itemStats);
        } catch (err) {
          // a broken child must not keep the adopted folder in the queue
          await w3n.log('error', `Error checking '${itemPath}' after adoption of its folder. `, err);
        }
      }

      await deleteSyncQueueItem(formattedPath);
    } else if (entityStats.isFile) {
      await actionAfterAdopt(formattedPath, entityStats);
    }
  }

  /**
   * Starts the action for an item that is 'inProgress'. Every outcome either
   * finishes the item, returns it to 'pending', or leaves it 'inProgress' only
   * while an upload is running (it is finished by the 'upload-done' event).
   * Errors are thrown to the caller, which counts the failed attempt.
   */
  async function startSyncAction(status: web3n.files.SyncStatus, path: string) {
    const formattedPath = formatPath(path);

    switch (status.state) {
      case 'unsynced': {
        const upload = await startSyncUpload({ path: formattedPath, stopErrorPropagate: false });
        if (upload) {
          trackRunningUpload(formattedPath);
        } else {
          // nothing to upload, e.g. the version has been uploaded meanwhile
          await onSyncDone(formattedPath);
        }
        return;
      }

      case 'behind': {
        await handleBehindSyncState(status, formattedPath);
        return;
      }

      case 'conflicting': {
        emitStorageEvent({
          event: 'arose:conflict',
          payload: { path: formattedPath },
        });
        await deleteSyncQueueItem(formattedPath);
        return;
      }

      case 'synced': {
        // the entity itself is synced, but its children in the queue go first
        const item = syncQueue.get(formattedPath);
        if (item) {
          await updateSyncQueueItem({ ...item, status: 'pending' }, true);
        }
        return;
      }
    }
  }

  function errorMessageOf(err: unknown): string {
    return (err as Error)?.message || JSON.stringify(err);
  }

  async function handleSyncStep(path: string) {
    const formattedPath = formatPath(path);
    const item = syncQueue.get(formattedPath);
    if (!item || item.status !== 'pending') {
      return 'continue';
    }

    item.status = 'inProgress';
    await updateSyncQueueItem(item);

    let fsEntitySyncStatus: web3n.files.SyncStatus | undefined;
    try {
      fsEntitySyncStatus = await userSyncedFs.v?.sync?.status(formattedPath);
    } catch (err) {
      if ((err as web3n.files.FileException).notFound) {
        console.warn(`The FS entity '${formattedPath}' may have been removed`);
        await onSyncDone(formattedPath);
        return 'continue';
      }

      if ((err as web3n.ConnectException).type === 'connect') {
        // not a failure of this item: the pass resumes when the connection is back
        isServerConnectionAvailable = false;
        abortProcessing('Connection lost during synchronization');
        return 'break';
      }

      console.error(`🔥 Error (${item.attempts}/${MAX_ATTEMPTS}) for '${path}' . `, err);
      onSyncFailed(formattedPath, errorMessageOf(err));
      // a status request fails mostly because of the server, so the pass stops
      return 'break';
    }

    // An upload is reported before its server transaction starts (`uploadStarted` is false
    // then); starting another upload in that window is refused with `alreadyUploading`.
    if (isUploadingNewVersion(fsEntitySyncStatus)) {
      // stays 'inProgress' until the 'upload-done' event or the check of running uploads
      trackRunningUpload(formattedPath);
      return 'continue';
    }

    const allItems = Array.from(syncQueue.values());
    const hasAnyChildrenInQueue = allItems.some(i =>
      formattedPath === '' ? i.path !== '' : i.path.startsWith(`${formattedPath}/`),
    );

    if (!fsEntitySyncStatus || (fsEntitySyncStatus.state === 'synced' && !hasAnyChildrenInQueue)) {
      await onSyncDone(formattedPath);
      return 'continue';
    }

    try {
      await startSyncAction(fsEntitySyncStatus, formattedPath);
    } catch (err) {
      console.error(`🔥 Sync action error (${item.attempts}/${MAX_ATTEMPTS}) for '${path}' . `, err);
      onSyncFailed(formattedPath, errorMessageOf(err));
    }
    return 'continue';
  }

  function processQueue(): Promise<void> {
    if (processing) {
      rerunRequested = true;
      return processing;
    }

    processing = runQueuePass().finally(() => {
      processing = null;
      if (rerunRequested) {
        rerunRequested = false;
        planSync(100);
      }
    });
    return processing;
  }

  async function runQueuePass() {
    const generation = processingGeneration;

    if (!isServerConnectionAvailable) {
      console.warn('No connection, processing delayed.');
      return;
    }

    expandParents();

    const localTasks = getReadyToSyncList();
    for (const task of localTasks) {
      if (generation !== processingGeneration) {
        // aborted: items were returned to 'pending' and will be handled by the next pass
        break;
      }

      if (!isServerConnectionAvailable) {
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
  }

  async function onSyncDone(path: string) {
    await deleteSyncQueueItem(path);
    planSync(100);
  }

  /**
   * The finished upload may be older than the current local version: the
   * entity could have been changed while it was uploading, or a remote change
   * could have come. Then the item stays in the queue for the next action.
   */
  async function onUploadDone(path: string) {
    const item = syncQueue.get(path);
    if (item) {
      try {
        const status = await userSyncedFs.v?.sync?.status(path);
        if (status && status.state !== 'synced') {
          const isUploading = isUploadingNewVersion(status);
          if (!isUploading) {
            untrackRunningUpload(path);
          }
          await updateSyncQueueItem({ ...item, status: isUploading ? 'inProgress' : 'pending' }, true);
          planSync(100);
          return;
        }
      } catch (err) {
        console.error(`🔥 Error checking the status of '${path}' after its upload. `, err);
      }
    }

    await onSyncDone(path);
  }

  function onSyncFailed(path: string, error?: string) {
    const formattedPath = formatPath(path);
    untrackRunningUpload(formattedPath);
    const item = syncQueue.get(formattedPath);
    if (item) {
      item.status = 'pending';
      item.attempts += 1;
      item.lastError = error;
      item.lastChanged = Date.now();
      syncQueue.set(formattedPath, item);
      emitStorageEvent({
        event: 'sync_queue:item:update',
        payload: { item },
      });

      if (item.attempts >= MAX_ATTEMPTS) {
        handlePermanentFailure(item);
        scheduleFailedItemRetry(formattedPath);
      }

      debouncedSaveSyncQueueFileData();
    }
    planSync(2000);
  }

  function trackRunningUpload(path: string) {
    if (!runningUploads.has(path)) {
      runningUploads.set(path, Date.now());
    }
    scheduleRunningUploadsCheck();
  }

  function untrackRunningUpload(path: string) {
    runningUploads.delete(path);
    uploadsSeenEnded.delete(path);
  }

  function scheduleRunningUploadsCheck() {
    if (runningUploadsCheckTimer) {
      return;
    }
    runningUploadsCheckTimer = setTimeout(() => {
      checkRunningUploads()
        .catch(err => w3n.log('error', 'Error while checking the running uploads. ', err))
        .finally(() => {
          runningUploadsCheckTimer = null;
          if (runningUploads.size > 0) {
            scheduleRunningUploadsCheck();
          }
        });
    }, RUNNING_UPLOADS_CHECK_INTERVAL);
  }

  /**
   * Finishes the items whose upload has ended without the 'upload-done' event: the platform
   * sends no event for a failed upload (platform report 4, P14), and without this check the
   * item would stay 'inProgress' until the app is restarted.
   */
  async function checkRunningUploads() {
    if (!isServerConnectionAvailable) {
      // a running upload waits for the connection; a lost one is reset by abortProcessing
      return;
    }

    for (const [path, seenAt] of Array.from(runningUploads.entries())) {
      if (Date.now() - seenAt < RUNNING_UPLOADS_CHECK_INTERVAL) {
        continue;
      }
      if (syncQueue.get(path)?.status !== 'inProgress') {
        untrackRunningUpload(path);
        continue;
      }

      let status: web3n.files.SyncStatus | undefined;
      try {
        status = await userSyncedFs.v?.sync?.status(path, true);
      } catch (err) {
        if ((err as web3n.files.FileException).notFound) {
          await onSyncDone(path);
        } else {
          await w3n.log('error', `Error checking the status of '${path}' with a running upload. `, err);
        }
        continue;
      }
      if (isUploadingNewVersion(status) || !runningUploads.has(path)) {
        // still running, or finished by 'upload-done' meanwhile
        uploadsSeenEnded.delete(path);
        continue;
      }
      if (status?.state === 'unsynced' && !uploadsSeenEnded.has(path)) {
        // A successful upload is marked as done shortly before its completion is recorded,
        // so a single check can catch it in between. A failure is decided by the next check.
        uploadsSeenEnded.add(path);
        continue;
      }

      untrackRunningUpload(path);
      emitStorageEvent({
        event: 'upload:end',
        payload: { path },
      });
      switch (status?.state) {
        case 'conflicting': {
          emitStorageEvent({
            event: 'arose:conflict',
            payload: { path },
          });
          await deleteSyncQueueItem(path);
          break;
        }

        case 'unsynced': {
          await w3n.log('error', `The upload of '${path}' has ended without completion. `);
          onSyncFailed(path, 'The upload has ended without completion.');
          break;
        }

        case 'behind': {
          // a remote version has come meanwhile; it is handled by a new pass
          const item = syncQueue.get(path);
          if (item) {
            await updateSyncQueueItem({ ...item, status: 'pending' });
          }
          planSync(100);
          break;
        }

        default: {
          await onSyncDone(path);
        }
      }
    }
  }

  function scheduleFailedItemRetry(path: string) {
    setTimeout(() => {
      const item = syncQueue.get(path);
      if (item && item.attempts >= MAX_ATTEMPTS) {
        syncQueue.set(path, { ...item, status: 'pending', attempts: 0, lastChanged: Date.now() });
        debouncedSaveSyncQueueFileData();
        if (isServerConnectionAvailable) {
          planSync(100);
        }
      }
    }, FAILED_ITEM_RETRY_DELAY);
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

  /**
   * Finds what changed while the app was not running: root-level entities that
   * are unsynced or behind, and the root itself. Runs once, at the start or,
   * when the app starts offline, when the connection appears.
   */
  async function initialScan() {
    // set before the awaits, so that a connectivity event does not start a second scan
    isInitialScanDone = true;
    try {
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

      // One broken entry must not stop the scan of the others. A lost connection
      // still stops it, so that it runs again when the connection appears.
      const results = await Promise.allSettled(promises);
      const connectionError = results.find(
        res => res.status === 'rejected' && (res.reason as web3n.ConnectException)?.type === 'connect',
      );
      if (connectionError) {
        throw (connectionError as PromiseRejectedResult).reason;
      }
      for (const [i, res] of results.entries()) {
        if (res.status === 'rejected') {
          await w3n.log('error', `Error getting the sync status of '${rootFolderList[i].name}' in the scan. `, res.reason);
        }
      }

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

      if (isSyncNecessary && isServerConnectionAvailable) {
        planSync();
      }
    } catch (err) {
      // retried when the connection appears next time
      isInitialScanDone = false;
      throw err;
    }
  }

  function handleSyncedTreeEvent(val: web3n.files.FSEvent & { type: string }) {
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
        onUploadDone(path).catch(err => w3n.log('error', `Error handling the upload end of '${path}'. `, err));
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
        onSyncDone(path).catch(err => w3n.log('error', `Error handling the download end of '${path}'. `, err));
        emitStorageEvent({
          event: 'download:end',
          payload: { path },
        });
        break;
      }

      case 'entry-renaming': {
        // windows showing the renamed folder (or a folder inside it) follow it to the new path
        const { oldName, newName } = val as web3n.files.EntryRenamingEvent;
        emitStorageEvent({
          event: 'entity:rename',
          payload: { path, oldName, newName },
        });
        break;
      }

      case 'remote-change':
      case 'remote-removal': {
        const { syncStatus } = val as web3n.files.RemoteChangeEvent | web3n.files.RemoteRemovalEvent;
        if (syncStatus.state === 'behind') {
          // adopted by the queue: one at a time, and children before parents
          addSyncQueueItem({ path, status: 'pending', attempts: 0, lastError: '', lastChanged: Date.now() }).catch(
            err => w3n.log('error', `Error queuing the remote change of '${path}'. `, err),
          );
        } else if (syncStatus.state === 'conflicting') {
          emitStorageEvent({
            event: 'arose:conflict',
            payload: { path },
          });
        }
        break;
      }

      // no default
    }
  }

  const TREE_WATCH_RETRY_MIN_DELAY = 1000;
  const TREE_WATCH_RETRY_MAX_DELAY = 60000;
  let treeWatchRetryDelay = TREE_WATCH_RETRY_MIN_DELAY;

  /**
   * Upload and download ends come only through this watcher. If it fails, it is
   * resubscribed; events missed meanwhile are covered by re-checking the items
   * that were in progress.
   */
  function watchSyncedTree() {
    const resubscribeLater = (err: unknown) => {
      if (isIpcConnectionLost(err)) {
        // nothing can be watched until the app is restarted
        w3n.log('error', 'Error watching the synced FS tree: the connection to the platform is lost. ', err);
        return;
      }
      w3n.log('error', 'Error watching the synced FS tree; it will be watched again. ', err);
      setTimeout(() => {
        watchSyncedTree();
        if (resetInProgressItems()) {
          debouncedSaveSyncQueueFileData();
        }
        planSync(100);
      }, treeWatchRetryDelay);
      treeWatchRetryDelay = Math.min(treeWatchRetryDelay * 2, TREE_WATCH_RETRY_MAX_DELAY);
    };

    try {
      userSyncedFs.watchTree('', undefined, {
        next: val => {
          treeWatchRetryDelay = TREE_WATCH_RETRY_MIN_DELAY;
          handleSyncedTreeEvent(val as web3n.files.FSEvent & { type: string });
        },
        error: resubscribeLater,
      });
    } catch (err) {
      resubscribeLater(err);
    }
  }

  async function initialize() {
    console.log(`🌼 SYNC SERVICE INITIALIZATION HAS STARTED 🌼`);
    const doesSyncQueueFileExist = await appLocalFs.checkFilePresence(SYNC_QUEUE_DATA_FILE);

    if (!doesSyncQueueFileExist) {
      await appLocalFs.writeJSONFile(SYNC_QUEUE_DATA_FILE, {});
    } else {
      await loadSyncQueueFileData();
      // no upload or adoption of this process is running yet, so nothing is in progress
      if (resetInProgressItems()) {
        debouncedSaveSyncQueueFileData();
      }
      for (const item of syncQueue.values()) {
        if (item.attempts >= MAX_ATTEMPTS) {
          scheduleFailedItemRetry(item.path);
        }
      }
    }

    isServerConnectionAvailable = await checkServerConnection(userSyncedFs);
    if (isServerConnectionAvailable) {
      await initialScan().catch(err => w3n.log('error', 'Error while scanning for unsynced changes. ', err));
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

          if (isOnline && !isInitialScanDone) {
            initialScan().catch(err => w3n.log('error', 'Error while scanning for unsynced changes. ', err));
          } else if (isOnline && syncQueue.size > 0) {
            planSync(100);
          }

          if (!isOnline) {
            abortProcessing('Connection lost (watcher)');
          }
        }
      },
    });

    watchSyncedTree();

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
