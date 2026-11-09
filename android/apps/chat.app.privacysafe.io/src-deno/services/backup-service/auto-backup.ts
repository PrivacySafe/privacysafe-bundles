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
// The automatic backup (doc/08-backup-and-restore.md §11).
//
// The chat databases live in the local storage of a device only, and a device
// that is reinstalled loses them: if no other device of the user had a chat,
// the chat is gone (2026-11-09, the chat 'mikalai' of a reinstalled phone).
// So every device regularly puts a snapshot of its chats into the user's
// synced storage - one file per device, written by that device alone - and a
// new installation restores from the files of all devices.
//
// This is NOT synchronization: changes still travel as phantoms. The file is
// written at most every AUTO_BACKUP_INTERVAL_MILLIS, and only when something
// changed.
import type {
  AppSettings,
  AutoBackupFile,
  AutoBackupInfo,
  AutoBackupListing,
  AutoBackupListItem,
  AutoBackupRestoreOutcome,
} from '../../../types/auto-backup.types.ts';
import type { DB, LocalDataStore } from '../../types/index.ts';
import type { AutoBackupState } from '../../types/delivery-srv.types.ts';
import { SingleProc } from '../../../shared-libs/processes/single.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import {
  AUTO_BACKUP_CHECK_MILLIS,
  AUTO_BACKUP_DEAD_AFTER_MILLIS,
  AUTO_BACKUP_FIRST_PASS_DELAY_MILLIS,
  AUTO_BACKUP_FIRST_RUN_RESTORE_DELAY_MILLIS,
  AUTO_BACKUP_GC_INTERVAL_MILLIS,
  AUTO_BACKUP_INTERVAL_MILLIS,
  AUTO_BACKUP_RETRY_MILLIS,
} from '../../../shared-libs/constants/auto-backup.ts';
import { buildAutoBackupFile, decodeAutoBackup, encodeAutoBackup } from './auto-backup-file.ts';
import { deviceIdOfFileName, fileNameOfDevice, type AutoBackupStorage } from './auto-backup-storage.ts';

const log = makeLogger('AutoBackup');

export type AutoBackupPassResult =
  | 'written'
  | 'unchanged'
  | 'not-due'
  | 'disabled'
  | 'busy'
  | 'restore-pending'
  | 'failed';

export interface AutoBackupSrv {
  /** Starts the timers; nothing runs before this. */
  start(): void;
  stop(): void;
  /**
   * One scheduled pass: the first-run restore if it is still to be done, then
   * this device's file if it is due and something changed, then the files of
   * dead devices. `force` skips the "due" check, not the "changed" one.
   */
  runPass(opts?: { force?: boolean }): Promise<AutoBackupPassResult>;
  getInfo(): AutoBackupInfo;
  setSettings(patch: Partial<AppSettings>): Promise<AutoBackupInfo>;
  /** Reads every file in the folder; for the window, which shows them before a restore. */
  listAutoBackups(): Promise<AutoBackupListing>;
  /**
   * Restores from the files of other devices - the ones named, or all of them.
   * This device's own file is never applied: it holds nothing this device
   * does not have.
   */
  restoreFromAutoBackups(deviceIds?: string[]): Promise<AutoBackupRestoreOutcome>;
}

export interface AutoBackupDeps {
  db: DB;
  storage: AutoBackupStorage;
  store: Pick<
    LocalDataStore,
    | 'getAppDeviceId'
    | 'nextSyncStamp'
    | 'getSyncClock'
    | 'getAppSettings'
    | 'setAppSettings'
    | 'getAutoBackupState'
    | 'setAutoBackupState'
  >;
  getAppVersion: () => Promise<string>;
  /** A call is on: a backup must not compete with its signalling for the network. */
  isBusy?: () => boolean;
  restoreFiles: (files: AutoBackupFile[]) => Promise<AutoBackupRestoreOutcome>;
  emitInfo?: (info: AutoBackupInfo) => void;
  /** Injected by the specs. */
  now?: () => number;
}

type PlatformException = { message?: unknown; type?: unknown; cause?: unknown } & Record<string, unknown>;

/** The flags a platform exception carries (`concurrentTransaction: true`, ...), minus the noise. */
function flagsOf(value: unknown): string[] {
  if (!value || (typeof value !== 'object')) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>)
    .filter(([key, flag]) => (flag === true) && (key !== 'runtimeException') && (key !== 'remoteStorage'))
    .map(([key]) => key);
}

/**
 * A line the settings dialog can show. Platform exceptions are plain objects
 * rather than Errors, and their JSON - stack included - is what the dialog
 * used to show (2026-11-09).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err && (typeof err === 'object')) {
    const exc = err as PlatformException;
    const cause = exc.cause as PlatformException | undefined;
    const text = (typeof exc.message === 'string' && exc.message)
      || (typeof cause?.message === 'string' && cause.message)
      || `${typeof exc.type === 'string' ? exc.type : 'unknown'} error`;
    const flags = [...flagsOf(exc), ...flagsOf(cause)];
    return flags.length > 0 ? `${text} (${flags.join(', ')})` : text;
  }
  return String(err);
}

/**
 * The server refused an upload because another device was writing the same
 * object at that moment - two installations started together both create the
 * folder and upload the root (2026-11-09, mock-data and mock-data1, 6 ms
 * apart). Nothing is wrong with either side, so it is worth trying again in a
 * minute rather than in an hour.
 */
export function isConcurrentWriteConflict(err: unknown): boolean {
  const exc = err as PlatformException | undefined;
  return !!exc && (typeof exc === 'object')
    && ((exc.concurrentTransaction === true)
      || ((exc.cause as PlatformException | undefined)?.concurrentTransaction === true));
}

/** How many times in a row such a conflict is retried soon; then the ordinary RETRY. */
const MAX_QUICK_RETRIES = 3;

/** Delay of such a retry: random, so that the two devices do not collide again. */
function quickRetryDelay(): number {
  return 30_000 + Math.floor(Math.random() * 60_000);
}

/**
 * Spread of the first pass. Devices started together would otherwise hit the
 * storage within milliseconds of each other - which is what they did.
 */
const FIRST_PASS_JITTER_MILLIS = 30_000;

export function autoBackupService(deps: AutoBackupDeps): AutoBackupSrv {
  const { db, storage, store } = deps;
  const now = deps.now ?? (() => Date.now());
  // Every touch of the folder goes through this one process: two operations on
  // one object of the synced storage at once end in EEXIST (П19).
  const proc = new SingleProc();
  let inProgress = false;
  let quickRetries = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let interval: ReturnType<typeof setInterval> | undefined;

  function getInfo(): AutoBackupInfo {
    const state = store.getAutoBackupState();
    const lastError = state.lastError && (!state.lastAt || (state.lastError.at > state.lastAt))
      ? state.lastError
      : undefined;
    return {
      settings: store.getAppSettings(),
      ...(state.lastAt && { lastAt: state.lastAt }),
      ...(lastError && { lastError }),
      inProgress,
    };
  }

  function emitInfo(): void {
    try {
      deps.emitInfo?.(getInfo());
    } catch {
      // A window that is not there is not this service's failure.
    }
  }

  async function updateState(change: (state: AutoBackupState) => void): Promise<void> {
    const state = store.getAutoBackupState();
    change(state);
    await store.setAutoBackupState(state);
  }

  /** Reads and checks the files of the folder; a file that cannot be read is skipped. */
  async function readFiles(
    { includeOwn, onlyDevices }: { includeOwn: boolean; onlyDevices?: string[] },
  ): Promise<{ files: AutoBackupFile[]; unreadable: number }> {
    const ownId = store.getAppDeviceId();
    const wanted = onlyDevices ? new Set(onlyDevices) : undefined;
    const files: AutoBackupFile[] = [];
    let unreadable = 0;
    for (const name of await storage.list()) {
      const deviceId = deviceIdOfFileName(name);
      if (!deviceId || (!includeOwn && (deviceId === ownId)) || (wanted && !wanted.has(deviceId))) {
        continue;
      }
      try {
        const bytes = await storage.read(name);
        if (!bytes) {
          continue;
        }
        const file = await decodeAutoBackup(bytes);
        if (file.deviceId !== deviceId) {
          throw new Error(`the file names device ${file.deviceId}`);
        }
        files.push(file);
      } catch (err) {
        unreadable += 1;
        await w3n.log('error', `Automatic backup ${name} cannot be read; it is skipped`, err);
      }
    }
    return { files, unreadable };
  }

  /**
   * The restore of a new installation. Kept pending while it fails (offline,
   * storage errors): the next pass tries again. Found nothing - nothing to
   * restore, and the device is done waiting.
   */
  async function firstRunRestore(): Promise<boolean> {
    try {
      const { files, unreadable } = await readFiles({ includeOwn: false });
      if (files.length > 0) {
        log.info(`First run: restoring from automatic backups of ${files.length} device(s)`);
        await deps.restoreFiles(files);
      } else {
        log.info(`First run: no automatic backups of other devices to restore from`
          + (unreadable ? ` (${unreadable} unreadable)` : ''));
      }
      await updateState(state => {
        delete state.restorePending;
      });
      return true;
    } catch (err) {
      await w3n.log('error', `First-run restore from automatic backups failed; it is tried again later`, err);
      return false;
    }
  }

  function isDue(state: AutoBackupState, at: number): boolean {
    if (state.lastAt && ((at - state.lastAt) < AUTO_BACKUP_INTERVAL_MILLIS)) {
      return false;
    }
    if (state.lastError && ((at - state.lastError.at) < AUTO_BACKUP_RETRY_MILLIS)) {
      return false;
    }
    return true;
  }

  /**
   * Whether anything changed since the last file. Every change made here or
   * applied from another device moves the HLC; a received message does not,
   * so the newest incoming one is compared as well.
   */
  function hasChanged(state: AutoBackupState): boolean {
    if (!state.lastAt || (state.lastSnapshotTs === undefined)) {
      return true;
    }
    if (store.getSyncClock() > state.lastSnapshotTs) {
      return true;
    }
    const latestIncoming = db.getLatestIncomingMsgTimestamp() ?? 0;
    return latestIncoming > (state.lastIncomingTs ?? 0);
  }

  async function writeOwnFile(): Promise<void> {
    // Writes are batched; without this the file lags behind the screen.
    await db.flush();
    // Taken BEFORE the read, so no record in the file carries a stamp above
    // it - and so that the clock stands at this stamp until the next change.
    const snapshotTs = await store.nextSyncStamp();
    const incomingTs = db.getLatestIncomingMsgTimestamp() ?? 0;
    const writtenAt = now();
    const deviceId = store.getAppDeviceId();
    const file = buildAutoBackupFile({
      db,
      deviceId,
      appVersion: await deps.getAppVersion(),
      snapshotTs,
      now: writtenAt,
    });
    const bytes = await encodeAutoBackup(file);
    await storage.write(fileNameOfDevice(deviceId), bytes);
    await updateState(state => {
      state.lastAt = writtenAt;
      state.lastSnapshotTs = snapshotTs;
      state.lastIncomingTs = incomingTs;
      delete state.lastError;
    });
    log.info(
      `Automatic backup written: ${file.chats.length} chat(s), ${file.msgs.length} message(s), `
        + `${file.tombstones.length} tombstone(s), ${bytes.length} byte(s)`,
    );
  }

  /**
   * Removes the files of dead devices. A file is dead when its device has
   * written nothing for AUTO_BACKUP_DEAD_AFTER_MILLIS - and it is removed only
   * while a living file (written within that time) is there. The last file is
   * therefore never removed, however old: it may be the only copy left.
   *
   * Only a device that has finished its own first-run restore gets here, so
   * what it removes it has had the chance to take in.
   */
  async function collectGarbage(at: number): Promise<void> {
    const { files } = await readFiles({ includeOwn: true });
    const isLiving = (file: AutoBackupFile) => (at - file.writtenAt) < AUTO_BACKUP_DEAD_AFTER_MILLIS;
    if (!files.some(isLiving)) {
      return;
    }
    const ownId = store.getAppDeviceId();
    for (const file of files) {
      if ((file.deviceId === ownId) || isLiving(file)) {
        continue;
      }
      try {
        await storage.remove(fileNameOfDevice(file.deviceId));
        log.info(
          `Removed the automatic backup of ${file.deviceId}: nothing written since `
            + new Date(file.writtenAt).toISOString(),
        );
      } catch (err) {
        await w3n.log('error', `Could not remove the automatic backup of ${file.deviceId}`, err);
      }
    }
  }

  async function doPass(force: boolean): Promise<AutoBackupPassResult> {
    let state = store.getAutoBackupState();
    if (state.restorePending) {
      if (!(await firstRunRestore())) {
        return 'restore-pending';
      }
      state = store.getAutoBackupState();
    }

    if (!store.getAppSettings().autoBackup) {
      return 'disabled';
    }
    if (deps.isBusy?.()) {
      return 'busy';
    }
    const at = now();
    if (!force && !isDue(state, at)) {
      return 'not-due';
    }

    let result: AutoBackupPassResult = 'unchanged';
    if (hasChanged(state)) {
      inProgress = true;
      emitInfo();
      try {
        await writeOwnFile();
        quickRetries = 0;
        result = 'written';
      } catch (err) {
        const retrySoon = isConcurrentWriteConflict(err) && (quickRetries < MAX_QUICK_RETRIES);
        await w3n.log(
          retrySoon ? 'warning' : 'error',
          retrySoon
            ? `Automatic backup met another device writing the storage at the same moment; retrying shortly`
            : `Automatic backup failed; it is tried again later`,
          err,
        );
        await updateState(s => {
          s.lastError = { at, message: errorMessage(err) };
        });
        if (retrySoon) {
          quickRetries += 1;
          schedulePass(quickRetryDelay(), true);
        }
        return 'failed';
      } finally {
        inProgress = false;
        emitInfo();
      }
    }

    // Garbage only after a file of our own is in place: it is the living file
    // the rule needs, and the removal must never leave the folder empty.
    state = store.getAutoBackupState();
    if (state.lastAt && (!state.lastGcAt || ((at - state.lastGcAt) >= AUTO_BACKUP_GC_INTERVAL_MILLIS))) {
      try {
        await collectGarbage(at);
        await updateState(s => {
          s.lastGcAt = at;
        });
      } catch (err) {
        await w3n.log('error', `Removal of dead devices' automatic backups failed`, err);
      }
    }
    return result;
  }

  function runPass({ force = false }: { force?: boolean } = {}): Promise<AutoBackupPassResult> {
    return proc.startOrChain(() => doPass(force));
  }

  function schedulePass(delay: number, force = false): void {
    const timer = setTimeout(() => {
      timers = timers.filter(t => t !== timer);
      runPass({ force }).catch(err => w3n.log('error', `Automatic backup pass failed`, err));
    }, delay);
    timers.push(timer);
  }

  function start(): void {
    const { restorePending } = store.getAutoBackupState();
    schedulePass(
      (restorePending ? AUTO_BACKUP_FIRST_RUN_RESTORE_DELAY_MILLIS : AUTO_BACKUP_FIRST_PASS_DELAY_MILLIS)
        + Math.floor(Math.random() * FIRST_PASS_JITTER_MILLIS),
    );
    interval = setInterval(() => {
      runPass().catch(err => w3n.log('error', `Automatic backup pass failed`, err));
    }, AUTO_BACKUP_CHECK_MILLIS);
  }

  function stop(): void {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers = [];
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  }

  async function setSettings(patch: Partial<AppSettings>): Promise<AutoBackupInfo> {
    const before = store.getAppSettings();
    const after = await store.setAppSettings(patch);
    if (after.autoBackup && !before.autoBackup) {
      // Turned on: a file soon, not in up to half an hour.
      schedulePass(10_000);
    }
    emitInfo();
    return getInfo();
  }

  function listAutoBackups(): Promise<AutoBackupListing> {
    return proc.startOrChain(async () => {
      const ownId = store.getAppDeviceId();
      const { files, unreadable } = await readFiles({ includeOwn: true });
      const items: AutoBackupListItem[] = files
        .map(file => ({
          deviceId: file.deviceId,
          isThisDevice: file.deviceId === ownId,
          writtenAt: file.writtenAt,
          appVersion: file.appVersion,
          chatsCount: file.chats.length,
          messagesCount: file.msgs.length,
        }))
        .sort((a, b) => b.writtenAt - a.writtenAt);
      return { items, unreadable };
    });
  }

  function restoreFromAutoBackups(deviceIds?: string[]): Promise<AutoBackupRestoreOutcome> {
    return proc.startOrChain(async () => {
      const { files } = await readFiles({ includeOwn: false, onlyDevices: deviceIds });
      if (files.length === 0) {
        return {
          devices: 0, chatsCreated: 0, chatsUpdated: 0, messagesCreated: 0, messagesUpdated: 0, skipped: 0,
        };
      }
      log.info(`Restoring from automatic backups of ${files.length} device(s), as the user asked`);
      return deps.restoreFiles(files);
    });
  }

  return {
    start,
    stop,
    runPass,
    getInfo,
    setSettings,
    listAutoBackups,
    restoreFromAutoBackups,
  };
}
