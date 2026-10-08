<script lang="ts" setup>
  import { computed, inject, defineAsyncComponent } from 'vue';
  import { Ui3nButton, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { DIALOGS_KEY, type DialogsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { DIALOG_REQUEST_KEY } from '@picker/common/dialog-capabilities';
  import type { PickerTableRow } from '@picker/common/types';
  import { useI18n } from 'vue-i18n';

  const props = defineProps<{ selectedRows: PickerTableRow[] }>();

  const { t } = useI18n();

  const emit = defineEmits<{ cancel: [] }>();

  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const picker = usePickerState();
  const dialogRequest = inject(DIALOG_REQUEST_KEY);
  const isSaveMode = computed(() => dialogRequest?.mode === 'saveFile');

  const displayTitle = computed(() => {
    if (isSaveMode.value) {
      const name = picker.saveFileName.value;
      return name ? `${t('file_picker.footer.save_as')} ${name}` : t('file_picker.header.save_file');
    }

    const count = props.selectedRows.length;
    if (count === 0) return dialogRequest?.title || t('file_picker.header.select_file');
    if (count === 1)
      return props.selectedRows[0].name || dialogRequest?.title || t('file_picker.header.select_file');
    return `${count} ${t('file_picker.selected_items')}`;
  });

  async function openRenameDialog() {
    const component = defineAsyncComponent(() => import('@picker/mobile/dialogs/picker-mobile-rename-dialog.vue'));

    const result = await dialogs.$openDialog(component, {
      data: picker.saveFileName.value,
      dialogProps: {
        title: t('dialog.file_exist.button.rename'),
        cssStyle: { maxHeight: '95%' },
        closeOnClickOverlay: false,
        confirmButton: false,
        cancelButton: false,
      },
    });

    if (result?.event === 'confirm' && result.data) {
      picker.saveFileName.value = result.data as string;
    }
  }
</script>

<template>
  <header :class="$style.header">
    <ui3n-button
      type="icon"
      icon="round-close"
      icon-color="var(--color-text-control-primary-default)"
      @click="emit('cancel')"
    />

    <h3 :class="$style.title">
      {{ displayTitle }}
    </h3>

    <ui3n-icon
      v-if="isSaveMode"
      icon="round-edit"
      :size="18"
      color="var(--color-icon-control-secondary-default)"
      :class="$style.pencil"
      @click="openRenameDialog"
    />

    <div
      v-else
      :class="$style.spacer"
    />
  </header>
</template>

<style lang="scss" module>
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }
  .title {
    flex: 1;
    margin: 0;
    text-align: center;
    font-size: var(--font-14);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    width: 32px;
    flex-shrink: 0;
  }
  .pencil {
    cursor: pointer;
    flex-shrink: 0;
  }
</style>
