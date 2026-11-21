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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const APP_SETTINGS_DEFAULT: AppSettings = {
  autoBackup: true,
  showAutoBackupRestore: false,
};

/** Folder of the app's synced storage that holds one file per device. */
export const AUTO_BACKUP_FOLDER = 'auto-backup';

export const AUTO_BACKUP_FILE_SUFFIX = '.json.gz';

/** A device writes its backup at most this often, and only if something changed. */
export const AUTO_BACKUP_INTERVAL_MILLIS = 12 * HOUR;

/** After a failed attempt the next one comes sooner than the interval. */
export const AUTO_BACKUP_RETRY_MILLIS = HOUR;

/** The first pass after a start: the start itself is heavy enough. */
export const AUTO_BACKUP_FIRST_PASS_DELAY_MILLIS = 5 * 60 * 1000;

/**
 * The first run of a new installation restores sooner than that: until it
 * does, its chat list is empty.
 */
export const AUTO_BACKUP_FIRST_RUN_RESTORE_DELAY_MILLIS = 20 * 1000;

/** How often the scheduler looks whether a pass is due; a look is cheap. */
export const AUTO_BACKUP_CHECK_MILLIS = 30 * 60 * 1000;

/**
 * A file of a device that has written nothing for this long is a candidate for
 * removal (see the rule in auto-backup.ts) - a reinstalled device gets a new
 * device id, so the files of the old ones would otherwise pile up.
 */
export const AUTO_BACKUP_DEAD_AFTER_MILLIS = 60 * DAY;

/** Removal of dead devices' files is tried at most this often. */
export const AUTO_BACKUP_GC_INTERVAL_MILLIS = DAY;
