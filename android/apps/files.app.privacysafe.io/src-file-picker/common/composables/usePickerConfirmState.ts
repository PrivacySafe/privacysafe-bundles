import { computed, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DialogRequestState, PickerTableRow } from '@picker/common/types';
import type { PickerStateApi } from '@picker/common/composables/usePickerState';
import { isFsRootPath } from '@picker/common/utils/folder-operations';

export function usePickerConfirmState(
  dialogRequest: DialogRequestState | undefined,
  picker: PickerStateApi,
  selectedRows: ComputedRef<PickerTableRow[]>,
) {
  const { t } = useI18n();
  const isSelectedFolder = computed(() => selectedRows.value.length === 1 && selectedRows.value[0].isFolder);
  const navigatesToFolder = computed(() => dialogRequest?.mode !== 'openFolder' && isSelectedFolder.value);
  // the current folder is given away only when it is not the root of a storage
  const canUseCurrentFolder = computed(() => !isFsRootPath(picker.currentWindow.value.currentPath));
  const hasSelectedFolders = computed(() => selectedRows.value.some(row => row.isFolder));

  const hasSelection = computed(() => {
    if (!dialogRequest?.resolve || picker.isBusy.value || picker.currentWindow.value.status !== 'ready') {
      return false;
    }
    if (navigatesToFolder.value) {
      return true;
    }
    if (dialogRequest.mode === 'openFolder') {
      return picker.canWrite.value && (hasSelectedFolders.value || canUseCurrentFolder.value);
    }
    if (picker.isSaveMode.value) {
      if (!picker.canWrite.value) {
        return false;
      }
      const name = picker.saveName.value.trim();
      if (dialogRequest.mode === 'saveFolder' && !name) {
        return canUseCurrentFolder.value;
      }
      return picker.isSaveNameValid(name);
    }
    return selectedRows.value.some(row => !row.isFolder);
  });

  const confirmLabel = computed(() => {
    if (navigatesToFolder.value) {
      return t('file_picker.button.proceed');
    }
    if (dialogRequest?.mode === 'openFolder') {
      return (
        dialogRequest.btnLabel ||
        t(
          hasSelectedFolders.value || !canUseCurrentFolder.value
            ? 'file_picker.button.select'
            : 'file_picker.button.select_this_folder',
        )
      );
    }
    if (dialogRequest?.mode === 'saveFolder') {
      return (
        dialogRequest.btnLabel ||
        t(picker.saveName.value.trim() ? 'file_picker.button.save' : 'file_picker.button.use_folder')
      );
    }
    if (picker.isSaveMode.value) {
      return dialogRequest?.btnLabel || t('file_picker.button.save');
    }
    return dialogRequest?.btnLabel || t('file_picker.button.select');
  });

  return { hasSelection, confirmLabel };
}
