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

/** This device's side of the automatic backup (see backup-service/auto-backup.ts). */
export interface AutoBackupState {
  /** When this device's file was last uploaded (wall clock). */
  lastAt?: number;
  /** HLC stamp of the last uploaded file: a greater clock means something changed since. */
  lastSnapshotTs?: number;
  /**
   * Newest incoming message at the last upload. Received messages do not move
   * the HLC, so the clock alone would miss a day of nothing but incoming mail.
   */
  lastIncomingTs?: number;
  /** The last failure; dropped by the next success. */
  lastError?: { at: number; message: string };
  /** When files of dead devices were last looked for. */
  lastGcAt?: number;
  /**
   * Set on a new device (no local data file yet): it restores from the
   * automatic backups of the user's devices before writing one of its own.
   * Removed once that restore has run, or found nothing to restore.
   */
  restorePending?: true;
}

export interface DeliveryServiceData {
  appDeviceId: string;
  lastReceivedMessageTimestamp: number;
  /**
   * Stamp of the run of the background component that wrote this file last.
   * Backs the detection of a second app instance started on the same data
   * folder, which would share this file's appDeviceId and make synchronization
   * between devices impossible (see startForeignInstanceWatch).
   */
  instanceStamp?: string;
  /**
   * Highest synchronization stamp this device has either issued or seen in a
   * received phantom. Backs the hybrid logical clock that orders changes
   * between devices of the same user (see nextSyncStamp/observeSyncStamp).
   */
  lastSyncClockTs?: number;
  /**
   * Number of call sessions this device has ever hosted. Backs the counter part
   * of WebRTCMsg.callSessionId, and is persisted so that a restart of the
   * background component cannot hand out an id a previous call already used.
   */
  lastCallSessionCounter?: number;
  /**
   * The first phantom from another device of this user that this device ever
   * saw - the only proof the app has that the user synchronizes with anything
   * at all. Until it exists, the synchronization indicator stays silent: a user
   * with one device has nobody to synchronize with, and every phantom in their
   * inbox is their own copy coming back to them.
   *
   * The device id and the time, rather than a bare flag, for the same reason
   * `appDeviceId` is printed at start-up: when something looks wrong, the
   * question is always *which* device and *when*.
   */
  otherDeviceSeen?: {
    deviceId: string;
    at: number;
  };
  /**
   * Written by 0.12.38 on the first run of a device; read only to carry such
   * a device over into initialChatsSnapshot below.
   */
  initialChatsSnapshotPending?: true;
  /**
   * Present while this device - new when this file was created - still waits
   * for its first answer to the 'resync:chats' ask for all chats. Removed when
   * an answer to any of its asks arrives, or when the asking window is over.
   *
   * Kept until an ANSWER, not until the ask is sent: when the ask goes out,
   * the other devices may be switched off or on a build that does not know
   * the ask (2026-11-09: the phone was on an older build, and the desktop's
   * single ask was never answered). The ask is repeated on later starts (see
   * chat-resync.ts). A file written by an older build has no such field and
   * never asks for everything: that device is not new.
   */
  initialChatsSnapshot?: {
    /** When the first ask went out; there are no asks past the window. */
    firstAskAt?: number;
    lastAskAt?: number;
    /** Every ask sent; an answer to any of them ends the wait. */
    requestIds: string[];
  };
  /**
   * 'resync:chats' asks this device has answered: requestId -> when.
   *
   * Persisted, unlike the per-session dedup of record asks, because an answer
   * here is the whole history of the chats asked for, and an ask stays in the
   * shared inbox - and is replayed by catch-up scans - for up to 15 days.
   * Entries older than that are pruned.
   */
  answeredChatsResyncs?: Record<string, number>;
  /** Settings of the app on this device; absent fields take APP_SETTINGS_DEFAULT. */
  appSettings?: Partial<AppSettings>;
  autoBackup?: AutoBackupState;
  /**
   * Cached blacklist of contact email addresses persisted so that Deno can
   * immediately filter incoming messages on startup without waiting for RPC
   * to the contacts app.
   */
  cachedBlacklist?: string[];
}
