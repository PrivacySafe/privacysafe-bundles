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
// Driving a backup and a restore from the GUI: pick the file, ask the service
// what is in it, get the user to choose which rule to apply, then run it. A
// composable rather than a store, because it needs the dialogs plugin.
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DIALOGS_KEY,
  NOTIFICATIONS_KEY,
  type DialogsPlugin,
  type NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { inboxSrv } from '@common/services/services-provider';
import { useBackupStore, useMessagesStore } from '@common/store';
import {
  BackupArchiveFailure,
  openBackupContainer,
  type OpenedBackupContainer,
} from '@common/utils/backup-container';
import { isSubtleCryptoAvailable } from '@common/utils/backup-crypto';
import BackupCreatingDialog from '@common/components/dialogs/backup-creating-dialog/backup-creating-dialog.vue';
import BackupPassphraseDialog from '@common/components/dialogs/backup-passphrase-dialog/backup-passphrase-dialog.vue';
import BackupRestoringDialog from '@common/components/dialogs/backup-restoring-dialog/backup-restoring-dialog.vue';
import RestoreOptionsDialog from '@common/components/dialogs/restore-options-dialog/restore-options-dialog.vue';
import type {
  BackupArchiveError,
  BackupValidationResult,
} from '@deno/types/backup.types';
import type { RestoreMode } from '@deno/types/sync-types';

/** Reason the archive cannot be used → what the user is told about it. */
const errorTextKey: Record<BackupArchiveError, string> = {
  corrupted_archive: 'backup.restore.errorCorruptedArchive',
  foreign_archive: 'backup.restore.errorForeignArchive',
  no_messages: 'backup.restore.errorNoMessages',
  unreadable_records: 'backup.restore.errorUnreadableRecords',
  archive_too_large: 'backup.create.errorTooLarge',
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

  const backupStore = useBackupStore();
  const { onRestoreProgress } = backupStore;
  const messagesStore = useMessagesStore();

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
        title: (mode === 'create')
          ? t('backup.passphrase.createTitle')
          : t('backup.passphrase.openTitle'),
        // Note that the icon set is not open-ended: a name it does not define
        // renders as nothing at all, and silently.
        icon: (mode === 'create') ? 'outline-file-download' : 'outline-file-upload',
        confirmButtonText: (mode === 'create') ? t('app.btn.save') : t('backup.passphrase.openBtn'),
        cancelButtonText: t('app.btn.cancel'),
        closeOnClickOverlay: false,
      },
    });

    return (res?.event === 'confirm') ? (res.data ?? '') : undefined;
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

  /**
   * The whole of making a backup, from the passphrase to the saved file.
   *
   * Named apart from the store's `runBackupWorkflow`, which it is not: that one
   * does the work and drives the progress; this one puts the dialogs around it.
   */
  async function startBackupWorkflow(): Promise<void> {
    const asked = await askBackupPassphrase();
    if (!asked) {
      return;
    }

    // NOT awaited for its own sake: the dialog starts the work as it is set up
    // and renders the progress the store carries.
    await dialog?.$openDialog<boolean>(BackupCreatingDialog, {
      passphrase: asked.passphrase,
      dialogProps: {
        icon: 'outline-file-download',
        title: t('backup.create.dialogTitle'),
        cssStyle: { width: '570px', maxWidth: '95%' },
        hideCloseButton: true,
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: false,
        closeOnEsc: false,
      },
    });
  }

  /** The mode the user picked, or undefined when they backed out. */
  async function askRestoreMode(
    validation: BackupValidationResult,
  ): Promise<RestoreMode | undefined> {
    if (!dialog) {
      return undefined;
    }

    const res = await dialog.$openDialog<RestoreMode>(RestoreOptionsDialog, {
      validation,
      // `messageList` is keyed by msgId, not an array.
      currentMessagesCount: Object.keys(messagesStore.messageList ?? {}).length,
      dialogProps: {
        title: t('backup.restore.confirmTitle'),
        icon: validation.compatible ? 'outline-file-upload' : 'round-warning',
        confirmButtonText: t('backup.restore.confirmBtn'),
        cancelButtonText: t('app.btn.cancel'),
        cssStyle: { width: '570px', maxWidth: '95%' },
        hideCloseButton: true,
        closeOnClickOverlay: false,
      },
    });

    return (res?.event === 'confirm') ? res.data : undefined;
  }

  async function executeRestoration(
    archiveBytes: Uint8Array,
    mode: RestoreMode,
    opened: OpenedBackupContainer,
  ): Promise<boolean> {
    try {
      onRestoreProgress({
        stage: opened.encrypted ? 'decrypting' : 'unpacking',
        totalItems: 0,
        processedItems: 0,
        percent: 0,
      });

      // NOT awaited: the dialog only renders the progress, and awaiting it would
      // hold the restore until the user closed it.
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

      // An encrypted archive keeps its metadata in the container out here, so it
      // is passed along explicitly - the service needs `snapshotTs` from it.
      const outcome = await inboxSrv.restoreBackupArchive(
        archiveBytes,
        mode,
        opened.encrypted ? opened.metadata : undefined,
      );

      if (outcome?.restored) {
        // The service also emits `lists`/`reload`, which refetches; asked for
        // here as well so the lists are right even if that event is missed.
        await messagesStore.getMessages();

        $createNotice({
          type: 'success',
          content: t('backup.restore.success', {
            created: outcome.created,
            updated: outcome.updated,
            deleted: outcome.deleted,
          }),
          duration: 6000,
        });

        if (outcome.inboxListingFailed) {
          // Said out loud: with no listing the restore could not tell which
          // incoming messages are still on the server, so attachments it marked
          // as reachable may not be.
          $createNotice({
            type: 'warning',
            content: t('backup.restore.offlineNotice'),
            duration: 8000,
          });
        }
      }

      onRestoreProgress(null);
      return !!outcome?.restored;
    } catch (err) {
      await w3n.log('error', 'Restoring a backup failed', err);
      onRestoreProgress({ stage: 'error', totalItems: 0, processedItems: 0, percent: 0 });
      $createNotice({ type: 'error', content: t('backup.restore.error'), duration: 4000 });
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

    const validation = await inboxSrv.validateBackupArchive(
      opened.plainZipBytes,
      opened.encrypted ? opened.metadata : undefined,
    );

    if (!validation.valid) {
      reportArchiveError(validation.error ?? 'corrupted_archive');
      return false;
    }

    const mode = await askRestoreMode({ ...validation, encrypted: opened.encrypted });
    if (!mode) {
      return false;
    }

    return executeRestoration(opened.plainZipBytes, mode, opened);
  }

  return {
    pickBackupArchiveFile,
    askBackupPassphrase,
    askRestoreMode,
    executeRestoration,
    startBackupWorkflow,
    runRestoreWorkflow,
  };
}
