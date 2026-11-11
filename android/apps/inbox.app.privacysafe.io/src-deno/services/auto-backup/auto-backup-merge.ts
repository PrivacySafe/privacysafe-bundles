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
// The tombstones of several automatic backups, made into one set before any
// record of them is applied.
//
// The files were written by different devices at different times: device A's
// old file still holds message X, while B's newer one holds the tombstone of
// X. Applied file by file, X would come back if A happened to go first. So the
// tombstones of ALL files go in first, and the records after them meet those
// tombstones in the ordinary check - in any order of the files.
import type { AutoBackupFile } from '../../types/auto-backup.types.ts';
import type { BackedUpTombstone } from '../../types/backup.types.ts';
import type { SyncAspect, SyncToken } from '../../types/sync-types.ts';
import { isNewerToken } from '../sync/sync-versions.ts';

function keyOf(entityType: string, entityId: string): string {
  return `${entityType}\n${entityId}`;
}

/** The newest token an entry carries, or undefined when it carries none. */
function newestOf(versions: Partial<Record<SyncAspect, SyncToken>> | undefined): SyncToken | undefined {
  let newest: SyncToken | undefined;
  for (const token of Object.values(versions ?? {})) {
    if (token && isNewerToken(token, newest)) {
      newest = token;
    }
  }
  return newest;
}

/**
 * One tombstone per entity - the newest of all files - without the ones that
 * some file contradicts with a newer state of the entity.
 *
 * Such a contradicted tombstone is dropped rather than written: a tombstone
 * over a living entity would block every later update of it, and the entity's
 * own newer tokens already say the deletion is not the last word. An entity a
 * file holds with no token at all (an incoming message nobody touched) cannot
 * contradict anything, and does not.
 */
export function mergeTombstonesOfFiles(files: AutoBackupFile[]): BackedUpTombstone[] {
  const newestTombstone = new Map<string, BackedUpTombstone>();
  for (const file of files) {
    for (const tombstone of file.tombstones) {
      const key = keyOf(tombstone.entityType, tombstone.entityId);
      const held = newestTombstone.get(key);
      if (!held || isNewerToken(tombstone.token, held.token)) {
        newestTombstone.set(key, tombstone);
      }
    }
  }

  // The newest state of every entity the files hold, against which a
  // tombstone is judged.
  const livingNewest = new Map<string, SyncToken>();
  const noteLiving = (key: string, token: SyncToken | undefined) => {
    if (!token) {
      return;
    }
    const held = livingNewest.get(key);
    if (!held || isNewerToken(token, held)) {
      livingNewest.set(key, token);
    }
  };
  for (const file of files) {
    for (const entry of file.folders) {
      noteLiving(keyOf('folder', entry.folder?.id), newestOf(entry.versions));
    }
    for (const entry of file.msgs) {
      noteLiving(keyOf('msg', entry.msgId), newestOf(entry.versions));
    }
  }

  const merged: BackedUpTombstone[] = [];
  for (const [key, tombstone] of newestTombstone) {
    const living = livingNewest.get(key);
    if (living && isNewerToken(living, tombstone.token)) {
      continue;
    }
    merged.push(tombstone);
  }
  return merged;
}
