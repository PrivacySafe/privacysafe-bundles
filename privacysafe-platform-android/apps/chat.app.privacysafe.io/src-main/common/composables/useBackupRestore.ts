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
// Driving a backup and a restore from the GUI: pick the file, read what is in
// it, get the user to choose which rule to apply, then run it. A composable
// rather than a store, because it needs the dialogs plugin.
//
// Validation of an archive happens HERE, with the pure functions of
// shared-libs: there is nothing about it the database side could answer better,
// and an IPC method for it would only be a way of asking the same question
// further away.
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { unzipSync } from 'fflate';
import {
  DIALOGS_KEY,
  NOTIFICATIONS_KEY,
  type DialogsPlugin,
  type NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { chatService, fileLinkStoreSrv } from '@main/common/services/external-services';
import { useAppStore } from '@main/common/store/app.store';
import { useBackupStore } from '@main/common/store/backup.store';
import { useChatsStore } from '@main/common/store/chats.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import {
  BackupArchiveFailure,
  openBackupContainer,
  type OpenedBackupContainer,
} from '@main/common/utils/backup-container';
import { isSubtleCryptoAvailable } from '@main/common/utils/backup-crypto';
import { isSafeArchivePath, splitArchiveEntries } from '@shared/backup-archive';
import {
  checkBackupFormatCompatibility,
  checkBackupVersionCompatibility,
} from '@shared/check-backup-version';
import { BACKUP_FORMAT_VERSION } from '@shared/constants/backup';
import BackupCreatingDialog from '@main/common/components/dialogs/backup-creating-dialog.vue';
import BackupNoticesDialog from '@main/common/components/dialogs/backup-notices-dialog.vue';
import BackupPassphraseDialog from '@main/common/components/dialogs/backup-passphrase-dialog.vue';
import BackupRestoringDialog from '@main/common/components/dialogs/backup-restoring-dialog.vue';
import RestoreOptionsDialog from '@main/common/components/dialogs/restore-options-dialog.vue';
import { makeLogger } from '@shared/logger';
import type {
  BackupArchiveError,
  BackupRecordFiles,
  BackupValidationResult,
  RestoreMode,
  RestorePreview,
} from '~/backup.types';

const log = makeLogger('BackupRestore');

/**
 * How long the restoring dialog stays on screen at the least.
 *
 * A small archive with no attachments is restored in a couple of hundred
 * milliseconds, most of it the platform's inbox listing, so the dialog used to
 * flash - and a flash reads as "nothing happened" rather than as "it is
 * finished". The same floor, and for the same reason, as the synchronization
 * indicator's MIN_VISIBLE_MILLIS in src-deno/utils/sync-activity.ts.
 *
 * It delays only the CLOSING of the dialog: the records are already written and
 * the stores already re-read by the time this is waited out.
 */
const MIN_RESTORE_DIALOG_MILLIS = 1200;

/** Reason the archive cannot be used → what the user is told about it. */
const errorTextKey: Record<BackupArchiveError, string> = {
  corrupted_archive: 'backup.restore.errorCorruptedArchive',
  foreign_archive: 'backup.restore.errorForeignArchive',
  no_chats: 'backup.restore.errorNoChats',
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

function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Waits out whatever is left of MIN_RESTORE_DIALOG_MILLIS, and nothing more. */
function keepDialogVisibleUntilFloor(startedAt: number): Promise<void> {
  const left = MIN_RESTORE_DIALOG_MILLIS - (Date.now() - startedAt);
  return (left > 0) ? new Promise(resolve => setTimeout(resolve, left)) : Promise.resolve();
}

/** The archive as this side reads it, before anything is written anywhere. */
interface ReadArchive {
  recordFiles: BackupRecordFiles;
  /** blobName -> bytes of a file attachment. */
  attachments: Map<string, Uint8Array>;
  /** blobName -> (path inside the folder -> bytes). */
  folderAttachments: Map<string, Map<string, Uint8Array>>;
  validation: BackupValidationResult;
}

export function useBackupRestore() {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY);
  // Both plugins are taken as possibly absent, and NOT asserted with `!`.
  // useAppView() calls this composable, and useAppView() is itself called
  // outside a component's setup by the test app - where `inject` answers
  // undefined and destructuring the answer would throw before a single spec
  // ran. The workflows here are driven from menu clicks, which only happen with
  // a mounted window, so a missing plugin means "no window to tell", not a
  // failure; the line still goes to the log.
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);
  const $createNotice: NotificationsPlugin['$createNotice'] = notifications?.$createNotice
    ?? (params => {
      w3n.log('info', `Notice with no window to show it: ${String(params.content)}`);
    });

  const appStore = useAppStore();
  const backupStore = useBackupStore();
  const { onRestoreProgress } = backupStore;
  const chatsStore = useChatsStore();
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
        { filters: [{ name: t('backup.zipFilterName'), extensions: ['zip'] }] },
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
        icon: (mode === 'create') ? 'shield-alert-outline' : 'outline-file-upload',
        confirmButtonText: (mode === 'create') ? t('app.text.save') : t('backup.passphrase.openBtn'),
        cancelButtonText: t('app.text.cancel'),
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
   * Says what an archive can and cannot bring back, and waits to be let on.
   *
   * A step of its own, because it is the last one the user can still walk away
   * from: after it the chats are read, the archive is packed and the platform
   * asks where to save it. These explanations used to sit inside the creating
   * dialog, where a small backup left them on screen for under a second.
   */
  async function confirmBackupNotices(): Promise<boolean> {
    if (!dialog) {
      return false;
    }

    const res = await dialog.$openDialog<boolean>(BackupNoticesDialog, {
      dialogProps: {
        icon: 'outline-file-download',
        title: t('backup.create.noticesTitle'),
        cssStyle: { width: '570px', maxWidth: '95%' },
        confirmButtonText: t('backup.create.noticesBtn'),
        cancelButtonText: t('app.text.cancel'),
        closeOnClickOverlay: false,
      },
    });

    return res?.event === 'confirm';
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

    if (!await confirmBackupNotices()) {
      return;
    }

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

  /**
   * Sorts the entries of the inner archive and judges whether it can be used.
   *
   * `valid: false` is the only thing that blocks a restore; an incompatible
   * layout - or a missing metadata file - only warns, which is why the format
   * version is checked separately from the app version (see
   * check-backup-version.ts).
   */
  function readArchive(opened: OpenedBackupContainer): ReadArchive {
    const appVersion = appStore.appVersion;
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(opened.plainZipBytes);
    } catch {
      throw new BackupArchiveFailure('corrupted_archive');
    }

    // The archive is a file the user picked: nothing stops an entry name from
    // carrying `../../`, and such an entry is not ours to read.
    const safeEntries = Object.entries(entries).filter(([path]) => isSafeArchivePath(path));
    const split = splitArchiveEntries(safeEntries as [string, Uint8Array][]);

    if (!split.chatsBytes) {
      throw new BackupArchiveFailure('no_chats');
    }

    const recordFiles: BackupRecordFiles = {
      chatsJson: fromUtf8(split.chatsBytes),
      messagesJson: split.messagesBytes ? fromUtf8(split.messagesBytes) : '[]',
      ...(split.tombstonesBytes && { tombstonesJson: fromUtf8(split.tombstonesBytes) }),
    };

    let chatsCount: number | undefined;
    let messagesCount: number | undefined;
    try {
      chatsCount = (JSON.parse(recordFiles.chatsJson) as unknown[]).length;
      messagesCount = (JSON.parse(recordFiles.messagesJson) as unknown[]).length;
    } catch {
      throw new BackupArchiveFailure('unreadable_records');
    }
    if (!chatsCount) {
      throw new BackupArchiveFailure('no_chats');
    }

    const metadata = opened.metadata;
    const compatible = checkBackupFormatCompatibility(BACKUP_FORMAT_VERSION, metadata?.formatVersion);
    const versionCheck = checkBackupVersionCompatibility(appVersion, metadata?.version);

    const validation: BackupValidationResult = {
      valid: true,
      compatible,
      appVersion,
      archiveVersion: metadata?.version,
      formatVersion: metadata?.formatVersion,
      encrypted: opened.encrypted,
      snapshotTs: metadata?.snapshotTs,
      // From the metadata when it is there, and counted off the records when it
      // is not: an archive with no metadata file is still restorable, and a
      // dialog with no numbers in it is worse than one with counted ones.
      chatsCount: metadata?.chatsCount ?? chatsCount,
      messagesCount: metadata?.messagesCount ?? messagesCount,
      attachmentsCount: metadata?.attachmentsCount ?? split.attachments.size,
      createdAt: metadata?.createdAt,
      skippedAttachments: metadata?.skippedAttachments,
      ...(!compatible && {
        warningReason: opened.metadataInvalid
          ? ('invalid_metadata' as const)
          : (versionCheck.reason ?? ('version_mismatch' as const)),
      }),
    };

    if (split.ignored.length > 0) {
      log.info(`Backup archive holds ${split.ignored.length} entry(ies) this build has no place for`);
    }

    return {
      recordFiles,
      attachments: split.attachments,
      folderAttachments: split.folderAttachments,
      validation,
    };
  }

  /** The mode the user picked, or undefined when they backed out. */
  async function askRestoreMode(
    validation: BackupValidationResult,
    preview: { merge: RestorePreview; replace: RestorePreview },
  ): Promise<RestoreMode | undefined> {
    if (!dialog) {
      return undefined;
    }

    const res = await dialog.$openDialog<RestoreMode>(RestoreOptionsDialog, {
      validation,
      preview,
      currentChatsCount: chatsStore.chatList?.length ?? 0,
      dialogProps: {
        title: t('backup.restore.confirmTitle'),
        icon: validation.compatible ? 'outline-file-upload' : 'round-warning',
        confirmButtonText: t('backup.restore.confirmBtn'),
        cancelButtonText: t('app.text.cancel'),
        cssStyle: { width: '570px', maxWidth: '95%' },
        hideCloseButton: true,
        closeOnClickOverlay: false,
      },
    });

    return (res?.event === 'confirm') ? res.data : undefined;
  }

  /**
   * Writes the archived bytes into the local file store, answering
   * blobName -> the NEW id.
   *
   * A new id every time, deliberately: the archived one points into the file
   * store of the device the archive was taken on and can collide with something
   * here.
   */
  async function storeArchivedAttachments(
    archive: ReadArchive,
  ): Promise<Record<string, string>> {
    const stored: Record<string, string> = {};
    const total = archive.attachments.size + archive.folderAttachments.size;
    let processed = 0;

    const report = (name: string): void => {
      onRestoreProgress({
        stage: 'storing-attachments',
        totalItems: total,
        processedItems: processed,
        currentItem: name,
        percent: total > 0 ? Math.floor((processed / total) * 100) : 0,
      });
    };

    for (const [blobName, bytes] of archive.attachments) {
      report(blobName);
      try {
        stored[blobName] = await fileLinkStoreSrv.saveFile(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
      } catch (err) {
        // One file that cannot be written costs that file, not the restore.
        await w3n.log('error', `Could not store the archived file ${blobName}`, err);
      }
      processed += 1;
    }

    for (const [blobName, files] of archive.folderAttachments) {
      report(blobName);
      try {
        stored[blobName] = await fileLinkStoreSrv.saveFolderOfBytes(
          [...files].map(([path, bytes]) => ({ path, bytes })),
        );
      } catch (err) {
        await w3n.log('error', `Could not store the archived folder ${blobName}`, err);
      }
      processed += 1;
    }

    return stored;
  }

  async function executeRestoration(
    archive: ReadArchive,
    mode: RestoreMode,
    opened: OpenedBackupContainer,
  ): Promise<boolean> {
    let stored: Record<string, string> = {};
    const startedAt = Date.now();
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

      stored = await storeArchivedAttachments(archive);

      const outcome = await chatService.restoreBackupArchive({
        recordFiles: archive.recordFiles,
        storedAttachments: stored,
        mode,
        // An encrypted archive keeps its metadata in the container out here, so
        // the stamp is passed along explicitly: without it a `replace` has no
        // barrier at all.
        ...(archive.validation.snapshotTs !== undefined && {
          snapshotTs: archive.validation.snapshotTs,
        }),
      });

      if (outcome?.restored) {
        // Nothing is patched: everything is re-read. The chat list FIRST,
        // because fetchMessages() reads `unread` to size its first page - and
        // refreshChatList() is also what preserves the state of a call in
        // progress and resets a route pointing at a chat that is now gone.
        await chatsStore.refreshChatList();
        await messagesStore.fetchMessages();
        // A selection made before the restore can drive a destructive action
        // against records that are no longer the ones it named.
        messagesStore.clearSelectedMessages();
        await messagesStore.fetchRecentReactions();

        // Ids the aspect rules found no use for: in `merge` the record was
        // already here with bytes of its own. Without this every restore would
        // leave orphans in the store.
        for (const id of outcome.unusedAttachmentIds ?? []) {
          await fileLinkStoreSrv.deleteEntity(id);
        }

        $createNotice({
          type: 'success',
          content: t('backup.restore.success', {
            created: outcome.chatsCreated + outcome.messagesCreated,
            updated: outcome.chatsUpdated + outcome.messagesUpdated,
            deleted: outcome.chatsDeleted + outcome.messagesDeleted,
          }),
          duration: 6000,
        });

        if (outcome.skippedExpired > 0) {
          $createNotice({
            type: 'info',
            content: t('backup.restore.expiredNotice', { count: outcome.skippedExpired }),
            duration: 8000,
          });
        }

        if (outcome.inboxListingFailed) {
          // Said out loud: with no listing the restore could not tell which
          // received messages are still on the server, so files it marked as
          // reachable may not be.
          $createNotice({
            type: 'warning',
            content: t('backup.restore.offlineNotice'),
            duration: 8000,
          });
        }
      }

      // Held so the dialog does not merely flash; the work is already done.
      await keepDialogVisibleUntilFloor(startedAt);
      onRestoreProgress(null);
      return !!outcome?.restored;
    } catch (err) {
      await w3n.log('error', 'Restoring a backup failed', err);
      // A restore that failed must not leave the bytes it wrote behind: the
      // records that would have pointed at them are not there.
      for (const id of Object.values(stored)) {
        await fileLinkStoreSrv.deleteEntity(id).catch(() => {});
      }
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

    let archive: ReadArchive;
    try {
      archive = readArchive(opened);
    } catch (err) {
      if (err instanceof BackupArchiveFailure) {
        reportArchiveError(err.reason);
      } else {
        await w3n.log('error', 'Reading the backup archive failed', err);
        reportArchiveError('corrupted_archive');
      }
      return false;
    }

    // Honest numbers for both modes, before the most destructive action in the
    // whole feature. A dry run over the records, writing nothing.
    let preview: { merge: RestorePreview; replace: RestorePreview };
    try {
      const [merge, replace] = await Promise.all([
        chatService.previewRestore(archive.recordFiles, 'merge'),
        chatService.previewRestore(archive.recordFiles, 'replace'),
      ]);
      preview = { merge, replace };
    } catch (err) {
      await w3n.log('error', 'Could not preview what a restore would do', err);
      reportArchiveError('unreadable_records');
      return false;
    }

    const mode = await askRestoreMode(archive.validation, preview);
    if (!mode) {
      return false;
    }

    return executeRestoration(archive, mode, opened);
  }

  return {
    pickBackupArchiveFile,
    openPickedArchive,
    readArchive,
    askBackupPassphrase,
    askRestoreMode,
    executeRestoration,
    startBackupWorkflow,
    runRestoreWorkflow,
  };
}
