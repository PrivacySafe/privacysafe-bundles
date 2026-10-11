import { defineAsyncComponent, inject, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DIALOGS_KEY,
  NOTIFICATIONS_KEY,
  type DialogsPlugin,
  type NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { settleDialog } from '@picker/common/dialog-capabilities';
import type { DialogRequestState, PickerTableRow } from '@picker/common/types';
import type { PickerStateApi } from '@picker/common/composables/usePickerState';
import { appendDefaultFileExtension } from '@picker/common/utils/filter-file-types';
import {
  createFolderTarget,
  getFolderTargetStats,
  hasFileExceptionFlag,
  openFolderTarget,
  type PickerFolderTarget,
} from '@picker/common/utils/folder-operations';

export function usePickerDialogActions(
  dialogRequest: DialogRequestState,
  picker: PickerStateApi,
  selectedRows: ComputedRef<PickerTableRow[]>,
) {
  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const { t } = useI18n();

  function showError(key: string) {
    notifications.$createNotice({
      type: 'error',
      withIcon: true,
      content: t(key),
      duration: 4000,
    });
  }

  function canStartAction(): boolean {
    return !!dialogRequest.resolve && !picker.isBusy.value && picker.currentWindow.value.status === 'ready';
  }

  async function runAction(action: () => Promise<void>, errorKey: string) {
    picker.isBusy.value = true;
    try {
      await action();
    } catch (error) {
      console.error('Error completing picker action.', error);
      showError(errorKey);
    } finally {
      picker.isBusy.value = false;
    }
  }

  async function resolveRows(rows: PickerTableRow[]) {
    const fileRows = rows.filter(row => !row.isFolder);
    if (!fileRows.length) {
      return;
    }

    const files = await picker.resolveSelectedFiles(fileRows.map(row => row.id));
    settleDialog(dialogRequest, files);
  }

  async function handleConfirm() {
    if (!canStartAction()) {
      return;
    }

    const rows = selectedRows.value;
    if (dialogRequest.mode === 'openFolder') {
      const paths = rows.filter(row => row.isFolder).map(row => row.id);
      if (!paths.length) {
        paths.push(picker.currentWindow.value.currentPath);
      }
      await runAction(async () => {
        const folders = await picker.resolveSelectedFolders(paths);
        settleDialog(dialogRequest, folders);
      }, 'file_picker.notification.error.open_folder');
      return;
    }

    // In file modes and save-folder mode a checked folder is a navigation
    // affordance. Only open-folder mode returns checked folders directly.
    if (rows.length === 1 && rows[0].isFolder) {
      await picker.navigateToFolder(rows[0].id);
      return;
    }
    if (dialogRequest.mode === 'saveFolder') {
      await runAction(handleSaveFolderConfirm, 'file_picker.notification.error.save_folder');
      return;
    }
    if (dialogRequest.mode === 'saveFile') {
      await runAction(handleSaveFileConfirm, 'file_picker.notification.error.save_file');
      return;
    }
    await runAction(() => resolveRows(rows), 'file_picker.notification.error.open_file');
  }

  async function handleRowConfirm(row: PickerTableRow) {
    if (!canStartAction() || dialogRequest.mode !== 'openFile' || row.isFolder) {
      return;
    }
    await runAction(() => resolveRows([row]), 'file_picker.notification.error.open_file');
  }

  async function handleSaveFileConfirm(extensionFallbackName?: string) {
    let name = picker.saveName.value.trim();
    if (!name) {
      return;
    }

    name = appendDefaultFileExtension(
      name,
      dialogRequest.filters,
      extensionFallbackName ?? dialogRequest.defaultPath,
    );

    if (!picker.isSaveNameValid(name)) {
      showError('file_picker.notification.error.invalid_filename');
      return;
    }
    picker.saveName.value = name;

    const collision = picker.findNameCollision(name);
    if (collision?.isFolder) {
      showError('file_picker.notification.error.folder_name_collision');
      return;
    }
    if (collision) {
      const component = defineAsyncComponent(() => import('@picker/common/dialogs/file-collision-dialog.vue'));
      const result = await dialogs.$openDialog(component, {
        data: name,
        dialogProps: {
          title: t('dialog.file_exist.title'),
          cssStyle: { maxHeight: '95%' },
          closeOnClickOverlay: false,
          confirmButton: false,
          cancelButton: false,
        },
      });
      if (result?.event !== 'confirm') {
        return;
      }
      if (typeof result.data === 'string' && result.data) {
        picker.saveName.value = result.data;
        await handleSaveFileConfirm(name);
        return;
      }
    }
    const file = await picker.resolveSaveFile();
    settleDialog(dialogRequest, file);
  }

  async function confirmExistingFolder(target: PickerFolderTarget) {
    const component = defineAsyncComponent(() => import('@picker/common/dialogs/folder-collision-dialog.vue'));

    const result = await dialogs.$openDialog(component, {
      data: target.name,
      dialogProps: {
        title: t('file_picker.folder_exists.title'),
        cssStyle: { maxHeight: '95%' },
        closeOnClickOverlay: false,
        confirmButton: false,
        cancelButton: false,
      },
    });

    if (result?.event !== 'confirm') {
      return;
    }

    // Recheck after confirmation; an external operation may have removed or
    // replaced the folder while the question was displayed.
    const stats = await getFolderTargetStats(target);
    if (!stats?.isFolder || stats.isLink) {
      showError('file_picker.notification.error.folder_unavailable');
      return;
    }
    const folder = await openFolderTarget(target);
    settleDialog(dialogRequest, folder);
  }

  async function handleSaveFolderConfirm() {
    const name = picker.saveName.value.trim();
    if (name && !picker.isSaveNameValid(name)) {
      showError('file_picker.notification.error.invalid_filename');
      return;
    }
    picker.saveName.value = name;
    const target = await picker.getFolderTarget(name);
    const stats = await getFolderTargetStats(target);
    if (stats) {
      if (!stats.isFolder || stats.isLink) {
        showError('file_picker.notification.error.folder_target_conflict');
        return;
      }
      await confirmExistingFolder(target);
      return;
    }
    if (!name) {
      showError('file_picker.notification.error.folder_unavailable');
      return;
    }

    try {
      const folder = await createFolderTarget(target);
      settleDialog(dialogRequest, folder);
    } catch (error) {
      if (!hasFileExceptionFlag(error, 'alreadyExists')) {
        throw error;
      }
      const existing = await getFolderTargetStats(target);
      if (existing?.isFolder && !existing.isLink) {
        await confirmExistingFolder(target);
      } else {
        showError('file_picker.notification.error.folder_target_conflict');
      }
    }
  }

  async function handleNewFolder() {
    if (!canStartAction() || !picker.canWrite.value) {
      return;
    }
    await runAction(async () => {
      const component = defineAsyncComponent(() => import('@picker/common/dialogs/folder-name-dialog.vue'));
      await dialogs.$openDialog(component, {
        data: { name: '', create: picker.createFolder },
        dialogProps: {
          title: t('file_picker.button.new_folder'),
          cssStyle: { maxHeight: '95%' },
          closeOnClickOverlay: false,
          confirmButton: false,
          cancelButton: false,
        },
      });
    }, 'file_picker.notification.error.create_folder');
  }

  function handleCancel() {
    if (picker.isBusy.value || !dialogRequest.resolve) {
      return;
    }
    settleDialog(dialogRequest, undefined);
  }

  return {
    handleConfirm,
    handleRowConfirm,
    handleCancel,
    handleNewFolder,
  };
}
