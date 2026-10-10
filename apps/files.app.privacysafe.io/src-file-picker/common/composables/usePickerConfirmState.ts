import { computed, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DialogRequestState, PickerTableRow } from '@picker/common/types';
import type { PickerStateApi } from '@picker/common/composables/usePickerState';

export function usePickerConfirmState(
  dialogRequest: DialogRequestState | undefined,
  picker: PickerStateApi,
  selectedRows: ComputedRef<PickerTableRow[]>,
) {
  const { t } = useI18n();
  const isSelectedFolder = computed(() => selectedRows.value.length === 1 && selectedRows.value[0].isFolder);
  const navigatesToFolder = computed(() => dialogRequest?.mode !== 'openFolder' && isSelectedFolder.value);

  const hasSelection = computed(() => {
    if (!dialogRequest?.resolve || picker.isBusy.value || picker.currentWindow.value.status !== 'ready') {
      return false;
    }
    if (navigatesToFolder.value) {
      return true;
    }
    if (dialogRequest.mode === 'openFolder') {
      return picker.canWrite.value;
    }
    if (picker.isSaveMode.value) {
      if (!picker.canWrite.value) {
        return false;
      }
      const name = picker.saveName.value.trim();
      return (dialogRequest.mode === 'saveFolder' && !name) || picker.isSaveNameValid(name);
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
        t(selectedRows.value.length ? 'file_picker.button.select' : 'file_picker.button.select_this_folder')
      );
    }
    if (dialogRequest?.mode === 'saveFolder') {
      return (
        dialogRequest.btnLabel ||
        t(picker.saveName.value.trim() ? 'file_picker.button.save' : 'file_picker.button.use_folder')
      );
    }
    if (picker.isSaveMode.value) {
      return t('file_picker.button.save');
    }
    return dialogRequest?.btnLabel || t('file_picker.button.select');
  });

  return { hasSelection, confirmLabel };
}
