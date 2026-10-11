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
// Driving a restore from the gui: pick the file, ask the service what is in it,
// get the user to confirm what it will replace, then run it. A composable
// rather than a store, because it needs the dialogs plugin.
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DIALOGS_KEY,
  NOTIFICATIONS_KEY,
  type DialogsPlugin,
  type NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { appContactsSrvProxy } from '@main/common/services/services-provider';
import { useAppStore } from '@main/common/store/app.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import {
  BackupArchiveFailure,
  openBackupContainer,
  type OpenedBackupContainer,
} from '@main/common/utils/backup-container';
import { isSubtleCryptoAvailable } from '@main/common/utils/backup-crypto';
import ConfirmationDialog from '@main/common/components/dialogs/confirmation-dialog.vue';
import BackupPassphraseDialog from '@main/common/components/dialogs/backup-passphrase-dialog.vue';
import BackupRestoringDialog from '@main/common/components/dialogs/backup-restoring-dialog.vue';
import type { BackupArchiveError, BackupValidationResult } from '@main/types';

/** Reason the archive cannot be used → what the user is told about it. */
const errorTextKey: Record<BackupArchiveError, string> = {
  corrupted_archive: 'backup.restore.errorCorruptedArchive',
  foreign_archive: 'backup.restore.errorForeignArchive',
  no_contacts_db: 'backup.restore.errorNoContacts',
  unreadable_db: 'backup.restore.errorUnreadableDb',
  passphrase_required: 'backup.restore.errorPassphraseRequired',
  wrong_passphrase: 'backup.passphrase.wrong',
  encryption_unsupported: 'backup.restore.errorEncryptionUnsupported',
};

/**
 * Bytes of whatever the file dialog handed over.
 *
 * The platform's own dialog answers ReadonlyFile objects, but this call is
 * served over rpc by the files app, and what comes back has varied - so the
 * shapes a file can plausibly arrive in are all accepted.
 */
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
    return new Uint8Array(await (file as Blob).arrayBuffer());
  }
  return null;
}

export function useBackupRestore() {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY);
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const appStore = useAppStore();
  const { onRestoreProgress } = appStore;
  const contactsStore = useContactsStore();

  async function pickBackupArchiveFile(): Promise<Uint8Array | null> {
    if (!w3n.shell?.fileDialogs?.openFileDialog) {
      return null;
    }

    // Kept in its own try: the dialog is served by the files app over rpc, and
    // that connection can be closed under us - which must read as "no file
    // chosen", not as a failed restore.
    let files: unknown;
    try {
      files = await w3n.shell.fileDialogs.openFileDialog(
        t('backup.restore.fileDialogTitle'),
        t('backup.restore.fileDialogBtn'),
        false,
        { filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] },
      );
    } catch (err) {
      await w3n.log('info', 'Could not open the file dialog to pick a backup archive', err);
      return null;
    }

    if (!files) {
      return null;
    }

    const selected = Array.isArray(files) ? files[0] : files;
    return readFileBytes(selected);
  }

  /** Answers the passphrase, or undefined when the user backs out. */
  async function askPassphrase(
    mode: 'create' | 'open', wrongPassphrase?: boolean,
  ): Promise<string | undefined> {
    if (!dialog) {
      return undefined;
    }

    const res = await dialog.$openDialog<string>(BackupPassphraseDialog, {
      mode,
      wrongPassphrase,
      dialogProps: {
        title: (mode === 'create')
          ? t('backup.passphrase.createTitle')
          : t('backup.passphrase.openTitle'),
        // The same icons the menu items carry. Note that the icon set is not
        // open-ended: a name it does not define renders as nothing at all,
        // silently, which is how 'outline-lock' got here and showed up blank.
        icon: (mode === 'create') ? 'outline-file-download' : 'outline-file-upload',
        confirmButtonText: (mode === 'create') ? t('app.btn.save') : t('backup.passphrase.openBtn'),
        cancelButtonText: t('app.btn.cancel'),
        closeOnClickOverlay: false,
      },
    });

    return (res?.event === 'confirm') ? (res.data ?? '') : undefined;
  }

  async function confirmRestoration(validation: BackupValidationResult): Promise<boolean> {
    if (!dialog) {
      return true;
    }

    const isCompatible = validation.compatible;
    const dialogText = isCompatible
      ? t('backup.restore.confirmText', {
        archived: validation.contactsCount ?? 0,
        current: contactsStore.contacts.length,
      })
      : t('backup.restore.confirmWarningText', {
        archiveVersion: validation.archiveVersion || t('backup.restore.unknownVersion'),
        appVersion: validation.appVersion,
      });

    const res = await dialog.$openDialog<boolean>(ConfirmationDialog, {
      dialogText,
      dialogProps: {
        title: isCompatible
          ? t('backup.restore.confirmTitle')
          : t('backup.restore.confirmWarningTitle'),
        icon: isCompatible ? 'outline-file-upload' : 'round-warning',
        confirmButtonText: isCompatible
          ? t('backup.restore.confirmBtn')
          : t('backup.restore.confirmAtOwnRiskBtn'),
        cancelButtonText: t('app.btn.cancel'),
        hideCloseButton: true,
        closeOnClickOverlay: false,
      },
    });

    return res?.event === 'confirm';
  }

  async function executeRestoration(
    archiveBytes: Uint8Array, wasEncrypted?: boolean,
  ): Promise<boolean> {
    try {
      onRestoreProgress({
        stage: wasEncrypted ? 'decrypting' : 'unpacking',
        totalFiles: 0,
        processedFiles: 0,
        percent: 0,
      });

      // NOT awaited: the dialog only renders the progress, and awaiting it
      // would hold the restore until the user closed it.
      dialog?.$openDialog(BackupRestoringDialog, {
        dialogProps: {
          icon: 'outline-file-upload',
          title: t('backup.restore.dialogTitle'),
          cssStyle: { width: '570px', maxWidth: '95%' },
          hideCloseButton: true,
          confirmButton: false,
          cancelButton: false,
          closeOnClickOverlay: false,
          closeOnEsc: false,
        },
      });

      const isRestored = await appContactsSrvProxy.restoreBackupArchive(archiveBytes);
      if (isRestored) {
        // The service also emits update:contact-list, which refetches; asked
        // for here as well so the list is right even if that event is missed.
        await contactsStore.fetchContacts({ withFullOverload: true });

        $createNotice({
          type: 'success',
          content: t('backup.restore.success'),
          duration: 4000,
        });
      }

      onRestoreProgress(null);
      return isRestored;
    } catch (err) {
      await w3n.log('error', 'Restoring a backup failed', err);
      onRestoreProgress({
        stage: 'error', totalFiles: 0, processedFiles: 0, percent: 0,
      });
      $createNotice({
        type: 'error',
        content: t('backup.restore.error'),
        duration: 4000,
      });
      setTimeout(() => onRestoreProgress(null), 3000);
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
  async function openPickedArchive(
    fileBytes: Uint8Array,
  ): Promise<OpenedBackupContainer | undefined> {
    let passphrase: string | undefined;

    for (;;) {
      try {
        return await openBackupContainer(fileBytes, passphrase);
      } catch (err) {
        if (!(err instanceof BackupArchiveFailure)) {
          throw err;
        }

        if ((err.reason !== 'passphrase_required') && (err.reason !== 'wrong_passphrase')) {
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
      await w3n.log('error', 'Reading the backup archive failed', err);
      reportArchiveError('corrupted_archive');
      return false;
    }

    if (!opened) {
      return false;
    }

    // The service is handed the inner archive; an encrypted one keeps its
    // metadata in the container out here, so it is passed along explicitly.
    const validation = await appContactsSrvProxy.validateBackupArchive(
      opened.plainZipBytes, opened.encrypted ? opened.metadata : undefined,
    );

    if (!validation.valid) {
      reportArchiveError(validation.error ?? 'corrupted_archive');
      return false;
    }

    if (!(await confirmRestoration({ ...validation, encrypted: opened.encrypted }))) {
      return false;
    }

    return executeRestoration(opened.plainZipBytes, opened.encrypted);
  }

  /**
   * Asks for a passphrase before a backup, when this build can encrypt at all.
   * Answers `{ passphrase }` to go ahead, or undefined when the user backs out.
   */
  async function askBackupPassphrase(): Promise<{ passphrase?: string } | undefined> {
    if (!isSubtleCryptoAvailable()) {
      await w3n.log('info', 'Backups cannot be encrypted in this runtime');
      return {};
    }

    const entered = await askPassphrase('create');
    return (entered === undefined) ? undefined : { passphrase: entered || undefined };
  }

  return {
    pickBackupArchiveFile,
    askBackupPassphrase,
    confirmRestoration,
    executeRestoration,
    runRestoreWorkflow,
  };
}
