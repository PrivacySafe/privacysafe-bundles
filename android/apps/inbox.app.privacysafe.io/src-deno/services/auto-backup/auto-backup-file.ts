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
// The file of one device's automatic backup: built from the database, turned
// into bytes and back. Pure apart from the database read, so that the specs
// can take it apart.
import { gunzipSync, gzipSync } from 'fflate/browser';
import type { AutoBackupFile } from '../../types/auto-backup.types.ts';
import type { DBProvider } from '../../dataset/index.ts';
import { isIncomingMsg } from '../sync/msg-aspects.ts';
import { syncedRecordOf } from '../sync/record-mapping.ts';
import { snapshotEntriesOf, type RestorableMsg } from '../sync/restore-snapshot.ts';
import { groupSyncVersions } from '../sync/sync-versions.ts';

export const AUTO_BACKUP_KIND = 'inbox-auto-backup';
export const AUTO_BACKUP_FORMAT_VERSION = 1;

/**
 * Reads the whole database into the form of the file.
 *
 * `snapshotTs` must be taken by the caller BEFORE this is called (as
 * createBackupArchive does), so that no record in the file carries a stamp
 * above it.
 *
 * The messages go through snapshotEntriesOf() - the rule of the carrier a
 * restore snapshot follows: an incoming message that is in the shared inbox
 * travels without its record (only what the server does not know: read and
 * placement), because the message itself is its record's carrier; outgoing
 * mail, drafts and incoming messages gone from the server travel whole. That
 * keeps the bodies of received mail out of the file, and lets the file be
 * applied the way a neighbour applies a snapshot.
 *
 * `serverMsgIds` must therefore be an ANSWER: with an empty set for a failed
 * listing every incoming message would be written as gone from the server,
 * its attachments marked as unreachable. The caller fails the pass instead.
 *
 * Attachment ids are cut out (attachmentsForPhantom, inside syncedRecordOf);
 * the bytes are not backed up.
 */
export function buildAutoBackupFile({
  db,
  deviceId,
  appVersion,
  snapshotTs,
  now,
  serverMsgIds,
}: {
  db: Pick<DBProvider, 'getMessages' | 'getFolderList' | 'getAllSyncVersions'>;
  deviceId: string;
  appVersion: string;
  snapshotTs: number;
  now: number;
  serverMsgIds: ReadonlySet<string>;
}): AutoBackupFile {
  const grouped = groupSyncVersions(db.getAllSyncVersions());

  const restorable: RestorableMsg[] = db.getMessages().map(msg => ({
    msgId: msg.msgId,
    incoming: isIncomingMsg(msg),
    record: syncedRecordOf(msg, deviceId),
    versions: grouped.msgs.get(msg.msgId) ?? {},
  }));

  return {
    kind: AUTO_BACKUP_KIND,
    formatVersion: AUTO_BACKUP_FORMAT_VERSION,
    appVersion,
    deviceId,
    snapshotTs,
    writtenAt: now,
    folders: db.getFolderList().map(folder => ({
      folder,
      versions: grouped.folders.get(folder.id) ?? {},
    })),
    msgs: snapshotEntriesOf(restorable, serverMsgIds),
    tombstones: grouped.tombstones,
  };
}

function isGzip(bytes: Uint8Array): boolean {
  return (bytes.length >= 2) && (bytes[0] === 0x1f) && (bytes[1] === 0x8b);
}

/**
 * JSON, gzip-compressed with fflate's synchronous api: on Android the deno
 * component runs in a bare V8 isolate, where neither CompressionStream nor the
 * Blob and Response a stream would be piped through can be relied on.
 */
export function encodeAutoBackup(file: AutoBackupFile): Uint8Array {
  return gzipSync(new TextEncoder().encode(JSON.stringify(file)), { level: 6 });
}

export class AutoBackupFormatError extends Error {}

/**
 * Bytes back into a file, refusing anything that is not one: a file of the
 * folder may be damaged, or written by a newer build in a format this one
 * does not know - either is skipped by the caller, never applied in part.
 *
 * Plain JSON is read too, told apart by the gzip magic bytes.
 */
export function decodeAutoBackup(bytes: Uint8Array): AutoBackupFile {
  let json: Uint8Array;
  try {
    json = isGzip(bytes) ? gunzipSync(bytes) : bytes;
  } catch (err) {
    throw new AutoBackupFormatError(`not a readable gzip stream: ${(err as Error)?.message ?? err}`);
  }

  let parsed: Partial<AutoBackupFile>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new AutoBackupFormatError('not JSON');
  }

  if (!parsed || (parsed.kind !== AUTO_BACKUP_KIND)) {
    throw new AutoBackupFormatError(`not an automatic backup of the inbox (kind ${parsed?.kind})`);
  }
  if (parsed.formatVersion !== AUTO_BACKUP_FORMAT_VERSION) {
    throw new AutoBackupFormatError(`format version ${parsed.formatVersion} is not known to this build`);
  }
  if (
    (typeof parsed.deviceId !== 'string') || !parsed.deviceId
    || (typeof parsed.writtenAt !== 'number') || (typeof parsed.snapshotTs !== 'number')
    || !Array.isArray(parsed.folders) || !Array.isArray(parsed.msgs) || !Array.isArray(parsed.tombstones)
  ) {
    throw new AutoBackupFormatError('fields of the file are not of the expected shape');
  }
  return parsed as AutoBackupFile;
}
