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
*/
// The GUI half of making a backup: the service produces the bytes, this asks the
// user where to put them. The file dialogs live here rather than in the service
// because `shell.fileDialog` is a capability of the windows only - and the
// service is the only one with `storage`, which is why the archive travels as
// bytes over the IPC (see BACKUP_MAX_BYTES).
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { inboxSrv } from '@common/services/services-provider';
import { backupFileName } from '@deno/utils/backup-archive';
import { packEncryptedContainer } from '@common/utils/backup-container';
import { skippedAttachmentsLines } from '@common/utils/skipped-attachments';
import type { Ui3nNotificationProps } from '@v1nt1248/3nclient-lib';
import type { BackupProgress, RestoreProgress, SkippedAttachment } from '@deno/types/backup.types';

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

/** Whether the service refused because the mailbox is too big to carry. */
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

export const useBackupStore = defineStore('backup', () => {
  const backupProgress = ref<BackupProgress | null>(null);
  const restoreProgress = ref<RestoreProgress | null>(null);
  /** What the last backup could not take along; shown once it is saved. */
  const lastSkippedAttachments = ref<SkippedAttachment[]>([]);

  function onBackupProgress(value: BackupProgress | null): void {
    backupProgress.value = value;
  }

  function onRestoreProgress(value: RestoreProgress | null): void {
    restoreProgress.value = value;
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
      { filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] },
    );

    if (!file) {
      return { saved: false };
    }

    await file.writeBytes(archiveBytes);
    return { saved: true, fileName: file.name || defaultFileName };
  }

  function reportCancellation(t: Translate, $createNotice: CreateNotice): void {
    $createNotice({ type: 'warning', content: t('backup.create.cancel'), duration: 4000 });
    onBackupProgress(null);
  }

  async function cancelBackup(t: Translate, $createNotice: CreateNotice): Promise<void> {
    try {
      await inboxSrv.cancelBackupArchive();
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

  async function runBackupWorkflow({
    passphrase,
    // A plain default rather than the `!== false` dance the caller used to do:
    // that idiom exists to survive an `undefined`, and surviving `undefined` was
    // never the problem - see the note on withDefaults in backup-creating-dialog.
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
    try {
      // With a passphrase the service leaves the metadata out: it goes into the
      // container built here, where it stays readable without a key.
      const packed = await inboxSrv.createBackupArchive({
        ...(passphrase && { forEncryption: true }),
        withAttachments,
      });
      if (!packed?.bytes) {
        $createNotice({ type: 'info', content: t('backup.create.empty'), duration: 4000 });
        onBackupProgress(null);
        return false;
      }

      lastSkippedAttachments.value = packed.skippedAttachments ?? [];

      let archiveBytes = packed.bytes;
      if (passphrase) {
        onBackupProgress({ stage: 'encrypting', totalFiles: 1, processedFiles: 1, percent: 100 });

        archiveBytes = await packEncryptedContainer(packed.bytes, passphrase, appVersion, {
          // Carried into the container, and it has to be: an encrypted archive
          // keeps no metadata inside, and without this stamp a restore would
          // have no barrier for its `replace` mode. The counts are deliberately
          // NOT carried - the size of a mailbox is not worth disclosing to
          // somebody who cannot open the archive.
          snapshotTs: packed.snapshotTs,
          skippedAttachments: packed.skippedAttachments,
        });
      }

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
      const skippedLines = skippedAttachmentsLines(lastSkippedAttachments.value, t);
      if (skippedLines.length > 0) {
        // A WARNING, and named by reason rather than counted. A live run
        // produced an archive with no attachments at all, and the only way to
        // find out why was to unpack the file and read its metadata - because
        // all this said was "N attachment(s) could not be put in".
        $createNotice({
          type: 'warning',
          content: [t('backup.create.skippedTitle'), ...skippedLines].join(' '),
          duration: 10000,
        });
      }
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
    saveBackupArchiveToFile,
    runBackupWorkflow,
    cancelBackup,
  };
});
