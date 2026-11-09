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
import type { AppSettings } from '../../types/auto-backup.types.ts';
import type { AutoBackupState } from './delivery-srv.types.ts';

export interface LocalDataStore {
  getAppDeviceId(): string;
  /**
   * Starts watching for another app instance using this same local data folder,
   * which would share this device's identity. Calls back once, and only in that
   * (misconfigured) case; the returned function stops the watch.
   */
  startForeignInstanceWatch(onForeign: (foreignStamp: string) => void): () => void;
  getLastReceivedMessageTimestamp(): number;
  setLastReceivedMessageTimestamp(ts: number): Promise<void>;
  nextSyncStamp(): Promise<number>;
  /** The hybrid logical clock as it stands: the greatest stamp issued or seen here. */
  getSyncClock(): number;
  observeSyncStamp(ts: number): Promise<void>;
  /**
   * Whether a phantom from another device of this user has ever been seen here.
   * The synchronization indicator stays silent until it has: a user with one
   * device synchronizes with nobody, and every phantom in their inbox is their
   * own copy coming back.
   */
  hasSeenOtherDevice(): boolean;
  noteOtherDeviceSeen(deviceId: string): Promise<void>;
  nextCallSessionId(hostAddr: string): Promise<string>;
  /**
   * Whether this device should ask its siblings for all of their chats now:
   * it is new and has had no answer yet, and the last ask is old enough (see
   * chat-resync.ts). Ends the wait once the asking window is over.
   */
  isInitialChatsSnapshotAskDue(now?: number): Promise<boolean>;
  noteInitialChatsSnapshotAsked(requestId: string, now?: number): Promise<void>;
  /** Ends the wait if `requestId` is one of this device's asks; returns whether it did. */
  noteInitialChatsSnapshotAnswered(requestId: string): Promise<boolean>;
  /** Whether this device has already answered the 'resync:chats' ask. */
  wasChatsResyncAnswered(requestId: string): boolean;
  noteChatsResyncAnswered(requestId: string, now?: number): Promise<void>;
  /**
   * The blacklist as it was last seen, or undefined when none was ever stored.
   *
   * The two answers must stay distinguishable: an empty list means "nobody was
   * blocked when we last looked", while undefined means "we have never looked".
   * The blacklist tracker turns the first into a delta and the second into a
   * baseline - conflating them would make the first run of a build read every
   * already-blocked contact as blocked just now.
   */
  /** Settings with the defaults filled in. */
  getAppSettings(): AppSettings;
  setAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  getAutoBackupState(): AutoBackupState;
  setAutoBackupState(state: AutoBackupState): Promise<void>;
  getCachedBlacklist(): string[] | undefined;
  setCachedBlacklist(list: string[]): Promise<void>;
}
