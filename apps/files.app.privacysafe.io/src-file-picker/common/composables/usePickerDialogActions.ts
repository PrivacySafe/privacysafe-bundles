import { defineAsyncComponent, inject, ref, type ComputedRef } from 'vue';
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

export function usePickerDialogActions(
  dialogRequest: DialogRequestState,
  picker: PickerStateApi,
  selectedRows: ComputedRef<PickerTableRow[]>,
) {
  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const { t } = useI18n();
  const pendingSaveName = ref('');
  let saveInProgress = false;

  async function resolveRows(rows: PickerTableRow[]) {
    const fileRows = rows.filter(row => !row.isFolder);
    if (!fileRows.length) {
      return;
    }

    try {
      const files = await picker.resolveSelectedFiles(fileRows.map(row => row.id));
      settleDialog(dialogRequest, files);
    } catch (err) {
      console.error('🔥 ERROR RESOLVING SELECTED FILES. ', err);
      notifications.$createNotice({
        type: 'error',
        withIcon: true,
        content: t('file_picker.notification.error.open_file'),
        duration: 4000,
      });
    }
  }

  async function handleConfirm() {
    if (!dialogRequest.resolve) {
      return;
    }

    if (dialogRequest.mode === 'saveFile') {
      await handleSaveConfirm();
      return;
    }

    const rows = selectedRows.value;
    if (rows.length === 1 && rows[0].isFolder) {
      await picker.navigateToFolder(rows[0].id);
      return;
    }

    // In multi-select open mode checked folders are navigation affordances,
    // not file results. Resolve only the selected files.
    await resolveRows(rows);
  }

  async function handleRowConfirm(row: PickerTableRow) {
    if (!dialogRequest.resolve || dialogRequest.mode !== 'openFile' || row.isFolder) {
      return;
    }

    await resolveRows([row]);
  }

  async function handleSaveConfirm(extensionFallbackName?: string) {
    const rows = selectedRows.value;
    if (rows.length === 1 && rows[0].isFolder) {
      await picker.navigateToFolder(rows[0].id);
      return;
    }

    let name = picker.saveFileName.value.trim();
    if (!name) {
      return;
    }

    name = appendDefaultFileExtension(
      name,
      dialogRequest.filters,
      extensionFallbackName ?? dialogRequest.defaultPath,
    );

    if (!picker.isSaveFileNameValid(name)) {
      notifications.$createNotice({
        type: 'error',
        withIcon: false,
        content: t('file_picker.notification.error.invalid_filename'),
        duration: 4000,
      });
      return;
    }

    picker.saveFileName.value = name;

    const collision = picker.findFileNameCollision(name);
    if (collision?.isFolder) {
      notifications.$createNotice({
        type: 'error',
        withIcon: true,
        content: t('file_picker.notification.error.folder_name_collision'),
        duration: 4000,
      });
      return;
    }

    if (collision) {
      pendingSaveName.value = name;
      await openFileCollisionDialog();
      return;
    }

    await writeAndClose();
  }

  async function writeAndClose() {
    if (saveInProgress) {
      return;
    }

    saveInProgress = true;

    try {
      const file = await picker.resolveSaveFile();
      settleDialog(dialogRequest, file);
    } catch (err) {
      console.error('🔥 ERROR RESOLVING SAVE FILE. ', err);
      notifications.$createNotice({
        type: 'error',
        withIcon: true,
        content: t('file_picker.notification.error.save_file'),
        duration: 4000,
      });

      // Keep the picker open after a failed save-resolution attempt so the
      // user can retry another name/location or cancel explicitly.
      saveInProgress = false;
    }
  }

  function handleCancel() {
    settleDialog(dialogRequest, undefined);
  }

  async function openFileCollisionDialog() {
    const component = defineAsyncComponent(() => import('@picker/common/dialogs/file-collision-dialog.vue'));

    const result = await dialogs.$openDialog(component, {
      data: pendingSaveName.value,
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

    if (result.data) {
      const collisionName = pendingSaveName.value;
      picker.saveFileName.value = result.data as string;
      await handleSaveConfirm(collisionName);
      return;
    }

    await writeAndClose();
  }

  return {
    handleConfirm,
    handleRowConfirm,
    handleCancel,
  };
}
