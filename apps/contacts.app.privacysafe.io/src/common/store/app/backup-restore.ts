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
// The gui half of making a backup: the service produces the bytes, this asks
// the user where to put them. The file dialogs live here rather than in the
// service because shell.fileDialog is a capability of the windows only.
import { ref } from 'vue';
import { appContactsSrvProxy } from '@main/common/services/services-provider';
import { backupFileName } from '@deno/utils/backup-archive.ts';
import { packEncryptedContainer } from '@main/common/utils/backup-container';
import type { Ui3nNotificationProps } from '@v1nt1248/3nclient-lib';
import type { BackupProgress, RestoreProgress } from '@main/types';

/** Only what these workflows need of vue-i18n's `t`, so it can be passed in. */
export type Translate = (key: string, named?: Record<string, unknown>) => string;

export type CreateNotice = (params: Ui3nNotificationProps) => void;

/**
 * Whether a failure is the user's own cancellation.
 *
 * Matched on text, which is not as crude as it looks: the error crosses the ipc
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

export function useBackupRestoreState() {
  const backupProgress = ref<BackupProgress | null>(null);
  const restoreProgress = ref<RestoreProgress | null>(null);

  function onBackupProgress(value: BackupProgress | null): void {
    backupProgress.value = value;
  }

  function onRestoreProgress(value: RestoreProgress | null): void {
    restoreProgress.value = value;
  }

  async function saveBackupArchiveToFile(
    archiveBytes: Uint8Array, appVersion: string, t: Translate,
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
    $createNotice({
      type: 'warning',
      content: t('backup.create.cancel'),
      duration: 4000,
    });
    onBackupProgress(null);
  }

  async function cancelBackup(t: Translate, $createNotice: CreateNotice): Promise<void> {
    try {
      await appContactsSrvProxy.cancelBackupArchive?.();
    } catch (err) {
      await w3n.log('info', 'Could not cancel the backup being created', err);
    } finally {
      reportCancellation(t, $createNotice);
    }
  }

  function handleBackupError(
    err: unknown, t: Translate, $createNotice: CreateNotice,
  ): boolean {
    if (isBackupCancelledError(err)) {
      w3n.log('info', 'Creation of a backup was cancelled');
      reportCancellation(t, $createNotice);
      return false;
    }

    w3n.log('error', 'Creation of a backup failed', err);

    onBackupProgress({ stage: 'error', totalFiles: 0, processedFiles: 0, percent: 0 });
    $createNotice({
      type: 'error',
      content: t('backup.create.error'),
      duration: 4000,
    });
    // Left on screen for a moment: the dialog closes on a null progress, and
    // closing it the instant the error arrives would take the message with it.
    setTimeout(() => onBackupProgress(null), 3000);

    return false;
  }

  async function runBackupWorkflow({ passphrase, appVersion, t, $createNotice }: {
    passphrase?: string;
    appVersion: string;
    t: Translate;
    $createNotice: CreateNotice;
  }): Promise<boolean> {
    try {
      // With a passphrase the service leaves the metadata out: it goes into the
      // container built here, where it stays readable without a key.
      const packed = await appContactsSrvProxy.createBackupArchive(
        passphrase ? { forEncryption: true } : undefined,
      );
      if (!packed?.bytes) {
        $createNotice({ type: 'info', content: t('backup.create.empty'), duration: 4000 });
        onBackupProgress(null);
        return false;
      }

      let archiveBytes = packed.bytes;
      if (passphrase) {
        onBackupProgress({
          stage: 'encrypting', totalFiles: 1, processedFiles: 1, percent: 100,
        });

        archiveBytes = await packEncryptedContainer(
          packed.bytes, passphrase, appVersion, packed.skippedImages,
        );
      }

      onBackupProgress({
        stage: 'saving', totalFiles: 1, processedFiles: 1, percent: 100,
      });

      const { saved, fileName } = await saveBackupArchiveToFile(archiveBytes, appVersion, t);
      if (!saved) {
        // The archive was made, the user declined to keep it - their choice,
        // not a failure.
        reportCancellation(t, $createNotice);
        return false;
      }

      $createNotice({
        type: 'success',
        content: t('backup.create.success', { filename: fileName! }),
        duration: 4000,
      });
      onBackupProgress(null);

      return true;
    } catch (err) {
      return handleBackupError(err, t, $createNotice);
    }
  }

  return {
    backupProgress,
    restoreProgress,
    onBackupProgress,
    onRestoreProgress,
    saveBackupArchiveToFile,
    runBackupWorkflow,
    cancelBackup,
  };
}
