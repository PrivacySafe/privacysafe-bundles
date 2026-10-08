<script lang="ts" setup>
  import { computed, inject } from 'vue';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { DIALOG_REQUEST_KEY } from '@picker/common/dialog-capabilities';
  import type { PickerTableRow } from '@picker/common/types';
  import { useI18n } from 'vue-i18n';

  const { t } = useI18n();

  const props = defineProps<{ selectedRows: PickerTableRow[] }>();

  const emit = defineEmits<{ confirm: [] }>();

  const picker = usePickerState();
  const dialogRequest = inject(DIALOG_REQUEST_KEY);
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
    if (isSelectedFolder.value) return t('file_picker.button.proceed');
    if (isSaveMode.value) return t('file_picker.button.save');
    return dialogRequest?.btnLabel || t('file_picker.button.select');
  });
</script>

<template>
  <div :class="$style.footerPanel">
    <ui3n-button
      :class="$style.confirmBtn"
      :disabled="!hasSelection"
      @click="emit('confirm')"
    >
      {{ confirmLabel }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .footerPanel {
    padding: 12px 16px;
    border-top: 1px solid var(--color-border-block-primary-default);
  }
  .confirmBtn {
    width: 100%;
    border-radius: 24px !important;
    height: 48px;
  }
</style>
