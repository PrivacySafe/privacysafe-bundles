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
// The window's half of a backup, which in this app is most of it: the deno
// component hands over the records and a work-list of attachment ids, and
// everything after that happens here - reading the bytes out of the file store,
// building the zip, encrypting, and saving through the file dialog.
//
// That split is possible because this app's manifest gives its windows BOTH
// `shell.fileDialog` and `storage`, and calls fileStoreService in the window
// itself. So no attachment byte crosses the app's IPC, in either direction, and
// neither does the passphrase.
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { chatService, fileLinkStoreSrv } from '@main/common/services/external-services';
import { backupFileName, makeBackupMetadataBytes } from '@shared/backup-archive';
import {
  ATTACHMENTS_FOLDER,
  BACKUP_MAX_BYTES,
  CHATS_FILE_NAME,
  MAX_FILES_PER_FOLDER_ATTACHMENT,
  MESSAGES_FILE_NAME,
  METADATA_FILE_NAME,
  TOMBSTONES_FILE_NAME,
} from '@shared/constants/backup';
import { packEncryptedContainer } from '@main/common/utils/backup-container';
import { skippedAttachmentsLines } from '@main/common/utils/skipped-attachments';
import { makeLogger } from '@shared/logger';
import type { Ui3nNotificationProps } from '@v1nt1248/3nclient-lib';
import type {
  BackupPlan,
  BackupProgress,
  PlannedAttachment,
  RestoreProgress,
  SkippedAttachment,
} from '~/backup.types';

const log = makeLogger('BackupStore');

/** Only what these workflows need of vue-i18n's `t`, so it can be passed in. */
export type Translate = (key: string, named?: Record<string, unknown>) => string;

export type CreateNotice = (params: Ui3nNotificationProps) => void;

/**
 * Whether a failure is the user's own cancellation.
 *
 * Matched on text, which is not as crude as it looks: the error crosses the IPC
 * boundary as data, so the DOMException the service threw arrives as a plain
 * object with no class and, depending on the path, no `name` either. Treating a
 * cancellation as a failure would show the user an error for something they
 * asked for.
 */
export function isBackupCancelledError(err: unknown): boolean {
  const error = err as (Error & { cause?: unknown }) | undefined;
  if (!error) {
    return false;
  }

  const cause = error.cause as Error | string | undefined;
  const combined = [
    error.name,
    error.message,
    error.stack,
    (typeof cause === 'string') ? cause : cause?.message,
    (typeof cause === 'string') ? undefined : cause?.stack,
  ].filter(Boolean).join(' ');

  return (error.name === 'AbortError') || /cancelled|aborterror|aborted/i.test(combined);
}

/** Whether the archive would not fit in memory; the reason has a way out. */
export function isArchiveTooLargeError(err: unknown): boolean {
  const error = err as (Error & { cause?: unknown }) | undefined;
  if (!error) {
    return false;
  }
  const cause = error.cause as Error | string | undefined;
  const combined = [
    error.message,
    (typeof cause === 'string') ? cause : cause?.message,
  ].filter(Boolean).join(' ');
  return combined.includes('archive_too_large');
}

/** An entry on its way into the zip. */
interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
  /** Ciphertext and media do not compress; those are stored. */
  store?: boolean;
}

/** Lets the event loop run between entries, so the window stays responsive. */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * Builds a zip out of the entries, one entry per macrotask.
 *
 * fflate's STREAMING api, and only its synchronous halves (ZipDeflate,
 * ZipPassThrough): the asynchronous ones raise a worker through
 * URL.createObjectURL(new Blob(...)), which is not something to rely on inside
 * the platform's webview.
 */
async function buildZip(
  entries: ArchiveEntry[],
  onEntry?: (index: number, total: number, path: string) => void,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let settle: { resolve: () => void; reject: (err: unknown) => void };
  const done = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      settle.reject(err);
      return;
    }
    if (chunk?.length) {
      chunks.push(chunk);
    }
    if (final) {
      settle.resolve();
    }
  });

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    onEntry?.(i + 1, entries.length, entry.path);

    const file = entry.store
      ? new ZipPassThrough(entry.path)
      : new ZipDeflate(entry.path, { level: 6 });
    zip.add(file);
    file.push(entry.bytes, true);

    // One entry per macrotask: a history of thousands of messages and hundreds
    // of files would otherwise deflate in one unbroken run and freeze the
    // window for the whole of it.
    await yieldToEventLoop();
  }

  zip.end();
  await done;

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export const useBackupStore = defineStore('backup', () => {
  const backupProgress = ref<BackupProgress | null>(null);
  const restoreProgress = ref<RestoreProgress | null>(null);
  /** What the last backup could not take along; shown once it is saved. */
  const lastSkippedAttachments = ref<SkippedAttachment[]>([]);

  /**
   * Set by the dialog's Cancel, by its ESC and by its overlay click. A local
   * flag, not a round trip over IPC: the reading loop yields on every `await`,
   * so this is noticed at once - and the deno side is told as well, since its
   * scan may still be running.
   */
  let cancelRequested = false;

  function onBackupProgress(value: BackupProgress | null): void {
    backupProgress.value = value;
  }

  function onRestoreProgress(value: RestoreProgress | null): void {
    restoreProgress.value = value;
  }

  /**
   * Progress reported by the deno component.
   *
   * Two writers share one ref, and the service's events can arrive late: an
   * event is taken only while the stage is still `scanning`, or a straggling
   * `scanning` would drag the dialog back from `compressing` to the beginning.
   */
  function applyServiceBackupProgress(value: BackupProgress | null): void {
    if (value && backupProgress.value && (backupProgress.value.stage !== 'scanning')) {
      return;
    }
    backupProgress.value = value;
  }

  function throwIfCancelled(): void {
    if (cancelRequested) {
      throw new Error('Backup was cancelled');
    }
  }

  async function saveBackupArchiveToFile(
    archiveBytes: Uint8Array,
    appVersion: string,
    t: Translate,
  ): Promise<{ saved: boolean; fileName?: string }> {
    const defaultFileName = backupFileName(new Date(), appVersion);

    if (!w3n.shell?.fileDialogs?.saveFileDialog) {
      return { saved: false };
    }

    const file = await w3n.shell.fileDialogs.saveFileDialog(
      t('backup.create.fileDialogTitle'),
      t('backup.create.fileDialogBtn'),
      defaultFileName,
      { filters: [{ name: t('backup.zipFilterName'), extensions: ['zip'] }] },
    );

    if (!file) {
      return { saved: false };
    }

    await (file as web3n.files.WritableFile).writeBytes(archiveBytes);
    return { saved: true, fileName: file.name || defaultFileName };
  }

  function reportCancellation(t: Translate, $createNotice: CreateNotice): void {
    $createNotice({ type: 'warning', content: t('backup.create.cancel'), duration: 4000 });
    onBackupProgress(null);
  }

  async function cancelBackup(t: Translate, $createNotice: CreateNotice): Promise<void> {
    cancelRequested = true;
    try {
      await chatService.cancelBackupPlan();
    } catch (err) {
      await w3n.log('info', 'Could not cancel the backup being created', err);
    } finally {
      reportCancellation(t, $createNotice);
    }
  }

  function handleBackupError(err: unknown, t: Translate, $createNotice: CreateNotice): boolean {
    if (isBackupCancelledError(err)) {
      w3n.log('info', 'Creation of a backup was cancelled');
      reportCancellation(t, $createNotice);
      return false;
    }

    w3n.log('error', 'Creation of a backup failed', err);

    onBackupProgress({ stage: 'error', totalFiles: 0, processedFiles: 0, percent: 0 });
    $createNotice({
      type: 'error',
      content: isArchiveTooLargeError(err)
        ? t('backup.create.errorTooLarge')
        : t('backup.create.error'),
      duration: 6000,
    });
    // Left on screen for a moment: the dialog closes on a null progress, and
    // closing it the instant the error arrives would take the message with it.
    setTimeout(() => onBackupProgress(null), 3000);

    return false;
  }

  /**
   * Reads the bytes of one planned attachment, or says why it could not.
   *
   * The three reasons only this side can see live here: `symlink` (an
   * attachment above ATTACHMENT_COPY_THRESHOLD is a reference to the user's own
   * file, and the archive does not follow it), `folder-partial` and
   * `unreadable`. A file that cannot be read does NOT fail the backup - the
   * rest of the history is still worth having.
   */
  async function readPlannedAttachment(
    planned: PlannedAttachment,
  ): Promise<
    | { entries: ArchiveEntry[]; bytes: number; partial?: SkippedAttachment }
    | { skipped: SkippedAttachment }
  > {
    const skipRecord = (reason: SkippedAttachment['reason']): SkippedAttachment => ({
      chatId: planned.chatId,
      chatMessageId: planned.chatMessageId,
      fileName: planned.fileName,
      reason,
      record: { hasId: true, ...(planned.isFolder && { isFolder: true as const }) },
    });
    const skip = (reason: SkippedAttachment['reason']): { skipped: SkippedAttachment } => ({
      skipped: skipRecord(reason),
    });
    const blobPath = `${ATTACHMENTS_FOLDER}/${planned.blobName}`;

    const stat = await fileLinkStoreSrv.statEntity(planned.entityId);
    if (!stat) {
      return skip('unreadable');
    }
    if (stat.isLink) {
      return skip('symlink');
    }

    if (stat.isFolder) {
      const listing = await fileLinkStoreSrv.listFolderEntity(planned.entityId);
      if (!listing) {
        return skip('unreadable');
      }
      const folder = await fileLinkStoreSrv.getFile(planned.entityId);
      if (!folder || !(folder as web3n.files.FS).readBytes) {
        return skip('unreadable');
      }
      const fs = folder as web3n.files.FS;
      const taken = listing.slice(0, MAX_FILES_PER_FOLDER_ATTACHMENT);
      const entries: ArchiveEntry[] = [];
      let bytes = 0;
      for (const item of taken) {
        const content = await fs.readBytes(item.path).catch(() => undefined);
        if (!content) {
          continue;
        }
        // The folder is archived as a TREE, relative paths and all: flattening
        // it would restore a bundle of files rather than the folder attached.
        entries.push({ path: `${blobPath}/${item.path}`, bytes: content, store: true });
        bytes += content.length;
      }
      if (entries.length === 0) {
        return skip('unreadable');
      }
      // Part of the folder is in, and the user is told the rest is not: a
      // folder attachment is somebody's own directory, and nothing about it is
      // bounded.
      return (listing.length > taken.length)
        ? { entries, bytes, partial: skipRecord('folder-partial') }
        : { entries, bytes };
    }

    const file = await fileLinkStoreSrv.getFile(planned.entityId);
    if (!file || !(file as web3n.files.File).readBytes) {
      return skip('unreadable');
    }
    const content = await (file as web3n.files.File).readBytes().catch(() => undefined);
    if (!content) {
      return skip('unreadable');
    }
    // Media and ciphertext do not compress, and an attachment is usually one of
    // those; deflating it would cost a pass over the whole file for nothing.
    return { entries: [{ path: blobPath, bytes: content, store: true }], bytes: content.length };
  }

  /**
   * The whole of making a backup on this side: read the bytes, pack, encrypt,
   * save.
   */
  async function runBackupWorkflow({
    passphrase,
    // A plain default rather than an `!== false` dance: see the note on
    // withDefaults in backup-creating-dialog.vue for why the prop needs one.
    withAttachments = true,
    appVersion,
    t,
    $createNotice,
  }: {
    passphrase?: string;
    withAttachments?: boolean;
    appVersion: string;
    t: Translate;
    $createNotice: CreateNotice;
  }): Promise<boolean> {
    cancelRequested = false;
    try {
      onBackupProgress({ stage: 'scanning', totalFiles: 0, processedFiles: 0, percent: 0 });

      const plan: BackupPlan = await chatService.createBackupPlan({ withAttachments });
      throwIfCancelled();

      if (plan.chatsCount === 0) {
        $createNotice({ type: 'info', content: t('backup.create.empty'), duration: 4000 });
        onBackupProgress(null);
        return false;
      }

      // The two lists are merged before the metadata is written, so that the
      // metadata and the user see one and the same array.
      const skipped: SkippedAttachment[] = [...plan.skippedAttachments];
      const attachmentEntries: ArchiveEntry[] = [];
      let attachmentBytes = 0;
      let attachmentsCount = 0;
      const storedBlobNames = new Set<string>();

      for (let i = 0; i < plan.attachmentsToRead.length; i += 1) {
        throwIfCancelled();
        const planned = plan.attachmentsToRead[i];
        onBackupProgress({
          stage: 'reading-attachments',
          totalFiles: plan.attachmentsToRead.length,
          processedFiles: i,
          currentFile: planned.fileName,
          percent: Math.floor((i / plan.attachmentsToRead.length) * 100),
        });

        const read = await readPlannedAttachment(planned);
        if ('skipped' in read) {
          skipped.push(read.skipped);
          continue;
        }
        attachmentEntries.push(...read.entries);
        attachmentBytes += read.bytes;
        attachmentsCount += 1;
        storedBlobNames.add(planned.blobName);
        if (read.partial) {
          skipped.push(read.partial);
        }
      }

      // AES-GCM and the zip both want the whole buffer in memory at once, so the
      // size is checked before anything is packed - and the refusal names a way
      // out the user can act on.
      if (attachmentBytes > BACKUP_MAX_BYTES) {
        throw new Error('archive_too_large');
      }

      // Attachments whose bytes never made it lose their blobName, or a restore
      // would look for an entry that is not there.
      const messages = plan.messages.map(msg => ({
        ...msg,
        ...(msg.attachments && {
          attachments: msg.attachments.map(item =>
            (item.blobName && !storedBlobNames.has(item.blobName))
              ? { ...item, blobName: undefined, omitted: item.omitted ?? ('unreadable' as const) }
              : item,
          ),
        }),
      }));

      onBackupProgress({
        stage: 'compressing',
        totalFiles: attachmentEntries.length + 3,
        processedFiles: 0,
        percent: 0,
      });

      // Attachments FIRST and the json after: `omitted: 'unreadable'` is only
      // known once a read has been attempted, so the records cannot be
      // serialized before the loop above has finished.
      const entries: ArchiveEntry[] = [
        ...attachmentEntries,
        { path: CHATS_FILE_NAME, bytes: utf8(JSON.stringify(plan.chats)) },
        { path: MESSAGES_FILE_NAME, bytes: utf8(JSON.stringify(messages)) },
        { path: TOMBSTONES_FILE_NAME, bytes: utf8(JSON.stringify(plan.tombstones)) },
      ];

      // The metadata goes INSIDE only when the archive is not encrypted; for an
      // encrypted one it goes into the container, where it stays readable
      // without a passphrase.
      if (!passphrase) {
        entries.push({
          path: METADATA_FILE_NAME,
          bytes: makeBackupMetadataBytes({
            version: appVersion,
            snapshotTs: plan.snapshotTs,
            skippedAttachments: skipped,
            chatsCount: plan.chatsCount,
            messagesCount: plan.messagesCount,
            attachmentsCount,
          }),
        });
      }

      const innerZip = await buildZip(entries, (index, total, path) => {
        onBackupProgress({
          stage: 'compressing',
          totalFiles: total,
          processedFiles: index,
          currentFile: path,
          percent: Math.floor((index / total) * 100),
        });
      });
      throwIfCancelled();

      let archiveBytes = innerZip;
      if (passphrase) {
        onBackupProgress({ stage: 'encrypting', totalFiles: 1, processedFiles: 1, percent: 100 });
        archiveBytes = await packEncryptedContainer(innerZip, passphrase, appVersion, {
          // Carried into the container, and it has to be: an encrypted archive
          // keeps no metadata inside, and without this stamp a restore would
          // have no barrier for its `replace` mode. The COUNTS are deliberately
          // not carried - the size of a history is not worth disclosing to
          // somebody who cannot open the archive.
          snapshotTs: plan.snapshotTs,
          skippedAttachments: skipped,
        });
      }

      lastSkippedAttachments.value = skipped;

      onBackupProgress({ stage: 'saving', totalFiles: 1, processedFiles: 1, percent: 100 });

      const { saved, fileName } = await saveBackupArchiveToFile(archiveBytes, appVersion, t);
      if (!saved) {
        // The archive was made, the user declined to keep it - their choice, not
        // a failure.
        reportCancellation(t, $createNotice);
        return false;
      }

      $createNotice({
        type: 'success',
        content: t('backup.create.success', { filename: fileName! }),
        duration: 4000,
      });

      const skippedLines = skippedAttachmentsLines(skipped, t);
      if (skippedLines.length > 0) {
        // A WARNING, and named by reason rather than counted: "N file(s) could
        // not be put in" is exactly the message that sent somebody unpacking
        // the archive by hand to find out why it held nothing.
        $createNotice({
          type: 'warning',
          content: [t('backup.create.skippedTitle'), ...skippedLines].join(' '),
          duration: 10000,
        });
      }

      log.info(
        `Backup saved: ${plan.chatsCount} chat(s), ${plan.messagesCount} message(s), `
          + `${attachmentsCount} file(s), ${skipped.length} skipped`,
      );
      onBackupProgress(null);
      return true;
    } catch (err) {
      return handleBackupError(err, t, $createNotice);
    }
  }

  return {
    backupProgress,
    restoreProgress,
    lastSkippedAttachments,
    onBackupProgress,
    onRestoreProgress,
    applyServiceBackupProgress,
    saveBackupArchiveToFile,
    runBackupWorkflow,
    cancelBackup,
  };
});
