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

/**
 * Backing the mailbox up, and restoring it.
 *
 * The division of labour with the GUI is the one Contacts uses, and for the same
 * reason: on Android a `runtime: "deno"` component is executed by
 * androidx.javascriptengine - a bare V8 isolate with no Web APIs, where `crypto`
 * is simply absent. So this side owns the database, the file store and the zip;
 * the GUI owns the container, the metadata of an encrypted archive, the
 * encryption and the file dialogs. THE PASSPHRASE NEVER CROSSES THE IPC.
 *
 * Only the SYNCHRONOUS fflate api is used - `Zip` with `ZipDeflate` /
 * `ZipPassThrough`, and `unzipSync`. Its asynchronous counterparts spin up a
 * worker through `URL.createObjectURL(new Blob(...))`, which neither the deno
 * component nor the webview can be relied on to provide. Streaming through `Zip`
 * still reports progress per entry, which one `zipSync` call could not - and it
 * keeps one attachment in memory at a time rather than all of them.
 */

import { Zip, ZipDeflate, ZipPassThrough, unzipSync, type Unzipped } from 'fflate/browser';
import { INBOX_SCAN_FLOOR_MS } from '../shared/constants/sync.ts';
import { attachmentAvailabilityOf } from '../shared/utils/attachment-availability.ts';
import { generateFastRandomString } from '../shared/utils/generate-random-string.ts';
import { makeLogger } from '../shared/utils/logger.ts';
import { randomIdStr } from '../shared/utils/random-id.ts';
import { sleep } from '../shared/utils/processes/sleep.ts';
import { SYSTEM_FOLDERS } from '../src/common/constants/mail-folders-default.ts';
import type { AttachmentInfo, IncomingMessageView } from '../src/common/types/mail.types.ts';
import type { DBProvider } from './dataset/index.ts';
import type { LabelledFileStore } from './services/file-store/labelled-file-store.ts';
import type { InboxEmit } from './services/inbox-service/events.ts';
import { isIncomingMsg, type MsgView } from './services/sync/msg-aspects.ts';
import { syncedRecordOf } from './services/sync/record-mapping.ts';
import {
  applyRestoreSnapshot,
  chunkRestoreSnapshot,
  snapshotEntriesOf,
  surplusOfArchive,
  type RestorableMsg,
} from './services/sync/restore-snapshot.ts';
import { isNewerToken } from './services/sync/sync-versions.ts';
import type { SyncOutbox } from './services/sync/sync-outbox.ts';
import type {
  BackedUpAttachment,
  BackedUpFolder,
  BackedUpMsg,
  BackedUpTombstone,
  BackupArchiveError,
  BackupCreationResult,
  BackupMetadataContent,
  BackupProgress,
  BackupValidationResult,
  RestoreOutcome,
  RestoreProgress,
  SkippedAttachment,
  SkippedAttachmentRecord,
} from './types/backup.types.ts';
import type { SnapshotFolderEntry } from './types/mail-sync.types.ts';
import type {
  RestoreMode,
  SyncAspect,
  SyncToken,
  SyncVersionRow,
  SyncVersionWrite,
} from './types/sync-types.ts';
import {
  ATTACHMENTS_FOLDER,
  BACKUP_FORMAT_VERSION,
  BACKUP_MAX_BYTES,
  FOLDERS_FILE_NAME,
  MESSAGES_FILE_NAME,
  METADATA_FILE_NAME,
  TOMBSTONES_FILE_NAME,
  attachmentBlobName,
  attachmentBytesOf,
  isSafeArchivePath,
  makeBackupMetadataBytes,
  splitArchiveEntries,
} from './utils/backup-archive.ts';
import {
  checkBackupFormatCompatibility,
  checkBackupVersionCompatibility,
} from './utils/check-backup-version.ts';

const log = makeLogger('InboxBackup');

const COMPRESSION_LEVEL = 6;

/**
 * How often the loops yield. The progress events go out per entry either way, so
 * a short yield now and then is all it takes to keep the service answering while
 * a large mailbox is packed.
 */
const YIELD_EVERY = 10;
const YIELD_MS = 5;

/**
 * Failure of the archive itself, carrying the reason the UI shows.
 *
 * The class does NOT survive the IPC boundary - only data does - so the reason
 * goes into the message as well. Callers on this side match on `reason`; the GUI
 * has already run validateBackupArchive by the time a restore starts, so it only
 * ever needs the text.
 */
export class BackupArchiveFailure extends Error {
  constructor(public readonly reason: BackupArchiveError) {
    super(`Backup archive cannot be used: ${reason}`);
    this.name = 'BackupArchiveFailure';
  }
}

function checkAbortSignal(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Backup cancelled', 'AbortError');
  }
}

function mergeUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const res = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    res.set(chunk, offset);
    offset += chunk.length;
  }
  return res;
}

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function appVersion(): Promise<string> {
  try {
    return (await w3n.myVersion()) || '0.0.1';
  } catch {
    return '0.0.1';
  }
}

/** Adds one entry to the archive being written. `store` skips the deflate. */
type AddEntry = (path: string, bytes: Uint8Array, store?: boolean) => void;

/**
 * Packs an archive from a producer that is fed entries one at a time.
 *
 * A producer rather than a prepared list, and that is the whole point: an
 * attachment's bytes are handed over and dropped straight away, so what stays in
 * memory is the archive under construction plus one file - and not every
 * attachment of the mailbox at once.
 */
async function zipStreaming(
  produce: (add: AddEntry) => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  return new Promise<Uint8Array>((resolve, reject) => {
    let isEnded = false;

    const onAbort = () => {
      if (isEnded) {
        return;
      }
      isEnded = true;
      try {
        zip.terminate();
      } catch {
        // The zip is being thrown away; a failure to tear it down changes
        // nothing for the caller, which is already getting an AbortError.
      }
      reject(new DOMException('Backup cancelled', 'AbortError'));
    };

    if (signal?.aborted) {
      reject(new DOMException('Backup cancelled', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const zip = new Zip((err, chunk, isLast) => {
      if (isEnded) {
        return;
      }

      if (err) {
        isEnded = true;
        signal?.removeEventListener('abort', onAbort);
        try {
          zip.terminate();
        } catch {
          // See above.
        }
        reject(err);
        return;
      }

      if (chunk) {
        chunks.push(chunk);
      }

      if (isLast) {
        isEnded = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(mergeUint8Arrays(chunks));
      }
    });

    const add: AddEntry = (path, bytes, store) => {
      const entry = store
        ? new ZipPassThrough(path)
        : new ZipDeflate(path, { level: COMPRESSION_LEVEL });
      zip.add(entry);
      entry.push(bytes, true);
    };

    (async () => {
      try {
        await produce(add);
        checkAbortSignal(signal);
        zip.end();
      } catch (err) {
        if (!isEnded) {
          isEnded = true;
          signal?.removeEventListener('abort', onAbort);
          try {
            zip.terminate();
          } catch {
            // See above.
          }
          reject(err);
        }
      }
    })();
  });
}

interface OpenedArchive {
  entries: Unzipped;
  metadata?: BackupMetadataContent;
  /** The metadata file is there, but is not json this build can read. */
  metadataInvalid: boolean;
}

/**
 * Unpacks an archive.
 *
 * This is always the INNER archive: when the backup file was protected, the GUI
 * has already decrypted it and hands over the plaintext bytes, so nothing here
 * deals with passphrases. Its metadata then lives in the container the GUI
 * opened, and reaches this side through the `outerMetadata` argument instead.
 */
function openArchive(
  archiveBytes: Uint8Array,
  outerMetadata?: BackupMetadataContent,
  filter?: (file: { name: string }) => boolean,
): OpenedArchive {
  let entries: Unzipped;
  try {
    entries = filter ? unzipSync(archiveBytes, { filter }) : unzipSync(archiveBytes);
  } catch {
    throw new BackupArchiveFailure('corrupted_archive');
  }

  // An encrypted archive keeps no metadata inside, so what the GUI read from the
  // container is used as is.
  if (outerMetadata) {
    return { entries, metadata: outerMetadata, metadataInvalid: false };
  }

  let metadata: BackupMetadataContent | undefined;
  let metadataInvalid = false;
  const metadataBytes = entries[METADATA_FILE_NAME];
  if (metadataBytes) {
    try {
      metadata = JSON.parse(fromUtf8(metadataBytes)) as BackupMetadataContent;
    } catch {
      metadataInvalid = true;
    }
  }

  return { entries, metadata, metadataInvalid };
}

function parseJsonEntry<T>(bytes: Uint8Array | undefined, what: string): T[] {
  if (!bytes) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(bytes));
  } catch (err) {
    log.error(`Cannot read ${what} of the backup archive`, err);
    throw new BackupArchiveFailure('unreadable_records');
  }
  if (!Array.isArray(parsed)) {
    throw new BackupArchiveFailure('unreadable_records');
  }
  return parsed as T[];
}

/**
 * The greatest stamp anything about a message carries.
 *
 * Not the aspect tokens alone, and that is deliberate: an incoming message that
 * was never marked read and never moved has NO tokens at all, so by tokens alone
 * every message that arrived AFTER a backup would read as older than the archive
 * and be deleted by `replace`. Its own time is what stands in.
 */
function ageStampOf(msg: MsgView, versions: Partial<Record<SyncAspect, SyncToken>>): number {
  let stamp = Math.max(msg.cTime ?? 0, (msg as IncomingMessageView).deliveryTS ?? 0);
  for (const token of Object.values(versions)) {
    if (token && (token.ts > stamp)) {
      stamp = token.ts;
    }
  }
  return stamp;
}

interface GroupedVersions {
  /** Live aspect versions, by entity id. */
  byEntity: Map<string, Partial<Record<SyncAspect, SyncToken>>>;
  tombstones: BackedUpTombstone[];
}

function groupSyncVersions(rows: SyncVersionRow[]): {
  msgs: GroupedVersions['byEntity'];
  folders: GroupedVersions['byEntity'];
  tombstones: BackedUpTombstone[];
} {
  const msgs: GroupedVersions['byEntity'] = new Map();
  const folders: GroupedVersions['byEntity'] = new Map();
  const tombstones: BackedUpTombstone[] = [];

  for (const row of rows) {
    const token: SyncToken = { ts: row.ts, deviceId: row.deviceId };
    if (row.tombstonedAt) {
      // Tombstones live apart: they outlive their entity, and putting one in
      // with a live record would make that record unresurrectable.
      tombstones.push({
        entityType: row.entityType,
        entityId: row.entityId,
        token,
        tombstonedAt: row.tombstonedAt,
      });
      continue;
    }
    const target = (row.entityType === 'folder') ? folders : msgs;
    const versions = target.get(row.entityId) ?? {};
    versions[row.aspect] = token;
    target.set(row.entityId, versions);
  }

  return { msgs, folders, tombstones };
}

export interface InboxBackupSrvDeps {
  db: DBProvider;
  fileStore: LabelledFileStore;
  sync: SyncOutbox;
  emit: InboxEmit;
  /** The same helper a local change goes through - see applyMsgChanges. */
  applyMsgChanges(changes: MsgView[]): Promise<void>;
  deleteMessages(msgIds: string[], token: SyncToken): Promise<void>;
  /**
   * The window in which per-record changes are not reported one by one. A
   * restore rewrites the whole mailbox, and reporting each record walks every
   * row through its history in front of the user.
   */
  beginBulkReplay(): void;
  endBulkReplay(): void;
  /**
   * Replays the shared inbox from the (just reset) watermark. Without it the
   * mailbox would only come back in full at the next start of the component.
   */
  rescanInbox(): Promise<void>;
}

export interface InboxBackupSrv {
  createBackupArchive(opts?: {
    forEncryption?: boolean;
    withAttachments?: boolean;
  }): Promise<BackupCreationResult>;
  cancelBackupArchive(): Promise<boolean>;
  validateBackupArchive(
    archiveBytes: Uint8Array,
    outerMetadata?: BackupMetadataContent,
  ): Promise<BackupValidationResult>;
  restoreBackupArchive(
    archiveBytes: Uint8Array,
    mode: RestoreMode,
    outerMetadata?: BackupMetadataContent,
  ): Promise<RestoreOutcome>;
}

export function inboxBackupSrv({
  db,
  fileStore,
  sync,
  emit,
  applyMsgChanges,
  deleteMessages,
  beginBulkReplay,
  endBulkReplay,
  rescanInbox,
}: InboxBackupSrvDeps): InboxBackupSrv {
  let activeAbortController: AbortController | null = null;

  function emitBackupProgress(
    stage: BackupProgress['stage'],
    { totalFiles = 0, processedFiles = 0, currentFile, percent = 0 }: Partial<BackupProgress> = {},
  ): void {
    emit({
      entity: 'backup',
      event: 'progress',
      progress: { stage, totalFiles, processedFiles, currentFile, percent },
    });
  }

  function emitRestoreProgress(
    stage: RestoreProgress['stage'],
    { totalItems = 0, processedItems = 0, currentItem, percent = 0 }: Partial<RestoreProgress> = {},
  ): void {
    emit({
      entity: 'restore',
      event: 'progress',
      progress: { stage, totalItems, processedItems, currentItem, percent },
    });
  }

  async function cancelBackupArchive(): Promise<boolean> {
    if (activeAbortController && !activeAbortController.signal.aborted) {
      activeAbortController.abort();
      activeAbortController = null;
      return true;
    }
    return false;
  }

  // ===========================================================================
  // Creating an archive
  // ===========================================================================

  /**
   * What the archive says about one attachment, and whether its bytes are worth
   * asking the file store for.
   *
   * Three of the four reasons are known from the record alone; only `unreadable`
   * is discovered while reading, which is why this answers a plan rather than a
   * result.
   */
  function planAttachment(
    item: AttachmentInfo,
    msgId: string,
    index: number,
    withBytes: boolean,
  ): { entry: BackedUpAttachment; readFrom?: string } {
    const base: BackedUpAttachment = {
      fileName: item.fileName,
      size: item.size,
      ...(item.type && { type: item.type }),
      ...(item.originMsgId && { originMsgId: item.originMsgId }),
      ...(item.originDeviceId && { originDeviceId: item.originDeviceId }),
    };

    if (item.hasNoLocalSource) {
      // The record came from another device of the user, and bytes never travel
      // between devices - so there is nothing here to put in the archive.
      //
      // With several devices this is the COMMON case, not the rare one: an
      // archive is only ever as complete as the device it is taken on. Told
      // apart from the branch below because it is the one the user can act on,
      // by taking the backup where the files actually are.
      return { entry: { ...base, omitted: 'on-another-device' } };
    }
    if (item.external) {
      // A symlink to a file on the user's own disk. Following it would put a
      // file the app never owned into the archive, and those are the very files
      // that are too big to be worth duplicating.
      return { entry: { ...base, omitted: 'external' } };
    }
    if (item.type === 'origin') {
      // The bytes live inside an incoming message on the server, not in the
      // store. Copying them would double the weight of every mailbox for files
      // that survive a restore anyway - as long as the message does.
      //
      // BEFORE the `id` check, and that is not a detail: such a record can
      // legitimately have NO id. attachmentsForPhantom leaves an `origin`
      // attachment with an `originMsgId` unmarked and strips its id, because
      // the bytes are in a message of the SHARED inbox and every device can
      // read them - so a forward whose file was never copied into the store
      // arrives here without an id and with its bytes perfectly reachable.
      // Checked the other way round, it was reported as `no-local-source`,
      // which named neither the truth nor anything the user could act on.
      return { entry: { ...base, omitted: 'origin' } };
    }
    if (!item.id) {
      return { entry: { ...base, omitted: 'no-local-source' } };
    }
    if (!withBytes) {
      // The user asked for an archive without attachments - the way out of
      // `archive_too_large`. The record of the file still travels, so that after
      // a restore the message says which file it had rather than pretending it
      // had none.
      //
      // A reason of its OWN, and this matters: a file left out because it was
      // not asked for and a file left out because its record has no id are
      // different facts, and one label over both is unreadable from the outside.
      return { entry: { ...base, omitted: 'not-requested' } };
    }

    return {
      entry: { ...base, blobName: attachmentBlobName(msgId, index) },
      readFrom: item.id,
    };
  }

  async function createBackupArchive({
    forEncryption,
    withAttachments = true,
  }: { forEncryption?: boolean; withAttachments?: boolean } = {}): Promise<BackupCreationResult> {
    const abortController = new AbortController();
    activeAbortController = abortController;
    const { signal } = abortController;

    try {
      emitBackupProgress('scanning');
      checkAbortSignal(signal);

      // MANDATORY, and the first thing done: the writer batches up to 250 ms or
      // 64 mutations (db-writer.ts), so without this the archive would lag
      // behind what the user is looking at.
      await db.flush();

      // The barrier of the `replace` mode. Taken here, before anything is read,
      // so that nothing in the archive can carry a stamp above it.
      const snapshotTs = db.nextSyncToken().ts;

      const messages = db.getMessages();
      const folderList = db.getFolderList();
      const grouped = groupSyncVersions(db.getAllSyncVersions());

      checkAbortSignal(signal);

      const backedUpMsgs: BackedUpMsg[] = [];
      const plans: Array<{
        msgId: string;
        entries: BackedUpAttachment[];
        readFrom: Array<string | undefined>;
        /** The records as stored, for the line that says why one was left out. */
        records: AttachmentInfo[];
      }> = [];
      let estimatedBytes = 0;

      for (const msg of messages) {
        const incoming = isIncomingMsg(msg);
        const attachmentEntries: BackedUpAttachment[] = [];
        const readFrom: Array<string | undefined> = [];

        const list = msg.attachmentsInfo ?? [];
        for (let i = 0; i < list.length; i += 1) {
          const planned = planAttachment(list[i], msg.msgId, i, withAttachments);
          attachmentEntries.push(planned.entry);
          readFrom.push(planned.readFrom);
          if (planned.readFrom) {
            estimatedBytes += list[i].size || 0;
          }
        }

        backedUpMsgs.push({
          msgId: msg.msgId,
          incoming,
          // syncedRecordOf() unchanged, which is what keeping the attachments in
          // a field of their own buys: `record.attachmentsInfo` is ignored on
          // restore, and the archive's own list is used instead.
          record: syncedRecordOf(msg, db.getAppDeviceId()),
          ...(attachmentEntries.length > 0 && { attachments: attachmentEntries }),
          versions: grouped.msgs.get(msg.msgId) ?? {},
        });
        plans.push({ msgId: msg.msgId, entries: attachmentEntries, readFrom, records: list });
      }

      if (estimatedBytes > BACKUP_MAX_BYTES) {
        log.error(
          `A backup of this mailbox would weigh about ${Math.round(estimatedBytes / 1024 / 1024)} MB `
            + `of attachments, over the ${Math.round(BACKUP_MAX_BYTES / 1024 / 1024)} MB the archive `
            + `may carry across the app's IPC.`,
        );
        throw new BackupArchiveFailure('archive_too_large');
      }

      const backedUpFolders: BackedUpFolder[] = folderList.map(folder => ({
        folder,
        versions: grouped.folders.get(folder.id) ?? {},
      }));

      const toRead = plans.reduce(
        (acc, plan) => acc + plan.readFrom.filter(Boolean).length,
        0,
      );
      // +3 for messages.json, folders.json and tombstones.json.
      const totalFiles = toRead + 3;
      const skippedAttachments: SkippedAttachment[] = [];
      let attachmentsPacked = 0;
      let processed = 0;

      const bytes = await zipStreaming(async add => {
        for (const plan of plans) {
          for (let i = 0; i < plan.entries.length; i += 1) {
            const entry = plan.entries[i];
            const id = plan.readFrom[i];
            if (!id) {
              if (entry.omitted) {
                skippedAttachments.push({
                  msgId: plan.msgId,
                  fileName: entry.fileName,
                  reason: entry.omitted,
                  ...(entry.originDeviceId && { originDeviceId: entry.originDeviceId }),
                  record: skippedRecordOf(plan.records[i]),
                });
                // The record as it stands, and not only the verdict.
                //
                // "Why is this file not in my backup" was answerable only by
                // unpacking the archive and reading its metadata - and even
                // then the verdict alone did not say which field produced it.
                // These five are exactly what planAttachment decides on.
                log.info(
                  `Attachment '${entry.fileName}' of ${plan.msgId} left out of the backup `
                    + `(${entry.omitted}): ${describeAttachment(plan.records[i])}`,
                );
              }
              continue;
            }

            checkAbortSignal(signal);
            processed += 1;
            emitBackupProgress('compressing', {
              totalFiles,
              processedFiles: processed,
              currentFile: entry.fileName,
              percent: Math.round((processed / totalFiles) * 100),
            });

            try {
              const file = await fileStore.getFile(id);
              const fileBytes = await file.readBytes();
              add(`${ATTACHMENTS_FOLDER}/${entry.blobName}`, fileBytes ?? new Uint8Array(), true);
              attachmentsPacked += 1;
            } catch (err) {
              // One unreadable attachment must not fail the whole backup: it
              // goes into the metadata instead, so that a message without a file
              // afterwards is explainable.
              entry.blobName = undefined;
              entry.omitted = 'unreadable';
              skippedAttachments.push({
                msgId: plan.msgId,
                fileName: entry.fileName,
                reason: 'unreadable',
              });
              log.warn(`Attachment '${entry.fileName}' of ${plan.msgId} is left out of the backup`, err);
            }

            if ((processed > 0) && (processed % YIELD_EVERY === 0)) {
              await sleep(YIELD_MS);
            }
          }
        }

        checkAbortSignal(signal);

        // AFTER the attachments: the entries carry `blobName` and `omitted`, and
        // `unreadable` is only known once every file has been tried. Entry order
        // is of no consequence to a reader - unzipSync indexes by name.
        for (const [path, value] of [
          [MESSAGES_FILE_NAME, backedUpMsgs],
          [FOLDERS_FILE_NAME, backedUpFolders],
          [TOMBSTONES_FILE_NAME, grouped.tombstones],
        ] as const) {
          processed += 1;
          emitBackupProgress('compressing', {
            totalFiles,
            processedFiles: processed,
            currentFile: path,
            percent: Math.round((processed / totalFiles) * 100),
          });
          add(path, utf8(JSON.stringify(value)));
        }

        // With `forEncryption` the metadata is left out: the GUI encrypts this
        // archive whole and writes the metadata into the container around it,
        // where it stays readable without a passphrase.
        if (!forEncryption) {
          add(
            METADATA_FILE_NAME,
            makeBackupMetadataBytes({
              version: await appVersion(),
              snapshotTs,
              skippedAttachments,
              messagesCount: backedUpMsgs.length,
              foldersCount: backedUpFolders.length,
              attachmentsCount: attachmentsPacked,
            }),
          );
        }
      }, signal);

      emitBackupProgress('completed', { totalFiles, processedFiles: totalFiles, percent: 100 });

      log.info(
        `Packed a backup of ${backedUpMsgs.length} message(s), ${backedUpFolders.length} folder(s), `
          + `${grouped.tombstones.length} tombstone(s) and ${attachmentsPacked} attachment(s) into `
          + `${bytes.length} bytes; ${skippedAttachments.length} attachment(s) left out.`,
      );

      return {
        bytes,
        skippedAttachments,
        messagesCount: backedUpMsgs.length,
        foldersCount: backedUpFolders.length,
        attachmentsCount: attachmentsPacked,
        snapshotTs,
      };
    } catch (err) {
      if (signal.aborted || ((err as Error)?.name === 'AbortError')) {
        emitBackupProgress('cancelled');
      } else {
        emitBackupProgress('error');
      }
      throw err;
    } finally {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }
  }

  // ===========================================================================
  // Reading an archive back
  // ===========================================================================

  async function validateBackupArchive(
    archiveBytes: Uint8Array,
    outerMetadata?: BackupMetadataContent,
  ): Promise<BackupValidationResult> {
    const version = await appVersion();

    let attachmentsCount = 0;
    let opened: OpenedArchive;
    try {
      opened = openArchive(archiveBytes, outerMetadata, file => {
        // Counted in the filter rather than by unpacking the whole archive:
        // returning false here leaves the entry compressed, so the attachments
        // are tallied without paying to decompress a single one of them.
        if (file.name.startsWith(`${ATTACHMENTS_FOLDER}/`)) {
          attachmentsCount += 1;
          return false;
        }
        return (file.name === METADATA_FILE_NAME)
          || (file.name === MESSAGES_FILE_NAME)
          || (file.name === FOLDERS_FILE_NAME);
      });
    } catch (err) {
      if (err instanceof BackupArchiveFailure) {
        return { valid: false, compatible: false, appVersion: version, error: err.reason };
      }
      throw err;
    }

    const { entries, metadata, metadataInvalid } = opened;

    const messagesBytes = entries[MESSAGES_FILE_NAME];
    if (!messagesBytes) {
      // The likeliest way here is an archive of a DIFFERENT privacysafe app -
      // worth catching before the user confirms a destructive restore.
      return { valid: false, compatible: false, appVersion: version, error: 'no_messages' };
    }

    let messagesCount: number;
    let foldersCount: number;
    try {
      messagesCount = parseJsonEntry<BackedUpMsg>(messagesBytes, MESSAGES_FILE_NAME).length;
      foldersCount = parseJsonEntry<BackedUpFolder>(entries[FOLDERS_FILE_NAME], FOLDERS_FILE_NAME).length;
    } catch (err) {
      if (err instanceof BackupArchiveFailure) {
        return { valid: false, compatible: false, appVersion: version, error: err.reason };
      }
      throw err;
    }

    const compatible = checkBackupFormatCompatibility(
      BACKUP_FORMAT_VERSION,
      metadata?.formatVersion,
    );
    const versionCheck = checkBackupVersionCompatibility(version, metadata?.version);
    const warningReason = metadataInvalid
      ? ('invalid_metadata' as const)
      : (!metadata ? ('missing_metadata' as const) : versionCheck.reason);

    return {
      valid: true,
      compatible,
      appVersion: version,
      archiveVersion: metadata?.version,
      formatVersion: metadata?.formatVersion,
      createdAt: metadata?.createdAt,
      messagesCount,
      foldersCount,
      attachmentsCount,
      // Handed on so that the user learns what the archive cannot bring back
      // BEFORE the restore, rather than by unpacking the file by hand.
      ...(metadata?.skippedAttachments?.length && {
        skippedAttachments: metadata.skippedAttachments,
      }),
      ...(!compatible && warningReason && { warningReason }),
    };
  }

  /**
   * Writes the archive's tombstones, and only the ones it is safe to write.
   *
   * An archived tombstone must never land on an entity that is here: the check
   * in persistIncomingMail() looks at a tombstone's PRESENCE without comparing
   * tokens - correctly, an incoming msgId being issued once - so a tombstone
   * over a live message would make the app refuse to store it AND take it off
   * the server. That is the one way a restore could destroy mail that neither
   * mode is allowed to touch.
   */
  async function restoreTombstones(
    tombstones: BackedUpTombstone[],
    /** Ids the same archive carries a LIVE record for. */
    liveInArchive: ReadonlySet<string>,
  ): Promise<number> {
    const writes: SyncVersionWrite[] = [];

    for (const { entityType, entityId, token, tombstonedAt } of tombstones) {
      // A malformed archive claiming both a record and a tombstone for one
      // entity must not be allowed to make its own record unrestorable. Nothing
      // this app writes can produce such an archive - recordDeletion() drops an
      // entity's other aspects - but the archive is a file the user picked.
      if (liveInArchive.has(`${entityType}\n${entityId}`)) {
        continue;
      }

      if (entityType === 'msg') {
        if (db.getMessageById(entityId)) {
          continue;
        }
      } else if (entityType === 'folder') {
        if (db.getFolderById(entityId)) {
          continue;
        }
      } else {
        continue;
      }

      const stored = db.getSyncVersion(entityType, entityId, 'deleted');
      if (stored && !isNewerToken(token, stored)) {
        continue;
      }

      writes.push({
        entityType,
        entityId,
        aspect: 'deleted',
        ...token,
        tombstonedAt,
      });
    }

    await db.setSyncVersions(writes);
    return writes.length;
  }

  /**
   * Rebuilds `attachmentsInfo` with ids that belong to THIS device's file store.
   *
   * The archived ids are deliberately not reused: an id points into the store of
   * whatever device made the backup, and an id from there can collide with a
   * local one and hand the user somebody else's file.
   */
  function makeAttachmentRestorer(
    archiveEntries: ReadonlyMap<string, Uint8Array>,
    serverMsgIds: ReadonlySet<string>,
    serverListingAvailable: boolean,
  ) {
    return async function restoreAttachments(
      msgId: string,
      attachments: BackedUpAttachment[] | undefined,
      incoming: boolean,
    ): Promise<AttachmentInfo[] | undefined> {
      if (!attachments?.length) {
        return undefined;
      }

      const res: AttachmentInfo[] = [];
      for (const item of attachments) {
        const bytes = attachmentBytesOf(item, archiveEntries);
        if (bytes) {
          try {
            const id = await fileStore.addBytes(bytes, item.type ?? '', {
              fileName: item.fileName,
              messages: [msgId],
            });
            res.push({
              id,
              fileName: item.fileName,
              size: item.size,
              ...(item.type && { type: item.type }),
            });
            continue;
          } catch (err) {
            log.error(`Failed to write attachment '${item.fileName}' of ${msgId} into the store`, err);
          }
        }

        // No bytes here. An `origin` attachment is the one case that can still
        // be read - from the incoming message that holds it - and only while that
        // message is in the shared inbox.
        const carrierMsgId = item.originMsgId ?? (incoming ? msgId : undefined);
        const reachable = (item.omitted === 'origin')
          && !!carrierMsgId
          // A failed listing gives an empty set, and then "not in it" says
          // nothing: the attachment stays marked reachable, which is exactly how
          // the app behaves today.
          && (!serverListingAvailable || serverMsgIds.has(carrierMsgId));

        if (reachable) {
          res.push({
            // A synthetic handle in the same shape incomingMsgToIncomingMsgView
            // makes, and no id in any store: such an attachment is looked up by
            // message and file name (see getFileByInfoFromMsg).
            id: `${carrierMsgId}__${generateFastRandomString(3)}`,
            fileName: item.fileName,
            size: item.size,
            type: 'origin',
            ...(item.originMsgId && { originMsgId: item.originMsgId }),
          });
        } else {
          // No id at all, and marked: attachment-availability.ts then says "the
          // file is not here" instead of showing a link that leads nowhere.
          //
          // `originDeviceId` is carried through so that the message names WHICH
          // device the file is on, rather than only that it is elsewhere.
          res.push({
            fileName: item.fileName,
            size: item.size,
            ...(item.type && { type: item.type }),
            ...(item.originDeviceId && { originDeviceId: item.originDeviceId }),
            hasNoLocalSource: true,
          });
        }
      }

      return res;
    };
  }

  /**
   * Gives the attachments of a record that is already here the bytes it has none
   * for, and touches nothing else about it.
   *
   * Availability is decided per attachment, so the merge is per attachment too:
   * one whose file is readable is left exactly as it is, and one that is not gets
   * the archived bytes if the archive has them. See fillInAttachmentBytes() in
   * restore-snapshot.ts for why this stands outside the aspect rules.
   */
  function makeAttachmentByteFiller(archiveEntries: ReadonlyMap<string, Uint8Array>) {
    return async function fillAttachmentBytes(
      msgId: string,
      archived: BackedUpAttachment[] | undefined,
      local: AttachmentInfo[] | undefined,
    ): Promise<AttachmentInfo[] | undefined> {
      if (!archived?.length || !local?.length) {
        return undefined;
      }

      // Each archived entry is spent at most once: two attachments of one
      // message may share a file name, and the same bytes must not be handed to
      // both while the second one still has none.
      const spent = new Set<number>();
      const findArchived = (fileName: string) => archived.findIndex(
        (item, i) => !spent.has(i) && (item.fileName === fileName) && !!item.blobName,
      );

      const res: AttachmentInfo[] = [];
      let filledAny = false;

      for (const item of local) {
        // Available already - and `in-incoming-msg` counts as available: those
        // bytes are on the server, which is a better carrier than a copy here.
        if (attachmentAvailabilityOf(item) !== 'on-another-device' && item.id) {
          res.push(item);
          continue;
        }

        const index = findArchived(item.fileName);
        const bytes = (index >= 0)
          ? attachmentBytesOf(archived[index], archiveEntries)
          : undefined;
        if (!bytes) {
          res.push(item);
          continue;
        }
        spent.add(index);

        try {
          const id = await fileStore.addBytes(bytes, archived[index].type ?? item.type ?? '', {
            fileName: item.fileName,
            messages: [msgId],
          });
          // `hasNoLocalSource` and `originDeviceId` go with the marking: the
          // bytes ARE on this device now, and a record still claiming otherwise
          // would keep every reader saying the file is elsewhere.
          res.push({
            id,
            fileName: item.fileName,
            size: item.size,
            ...(item.type && { type: item.type }),
          });
          filledAny = true;
        } catch (err) {
          log.error(`Failed to put the bytes of '${item.fileName}' of ${msgId} back`, err);
          res.push(item);
        }
      }

      return filledAny ? res : undefined;
    };
  }

  async function restoreBackupArchive(
    archiveBytes: Uint8Array,
    mode: RestoreMode,
    outerMetadata?: BackupMetadataContent,
  ): Promise<RestoreOutcome> {
    // Raised before anything is read: while it is up the receiving tract leaves
    // incoming messages alone AND does not advance the watermark, so the pass
    // after the restore picks them up again. See DBProvider.isRestoreInProgress.
    db.setRestoreInProgress(true);
    beginBulkReplay();

    try {
      emitRestoreProgress('unpacking', { percent: 0 });

      const { entries, metadata } = openArchive(archiveBytes, outerMetadata);
      const safeEntries = Object.entries(entries)
        .filter(([path]) => isSafeArchivePath(path)) as [string, Uint8Array][];
      const split = splitArchiveEntries(safeEntries);

      if (!split.messagesBytes) {
        throw new BackupArchiveFailure('no_messages');
      }
      if (split.ignored.length > 0) {
        log.info(`Entries of the backup archive left unused: ${split.ignored.join(', ')}`);
      }

      const archivedMsgs = parseJsonEntry<BackedUpMsg>(split.messagesBytes, MESSAGES_FILE_NAME);
      const archivedFolders = parseJsonEntry<BackedUpFolder>(split.foldersBytes, FOLDERS_FILE_NAME);
      const archivedTombstones = parseJsonEntry<BackedUpTombstone>(
        split.tombstonesBytes,
        TOMBSTONES_FILE_NAME,
      );

      // The archive's own stamp, and the barrier of `replace`. An archive from
      // before the field existed falls back to its calendar time, which is the
      // best guess available and only ever used by such an archive.
      const snapshotTs = metadata?.snapshotTs ?? (calendarStampOf(metadata) || Date.now());

      // ONE listing of the shared inbox, the same call the catch-up scan makes
      // at every start - so this adds no new class of load. It answers three
      // questions at once: what goes into the snapshot, whether `origin`
      // attachments are reachable, and how much of the restored mail only the
      // archive carries.
      emitRestoreProgress('listing-inbox', { percent: 2 });
      const { serverMsgIds, listingAvailable } = await listSharedInbox();

      emitRestoreProgress('restoring-messages', {
        totalItems: archivedMsgs.length + archivedFolders.length,
        processedItems: 0,
        percent: 5,
      });

      const tombstonesWritten = await restoreTombstones(archivedTombstones, new Set([
        ...archivedMsgs.map(({ msgId }) => `msg\n${msgId}`),
        ...archivedFolders.map(({ folder }) => `folder\n${folder?.id}`),
      ]));

      const restorable: RestorableMsg[] = archivedMsgs.map(entry => ({
        msgId: entry.msgId,
        incoming: entry.incoming,
        record: entry.record,
        attachments: entry.attachments,
        versions: entry.versions ?? {},
      }));
      const folderEntries: SnapshotFolderEntry[] = archivedFolders.map(entry => ({
        folder: entry.folder,
        versions: entry.versions ?? {},
      }));

      // What `replace` deletes, worked out BEFORE the archive is applied, while
      // the local state is still untouched. A fresh token, not an archived one:
      // the deletion has to win on the other devices.
      const deleted = (mode === 'replace')
        ? surplusToDelete(archivedMsgs, archivedFolders, snapshotTs, db.nextSyncToken())
        : undefined;

      const totalItems = archivedMsgs.length + archivedFolders.length;
      const res = await applyRestoreSnapshot(
        {
          mode,
          snapshotTs,
          sourceDeviceId: db.getAppDeviceId(),
          msgs: restorable,
          folders: folderEntries,
          deleted,
        },
        {
          db,
          emit,
          applyMsgChanges,
          deleteMessages,
          serverMsgIds,
          serverListingAvailable: listingAvailable,
          restoreAttachments: makeAttachmentRestorer(
            split.attachments,
            serverMsgIds,
            listingAvailable,
          ),
          fillAttachmentBytes: makeAttachmentByteFiller(split.attachments),
          onProgress: (done, total, current) => {
            emitRestoreProgress('restoring-messages', {
              totalItems: total || totalItems,
              processedItems: done,
              currentItem: current,
              percent: 5 + Math.round((done / (total || totalItems || 1)) * 70),
            });
          },
        },
      );

      // NOT restored, ever, and this is the point of an archive holding a logical
      // export rather than a dump of the `storage-db` file:
      //
      //  - `sync_device.appDeviceId`: two devices with one id stop seeing each
      //    other's phantoms - each takes them for its own echo - and the LWW
      //    tie-break breaks with them. This device keeps its own id;
      //  - `AppState.lastReceivingTimestamp`: this device's watermark over the
      //    SHARED inbox. Somebody else's watermark, from the future, would make
      //    this device skip the whole catch-up scan and lose incoming mail. Reset
      //    to 0, so the next pass derives the mailbox again;
      //  - `pending_sync_msgs`, `orphaned_syncs`, `pending_inbox_removals`: the
      //    state of one device's own processes;
      //  - `thumbnails`: a local cache that rebuilds itself in milliseconds.
      await db.updateAppState({ lastReceivingTimestamp: 0 });
      emit({ entity: 'app-state', event: 'updated', state: { lastReceivingTimestamp: 0 } });
      await db.flush();

      log.info(
        `Restored a backup in ${mode} mode: ${res.created} created, ${res.updated} updated, `
          + `${res.skipped} skipped, ${res.deletedMsgs} message(s) and ${res.deletedFolders} `
          + `folder(s) deleted, ${tombstonesWritten} tombstone(s) written, `
          + `${res.attachmentsFilled} record(s) given their attachment bytes back, `
          + `${res.onlyInArchive} message(s) now carried only by the archive`
          + `${listingAvailable ? '' : '; the inbox listing failed, so reachability of origin '
            + 'attachments was assumed'}.`,
      );

      // The other devices, told in the rules they already apply. Announced after
      // the local state is on disk: a chunk must not go out ahead of the change
      // it announces.
      emitRestoreProgress('announcing', { percent: 80 });
      await announceRestore({ mode, snapshotTs, restorable, folderEntries, deleted, serverMsgIds });

      emitRestoreProgress('completed', {
        totalItems,
        processedItems: totalItems,
        percent: 100,
      });

      return {
        restored: true,
        created: res.created,
        updated: res.updated,
        skipped: res.skipped,
        deleted: res.deletedMsgs + res.deletedFolders,
        onlyInArchive: res.onlyInArchive,
        inboxListingFailed: !listingAvailable,
      };
    } catch (err) {
      emitRestoreProgress('error');
      throw err;
    } finally {
      // Lowered before the pass, and it has to be: the pass reads the inbox
      // through the same tract the flag holds back.
      db.setRestoreInProgress(false);

      // NOT awaited, and that is the point. The pass covers whatever the restore
      // made the receiving tract skip plus everything the watermark reset asks
      // for; on a large mailbox it is a listing and a walk over it, and the
      // caller has no business waiting for that - the restore itself is done and
      // its outcome is already final.
      //
      // The bulk-replay window stays open until the pass ends, so what the GUI
      // gets is one `lists`/`reload` once the mailbox has settled, rather than
      // every row walking through its history.
      //
      // A failure is logged and not rethrown: the next start repeats this pass.
      rescanInbox()
        .catch(err => log.error(
          `The inbox pass after a restore failed; it will run again at the next start`, err,
        ))
        .finally(() => endBulkReplay());
    }
  }

  async function listSharedInbox(): Promise<{
    serverMsgIds: Set<string>;
    listingAvailable: boolean;
  }> {
    // The floor is obligatory: with a falsy fromTS the platform's inbox index
    // walks into shard files whose names it parsed wrong and throws ENOENT
    // instead of listing anything. See INBOX_SCAN_FLOOR_MS.
    const listed = await w3n.mail?.inbox.listMsgs(INBOX_SCAN_FLOOR_MS).catch(err => {
      log.warn(
        `Could not list the shared inbox for a restore; every archived record will be `
          + `restored and announced, and origin attachments assumed reachable.`,
        err,
      );
      return undefined;
    });

    if (!listed) {
      return { serverMsgIds: new Set(), listingAvailable: false };
    }
    return {
      serverMsgIds: new Set(listed.filter(item => item.msgType === 'mail').map(item => item.msgId)),
      listingAvailable: true,
    };
  }

  function surplusToDelete(
    archivedMsgs: BackedUpMsg[],
    archivedFolders: BackedUpFolder[],
    snapshotTs: number,
    token: SyncToken,
  ): { msgIds?: string[]; folderIds?: string[]; token: SyncToken } | undefined {
    const grouped = groupSyncVersions(db.getAllSyncVersions());

    const { msgIds, folderIds } = surplusOfArchive({
      msgs: db.getMessages().map(msg => ({
        msgId: msg.msgId,
        maxTs: ageStampOf(msg, grouped.msgs.get(msg.msgId) ?? {}),
      })),
      folders: db.getFolderList().map(folder => ({
        folderId: folder.id,
        maxTs: greatestTs(grouped.folders.get(folder.id) ?? {}),
        // Never surplus, whatever the stamps say: the app cannot work without
        // them, and MAIL_FOLDERS_DEFAULT would put them straight back.
        isSystem: folder.isSystem || isSystemFolderId(folder.id),
      })),
      archiveMsgIds: new Set(archivedMsgs.map(({ msgId }) => msgId)),
      archiveFolderIds: new Set(archivedFolders.map(({ folder }) => folder.id)),
      snapshotTs,
    });

    if ((msgIds.length === 0) && (folderIds.length === 0)) {
      return undefined;
    }
    return {
      ...(msgIds.length > 0 && { msgIds }),
      ...(folderIds.length > 0 && { folderIds }),
      token,
    };
  }

  async function announceRestore({
    mode,
    snapshotTs,
    restorable,
    folderEntries,
    deleted,
    serverMsgIds,
  }: {
    mode: RestoreMode;
    snapshotTs: number;
    restorable: RestorableMsg[];
    folderEntries: SnapshotFolderEntry[];
    deleted?: { msgIds?: string[]; folderIds?: string[]; token: SyncToken };
    serverMsgIds: ReadonlySet<string>;
  }): Promise<void> {
    // Announced whether or not this device has ever seen a phantom from another
    // one, exactly as an ordinary change is. `hasSeenOtherDevice()` answers "has
    // a neighbour ever spoken here", not "is there a neighbour": a device that
    // has been switched off since the app was installed would be left behind for
    // good, and no later pass would put that right. What it costs a single-device
    // user is records without attachment bytes, which its own inbox collects
    // after INBOX_REMOVAL_DELAY_MS.
    const restoreId = randomIdStr(16);
    const token = db.nextSyncToken();
    const chunks = chunkRestoreSnapshot({
      mode,
      snapshotTs,
      restoreId,
      msgs: snapshotEntriesOf(restorable, serverMsgIds),
      folders: folderEntries,
      deleted,
    });

    for (const chunk of chunks) {
      await sync.announceSnapshotChunk({ event: chunk, token });
    }

    log.info(
      `Announced restore ${restoreId} (${mode}) in ${chunks.length} chunk(s) under stamp ${token.ts}.`,
    );
  }

  return {
    createBackupArchive,
    cancelBackupArchive,
    validateBackupArchive,
    restoreBackupArchive,
  };
}

function greatestTs(versions: Partial<Record<SyncAspect, SyncToken>>): number {
  let stamp = 0;
  for (const token of Object.values(versions)) {
    if (token && (token.ts > stamp)) {
      stamp = token.ts;
    }
  }
  return stamp;
}

const SYSTEM_FOLDER_IDS: ReadonlySet<string> = new Set(Object.values(SYSTEM_FOLDERS));

function isSystemFolderId(folderId: string): boolean {
  return SYSTEM_FOLDER_IDS.has(folderId);
}

/**
 * The fields planAttachment() decides on, as the metadata records them.
 *
 * In the archive's own metadata rather than only in a log, because the metadata
 * is what anybody looking at an archive actually reads - and the verdict alone
 * twice failed to explain one that came out with no attachments at all.
 */
function skippedRecordOf(item: AttachmentInfo | undefined): SkippedAttachmentRecord | undefined {
  if (!item) {
    return undefined;
  }
  return {
    hasId: !!item.id,
    ...(item.type && { type: item.type }),
    ...(item.external && { external: true as const }),
    ...(item.hasNoLocalSource && { hasNoLocalSource: true as const }),
    ...(item.originMsgId && { hasOriginMsgId: true }),
  };
}

/**
 * The five fields planAttachment decides on, as one line for the log.
 *
 * Named individually rather than dumped as JSON: an attachment record can carry
 * a long `originMsgId` and nothing else of interest, and what is wanted here is
 * a line that can be read at a glance.
 */
function describeAttachment(item: AttachmentInfo | undefined): string {
  if (!item) {
    return 'no record';
  }
  return [
    `id=${item.id ? 'yes' : 'NONE'}`,
    `type=${item.type ?? 'none'}`,
    `external=${item.external ? 'yes' : 'no'}`,
    `hasNoLocalSource=${item.hasNoLocalSource ? 'yes' : 'no'}`,
    `originMsgId=${item.originMsgId ? 'yes' : 'none'}`,
    `size=${item.size}`,
  ].join(' ');
}

/** An archive's calendar time as a stamp, or 0 when it names none it can read. */
function calendarStampOf(metadata: BackupMetadataContent | undefined): number {
  if (!metadata?.createdAt) {
    return 0;
  }
  const parsed = Date.parse(metadata.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}
