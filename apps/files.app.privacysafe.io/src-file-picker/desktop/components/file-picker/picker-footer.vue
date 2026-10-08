<script lang="ts" setup>
  import { computed, inject } from 'vue';
  import { Ui3nButton, Ui3nEditable, type Nullable } from '@v1nt1248/3nclient-lib';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { DIALOG_REQUEST_KEY } from '@picker/common/dialog-capabilities';
  import type { PickerTableRow } from '@picker/common/types';
  import { useI18n } from 'vue-i18n';

  const props = defineProps<{
    selectedRows: PickerTableRow[];
  }>();

  const emit = defineEmits<{
    confirm: [];
    cancel: [];
  }>();
  const { t } = useI18n();
  const picker = usePickerState();
  const dialogRequest = inject(DIALOG_REQUEST_KEY);
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const isSaveMode = computed(() => dialogRequest?.mode === 'saveFile');
  const selectedEntry = computed(() => (props.selectedRows.length === 1 ? props.selectedRows[0] : undefined));
  const isSelectedFolder = computed(() => selectedEntry.value?.isFolder === true);
  const isSaveNameValid = computed(() => picker.isSaveFileNameValid(picker.saveFileName.value));

  const hasSelection = computed(
    () =>
      isSelectedFolder.value ||
      (isSaveMode.value ? isSaveNameValid.value : props.selectedRows.some(row => !row.isFolder)),
  );

  const confirmLabel = computed(() => {
    if (isSelectedFolder.value) {
      return t('file_picker.button.proceed');
    }
    if (isSaveMode.value) {
      return t('file_picker.button.save');
    }
    return dialogRequest?.btnLabel || t('file_picker.button.select');
  });

  function updateSaveFileName(newName: Nullable<string>) {
    const trimmed = (newName ?? '').trim();
    picker.saveFileName.value = trimmed;

    if (trimmed && !picker.isSaveFileNameValid(trimmed)) {
      notifications.$createNotice({
        type: 'error',
        withIcon: false,
        content: t('file_picker.notification.error.invalid_filename'),
        duration: 4000,
      });
    }
  }
</script>

<template>
  <div :class="$style.footerPanel">
    <div
      v-if="!isSaveMode"
      :class="$style.selectedBox"
    >
      <span>{{ selectedRows.length }} {{ t('file_picker.selected_items') }}</span>
    </div>

    <div
      v-else
      :class="$style.selectedBox"
    >
      <span :class="$style.saveAsLabel">{{ t('file_picker.footer.save_as') }}</span>
      <ui3n-editable
        :model-value="picker.saveFileName.value"
        disallow-empty-value
        :class="$style.nameEditable"
        @update:model-value="updateSaveFileName"
      />
    </div>

    <div :class="$style.actionBox">
      <ui3n-button
        type="custom"
        color="var(--color-bg-button-tritery-default)"
        :class="$style.footerBtn"
        @click="emit('cancel')"
      >
        {{ t('file_picker.button.cancel') }}
      </ui3n-button>
      <ui3n-button
        :disabled="!hasSelection"
        :class="$style.footerBtn"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </ui3n-button>
    </div>
  </div>
</template>

<style lang="scss" module>
  .footerPanel {
    display: flex;
    padding: 0 16px;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    align-content: center;
    height: 64px;
  }
  .selectedBox {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;

    span {
      font-size: var(--font-12);
      color: var(--color-text-control-primary-default);
    }
  }
  .saveAsLabel {
    flex-shrink: 0;
  }
  .nameEditable {
    min-width: 0;
  }
  .actionBox {
    display: flex;
    gap: 12px;
    flex-shrink: 0;
  }
  .footerBtn {
    min-width: 79px;
  }
</style>
