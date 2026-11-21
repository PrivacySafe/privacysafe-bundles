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
// Vocabulary of the automatic backup (see doc/backup-and-restore.md, "Automatic
// backup") and of the app's settings. Type-only: imported by the window and by
// the deno component alike.
import type { SnapshotFolderEntry, SnapshotMsgEntry } from './mail-sync.types.ts';
import type { BackedUpTombstone } from './backup.types.ts';

/**
 * Settings of this app on THIS device. Kept per device, next to the device's
 * other state, because the background component reads them when no window is
 * open - and because each device writes its own automatic backup.
 */
export interface AppSettings {
  /** Whether this device writes its automatic backup. On by default. */
  autoBackup: boolean;
  /**
   * Whether the menu offers "Restore from automatic backups". Off by default:
   * a new installation restores from them by itself, and on a device that is
   * already in use the action is for when something went wrong.
   */
  showAutoBackupRestore: boolean;
}

/**
 * One device's automatic backup, as written to the synced storage.
 *
 * The records are in the very form a restore snapshot travels to the user's
 * other devices (SnapshotMsgEntry / SnapshotFolderEntry, made by
 * snapshotEntriesOf): an incoming message that is in the shared inbox goes
 * without its record, everything else with it, attachment ids cut out. So the
 * file is applied the way a neighbour applies a snapshot. Attachment bytes are
 * never in it.
 */
export interface AutoBackupFile {
  kind: 'inbox-auto-backup';
  formatVersion: 1;
  /** Version of the app that wrote the file. */
  appVersion: string;
  /** appDeviceId of the device the file belongs to. */
  deviceId: string;
  /** HLC stamp taken BEFORE the database was read. */
  snapshotTs: number;
  /** Wall clock: shown to the user, and the age the garbage collection goes by. */
  writtenAt: number;
  folders: SnapshotFolderEntry[];
  msgs: SnapshotMsgEntry[];
  tombstones: BackedUpTombstone[];
}

/** What the window is told about one automatic backup in the storage. */
export interface AutoBackupListItem {
  deviceId: string;
  isThisDevice: boolean;
  writtenAt: number;
  appVersion: string;
  foldersCount: number;
  messagesCount: number;
}

export interface AutoBackupListing {
  items: AutoBackupListItem[];
  /** Files that are there but could not be read; named for the log, counted for the user. */
  unreadable: number;
}

/** State of this device's automatic backup, as the settings dialog shows it. */
export interface AutoBackupInfo {
  settings: AppSettings;
  /** When this device's backup was last uploaded. */
  lastAt?: number;
  /** The last failure, if it came after the last success. */
  lastError?: { at: number; message: string };
  /** A pass is running right now. */
  inProgress: boolean;
}

export interface AutoBackupRestoreOutcome {
  /** Files that were read and applied. */
  devices: number;
  created: number;
  updated: number;
  skipped: number;
  foldersApplied: number;
}

/** This device's side of the automatic backup, kept in the database. */
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
   * Set on a new installation (a database file made anew): it restores from
   * the automatic backups of the user's devices before writing one of its own.
   * Removed once that restore has run, or found nothing to restore.
   */
  restorePending?: true;
}
