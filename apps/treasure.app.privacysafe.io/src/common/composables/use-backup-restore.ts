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
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DIALOGS_KEY,
  NOTIFICATIONS_KEY,
  type DialogsPlugin,
  type NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { appTreasureDenoSrv } from '@/common/services/service-provider';
import { useAppStore } from '@/common/stores/app.store';
import { useRecordStore } from '@/common/stores/record.store';
import {
  BackupArchiveFailure,
  openBackupContainer,
  validateBackupContainer,
  type OpenedBackupContainer,
} from '@/common/utils/backup-container';
import { isSubtleCryptoAvailable } from '@/common/utils/backup-crypto';
import ConfirmationDialog from '@/common/components/dialogs/confirmation-dialog.vue';
import BackupPassphraseDialog from '@/common/components/dialogs/backup-passphrase-dialog.vue';
import BackupRestoringDialog from '@/common/components/dialogs/backup-restoring-dialog.vue';
import type { BackupArchiveError, BackupValidationResult } from '@shared/@types';

/** Reason the archive cannot be used → what the user is told about it. */
const errorTextKey: Record<BackupArchiveError, string> = {
  corrupted_archive: 'backup.restore.errorCorruptedArchive',
  foreign_archive: 'backup.restore.errorForeignArchive',
  passphrase_required: 'backup.restore.errorPassphraseRequired',
  wrong_passphrase: 'backup.passphrase.wrong',
  encryption_unsupported: 'backup.restore.errorEncryptionUnsupported',
};

async function readFileBytes(file: unknown): Promise<Uint8Array | null> {
  if (!file) {
    return null;
  }

  if (file instanceof Uint8Array) {
    return file;
  }

  if (file instanceof ArrayBuffer) {
    return new Uint8Array(file);
  }

  if (typeof (file as { readBytes?: unknown }).readBytes === 'function') {
    const bytes = await (file as { readBytes: () => Promise<Uint8Array | undefined> }).readBytes();
    return bytes || null;
  }

  if (typeof (file as Blob).arrayBuffer === 'function') {
    const buffer = await (file as Blob).arrayBuffer();
    return new Uint8Array(buffer);
  }

  if (typeof (file as { bytes?: unknown }).bytes === 'function') {
    return (file as { bytes: () => Promise<Uint8Array> }).bytes();
  }

  return null;
}

export function useBackupRestore() {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY);
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const appStore = useAppStore();
  const { onRestoreProgress } = appStore;
  const recordStore = useRecordStore();

  /** Answers the passphrase, or undefined when the user backs out. */
  async function askPassphrase(
    mode: 'create' | 'open',
    wrongPassphrase?: boolean,
  ): Promise<string | undefined> {
    if (!dialog) {
      return undefined;
    }

    const res = await dialog.$openDialog<string>(BackupPassphraseDialog, {
      mode,
      wrongPassphrase,
      dialogProps: {
        title:
          mode === 'create' ? t('backup.passphrase.createTitle') : t('backup.passphrase.openTitle'),
        icon: mode === 'create' ? 'outline-file-download' : 'outline-file-upload',
        confirmButtonText: mode === 'create' ? t('app.btn.save') : t('backup.passphrase.openBtn'),
        cancelButtonText: t('app.btn.cancel'),
        hideCloseButton: true,
      },
    });

    return res?.event === 'confirm' ? (res.data ?? '') : undefined;
  }

  /**
   * Asks for a passphrase before a backup, when this build can encrypt at all.
   * Answers `{ passphrase }` to go ahead, or undefined when the user backs out.
   */
  async function askBackupPassphrase(): Promise<{ passphrase?: string } | undefined> {
    if (!isSubtleCryptoAvailable()) {
      w3n.log('info', 'Backups cannot be encrypted in this runtime');
      return {};
    }

    const entered = await askPassphrase('create');
    return entered === undefined ? undefined : { passphrase: entered || undefined };
  }

  async function pickBackupArchiveFile(): Promise<Uint8Array | null> {
    if (!w3n.shell?.fileDialogs?.openFileDialog) {
      return null;
    }

    const files = await w3n.shell.fileDialogs.openFileDialog(
      t('backup.restore.fileDialogTitle'),
      t('backup.restore.fileDialogBtn'),
      false,
      { filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] },
    );

    if (!files) {
      return null;
    }

    const selectedFile = Array.isArray(files) ? files[0] : files;
    if (!selectedFile) {
      return null;
    }

    return readFileBytes(selectedFile);
  }

  async function confirmRestoration(validation: BackupValidationResult): Promise<boolean> {
    if (!dialog) {
      return true;
    }

    const isCompatible = validation.compatible;
    const confirmDialogText = isCompatible
      ? t('backup.restore.confirmText', { version: validation.archiveVersion || 'unknown' })
      : t('backup.restore.confirmWarningText', {
          archiveVersion: validation.archiveVersion || 'unknown',
          appVersion: validation.appVersion,
        });

    const confirmBtnText = isCompatible
      ? t('backup.restore.confirmBtn')
      : t('backup.restore.confirmAtOwnRiskBtn');

    const confirmTitle = isCompatible
      ? t('backup.restore.confirmTitle')
      : t('backup.restore.confirmWarningTitle');

    const confirmDialogRes = await dialog.$openDialog(ConfirmationDialog, {
      dialogText: confirmDialogText,
      dialogProps: {
        title: confirmTitle,
        icon: isCompatible ? 'outline-file-upload' : 'outline-warning',
        confirmButtonText: confirmBtnText,
        cancelButtonText: t('app.btn.cancel'),
        hideCloseButton: true,
        dangerConfirm: !isCompatible,
      },
    });

    return confirmDialogRes?.event === 'confirm';
  }

  async function executeRestoration(archiveBytes: Uint8Array, wasEncrypted?: boolean): Promise<boolean> {
    try {
      onRestoreProgress({
        stage: wasEncrypted ? 'decrypting' : 'unpacking',
        totalFiles: 0,
        processedFiles: 0,
        percent: 0,
      });

      if (dialog) {
        dialog.$openDialog(BackupRestoringDialog, {
          dialogProps: {
            icon: 'outline-file-upload',
            title: t('backup.restore.dialogTitle'),
            cssStyle: { width: '570px', maxWidth: '95%', borderRadius: '16px' },
            hideCloseButton: true,
            confirmButton: false,
            cancelButton: false,
          },
        });
      }

      const restoreResult = await appTreasureDenoSrv.restoreBackupArchive(archiveBytes);

      if (restoreResult) {
        await recordStore.getAllGroups();
        await recordStore.getAllRecords();
        await recordStore.loadRecentRecords();

        $createNotice({
          type: 'success',
          content: t('backup.restore.success'),
          duration: 4000,
        });
      }

      onRestoreProgress(null);
      return true;
    } catch (err: unknown) {
      w3n.log('error', 'Restore failed: ', err);
      onRestoreProgress({
        stage: 'error',
        totalFiles: 0,
        processedFiles: 0,
        percent: 0,
      });
      $createNotice({
        type: 'error',
        content: t('backup.restore.error'),
        duration: 4000,
      });
      setTimeout(() => {
        onRestoreProgress(null);
      }, 3000);
      return false;
    }
  }

  function reportArchiveError(error: BackupArchiveError): void {
    $createNotice({
      type: 'error',
      content: t(errorTextKey[error] ?? 'backup.restore.error'),
      duration: 4000,
    });
  }

  /**
   * Opens the picked file, asking for a passphrase as many times as the user is
   * willing to try: a mistyped one is a slip, not a reason to start over.
   *
   * Answers undefined when the user backs out or the archive cannot be used.
   */
  async function openPickedArchive(fileBytes: Uint8Array): Promise<OpenedBackupContainer | undefined> {
    let passphrase: string | undefined;

    for (;;) {
      try {
        return await openBackupContainer(fileBytes, passphrase);
      } catch (err) {
        if (!(err instanceof BackupArchiveFailure)) {
          throw err;
        }

        if (err.reason !== 'passphrase_required' && err.reason !== 'wrong_passphrase') {
          reportArchiveError(err.reason);
          return undefined;
        }

        const entered = await askPassphrase('open', err.reason === 'wrong_passphrase');
        if (entered === undefined) {
          return undefined;
        }
        passphrase = entered;
      }
    }
  }

  async function runRestoreWorkflow(): Promise<boolean> {
    const fileBytes = await pickBackupArchiveFile();
    if (!fileBytes) {
      return false;
    }

    let opened: OpenedBackupContainer | undefined;
    try {
      opened = await openPickedArchive(fileBytes);
    } catch (err) {
      w3n.log('error', 'Reading the backup archive failed: ', err);
      reportArchiveError('corrupted_archive');
      return false;
    }

    if (!opened) {
      return false;
    }

    const validation = validateBackupContainer(opened, appStore.appVersion);
    if (!validation.valid) {
      reportArchiveError(validation.error ?? 'corrupted_archive');
      return false;
    }

    const isConfirmed = await confirmRestoration(validation);
    if (!isConfirmed) {
      return false;
    }

    return executeRestoration(opened.plainZipBytes, opened.encrypted);
  }

  return {
    pickBackupArchiveFile,
    askBackupPassphrase,
    confirmRestoration,
    executeRestoration,
    runRestoreWorkflow,
  };
}
