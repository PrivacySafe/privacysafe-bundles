<script lang="ts" setup>
  import { computed, inject } from 'vue';
  import { Ui3nButton, Ui3nEditable, Ui3nInput, type Nullable } from '@v1nt1248/3nclient-lib';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { usePickerConfirmState } from '@picker/common/composables/usePickerConfirmState';
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
  const isSaveMode = picker.isSaveMode;

  const { hasSelection, confirmLabel } = usePickerConfirmState(
    dialogRequest,
    picker,
    computed(() => props.selectedRows),
  );

  function updateSaveName(newName: Nullable<string>) {
    const trimmed = (newName ?? '').trim();
    picker.saveName.value = trimmed;
    if (trimmed && !picker.isSaveNameValid(trimmed)) {
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
      :class="[$style.selectedBox, dialogRequest?.mode === 'saveFolder' && $style.folderBox]"
    >
      <span :class="$style.saveAsLabel">{{
        t(dialogRequest?.mode === 'saveFolder' ? 'file_picker.folder_name' : 'file_picker.footer.save_as')
      }}</span>
      <ui3n-input
        v-if="dialogRequest?.mode === 'saveFolder'"
        v-model="picker.saveName.value"
        :placeholder="t('file_picker.folder_name')"
        clearable
        :class="$style.nameEditable"
      />
      <ui3n-editable
        v-else
        :model-value="picker.saveName.value"
        disallow-empty-value
        :class="$style.nameEditable"
        @update:model-value="updateSaveName"
      />
      <span
        v-if="dialogRequest?.mode === 'saveFolder' && !picker.saveName.value.trim()"
        :class="$style.folderHint"
      >
        {{ t('file_picker.folder_name_empty_hint') }}
      </span>
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
  .folderBox {
    flex: 1;
    display: grid !important;
    grid-template-columns: auto minmax(0, 1fr);
    margin-right: 12px;
  }
  .folderHint {
    grid-column: 1 / -1;
    font-size: var(--font-12);
    color: var(--color-text-control-secondary-default);
  }
  .footerPanel {
    display: flex;
    padding: 0 16px;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    align-content: center;
    min-height: 64px;
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
