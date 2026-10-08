<script lang="ts" setup>
  import { computed, inject, ref, type ShallowUnwrapRef } from 'vue';
  import { providePickerState } from '@picker/common/composables/usePickerState';
  import type { Nullable, Ui3nTableExpose } from '@v1nt1248/3nclient-lib';
  import { useI18n } from 'vue-i18n';
  import { usePickerDialogActions } from '@picker/common/composables/usePickerDialogActions';
  import { DIALOG_REQUEST_KEY } from '@picker/common/dialog-capabilities';
  import type { PickerTableRow } from '@picker/common/types';
  import pickerSidebar from '@picker/desktop/components/file-picker/picker-sidebar.vue';
  import pickerBreadcrumb from '@picker/common/components/picker-breadcrumb.vue';
  import pickerFooter from '@picker/desktop/components/file-picker/picker-footer.vue';
  import PickerFileList from '@picker/desktop/components/file-picker/picker-file-list.vue';

  const { t } = useI18n();
  const dialogRequest = inject(DIALOG_REQUEST_KEY);

  if (!dialogRequest) {
    throw new Error('DialogRequestState not provided...is main.ts wiring app.provide(DIALOG_REQUEST_KEY, ...)?');
  }

  type PickerTableComponent = ShallowUnwrapRef<Ui3nTableExpose<PickerTableRow>>;
  const picker = providePickerState(dialogRequest);
  const tableComponent = ref<Nullable<PickerTableComponent>>(null);
  const selectedRows = computed(() => tableComponent.value?.selectedRowsArray || ([] as PickerTableRow[]));

  const { handleConfirm, handleRowConfirm, handleCancel } = usePickerDialogActions(
    dialogRequest,
    picker,
    selectedRows,
  );
</script>

<template>
  <div :class="$style.filePickerDialog">
    <header :class="$style.customTitle">
      <h3>
        {{
          dialogRequest.title ||
            (dialogRequest.mode === 'saveFile'
              ? t('file_picker.header.save_file')
              : t('file_picker.header.select_file'))
        }}
      </h3>
    </header>

    <div :class="$style.mainContent">
      <aside :class="$style.sidebar">
        <picker-sidebar />
      </aside>

      <section :class="$style.workspace">
        <picker-breadcrumb />

        <div :class="$style.content">
          <picker-file-list
            @init="tableComponent = $event"
            @confirm="handleRowConfirm"
          />
        </div>
      </section>
    </div>

    <div :class="$style.actionPanel">
      <picker-footer
        :selected-rows="selectedRows"
        @confirm="handleConfirm"
        @cancel="handleCancel"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .filePickerDialog {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }

  .customTitle {
    padding: 16px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border-block-primary-default);

    h3 {
      margin: 0;
      font-size: var(--font-14);
      color: var(--color-text-control-primary-default);
    }
  }

  .mainContent {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .sidebar {
    width: 213px;
    flex-shrink: 0;
    border-right: 1px solid var(--color-border-block-primary-default);
    overflow: hidden;
  }

  .workspace {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .actionPanel {
    flex-shrink: 0;
    border-top: 1px solid var(--color-border-block-primary-default);
  }
</style>
