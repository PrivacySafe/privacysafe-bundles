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
// can take it apart (ci/auto-backup.test.ts).
// 'fflate/browser', not 'fflate': the bundle is built for platform 'node', and
// there fflate's node entry opens with `import { createRequire } from "module"`.
// The platform's deno has no node built-ins, so that import failed the whole
// component at load - nothing got exposed, and the window timed out on
// AppChatsInternal (0.12.42). The browser entry imports nothing.
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate/browser';
import type { AutoBackupFile } from '../../../types/auto-backup.types.ts';
import type { BackedUpTombstone, SnapshotMsgEntry } from '../../../types/backup.types.ts';
import type { DB } from '../../types/index.ts';
import { readSnapshotFromDb } from '../chat-service/utils/snapshot-announce.ts';
import { attachmentsForPhantom } from '../chat-service/utils/_msgs-related-methods.ts';
import { groupSyncVersions, isExpiredRecord } from './backup-records.ts';

export const AUTO_BACKUP_KIND = 'chat-auto-backup';
export const AUTO_BACKUP_FORMAT_VERSION = 1;

/**
 * Reads the whole database into the form of the file.
 *
 * `snapshotTs` must be taken by the caller BEFORE this is called (as
 * createBackupPlan does), so that no record in the file carries a stamp above
 * it. Records past their `removeAfter` are left out: they would be deleted
 * on the first start anyway.
 *
 * Attachments are the records' lists with the ids cut out - exactly what a
 * snapshot carries to the user's other devices. The bytes are not backed up:
 * received files are reachable through the shared inbox for as long as the
 * message is there, and sent ones live only in the file store of the device
 * that sent them.
 */
export function buildAutoBackupFile({
  db,
  deviceId,
  appVersion,
  snapshotTs,
  now,
}: {
  db: DB;
  deviceId: string;
  appVersion: string;
  snapshotTs: number;
  now: number;
}): AutoBackupFile {
  const { chats, msgs } = readSnapshotFromDb(db);
  const tombstones: BackedUpTombstone[] = groupSyncVersions(db.getAllSyncVersions()).tombstones;

  const wireMsgs: SnapshotMsgEntry[] = [];
  for (const msg of msgs) {
    if (isExpiredRecord(msg.record, now)) {
      continue;
    }
    const attachments = attachmentsForPhantom(msg.attachments, deviceId);
    wireMsgs.push({
      chatId: msg.chatId,
      chatMessageId: msg.chatMessageId,
      record: msg.record,
      ...(attachments && { attachments }),
      versions: msg.versions,
    });
  }

  return {
    kind: AUTO_BACKUP_KIND,
    formatVersion: AUTO_BACKUP_FORMAT_VERSION,
    appVersion,
    deviceId,
    snapshotTs,
    writtenAt: now,
    chats,
    msgs: wireMsgs,
    tombstones,
  };
}

function isGzip(bytes: Uint8Array): boolean {
  return (bytes.length >= 2) && (bytes[0] === 0x1f) && (bytes[1] === 0x8b);
}

/**
 * gzip-compressed JSON, made by fflate (pure JS) on every OS: the component's
 * runtime on Android has neither TextEncoder nor, it seems, the streams API,
 * and one code path everywhere does not depend on what a runtime adds later.
 * The sync api is deliberate - the async one spins up workers. Plain JSON
 * (written by older builds where CompressionStream was missing) is still read:
 * the reader tells the two apart by the gzip magic bytes.
 */
// deno-lint-ignore require-await
export async function encodeAutoBackup(file: AutoBackupFile): Promise<Uint8Array> {
  return gzipSync(strToU8(JSON.stringify(file)));
}

export class AutoBackupFormatError extends Error {}

/**
 * Bytes back into a file, refusing anything that is not one: a file of the
 * folder may be damaged, or written by a newer build in a format this one
 * does not know - either is skipped by the caller, never applied in part.
 */
export async function decodeAutoBackup(bytes: Uint8Array): Promise<AutoBackupFile> {
  let json: Uint8Array;
  try {
    json = isGzip(bytes) ? gunzipSync(bytes) : bytes;
  } catch (err) {
    throw new AutoBackupFormatError(`not a readable gzip stream: ${(err as Error)?.message ?? err}`);
  }

  let parsed: Partial<AutoBackupFile>;
  try {
    parsed = JSON.parse(strFromU8(json));
  } catch {
    throw new AutoBackupFormatError('not JSON');
  }

  if (!parsed || (parsed.kind !== AUTO_BACKUP_KIND)) {
    throw new AutoBackupFormatError(`not an automatic backup of the chat (kind ${parsed?.kind})`);
  }
  if (parsed.formatVersion !== AUTO_BACKUP_FORMAT_VERSION) {
    throw new AutoBackupFormatError(`format version ${parsed.formatVersion} is not known to this build`);
  }
  if (
    (typeof parsed.deviceId !== 'string') || !parsed.deviceId
    || (typeof parsed.writtenAt !== 'number') || (typeof parsed.snapshotTs !== 'number')
    || !Array.isArray(parsed.chats) || !Array.isArray(parsed.msgs) || !Array.isArray(parsed.tombstones)
  ) {
    throw new AutoBackupFormatError('fields of the file are not of the expected shape');
  }
  return parsed as AutoBackupFile;
}
