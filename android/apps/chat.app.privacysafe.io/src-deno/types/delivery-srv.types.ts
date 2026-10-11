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
   * Cached blacklist of contact email addresses persisted so that Deno can
   * immediately filter incoming messages on startup without waiting for RPC
   * to the contacts app.
   */
  cachedBlacklist?: string[];
}
