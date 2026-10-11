<script lang="ts" setup>
  import { computed, inject, ref, type ShallowUnwrapRef } from 'vue';
  import type { Nullable, Ui3nTableExpose } from '@v1nt1248/3nclient-lib';

  import { providePickerState } from '@picker/common/composables/usePickerState';
  import { usePickerHistory } from '@picker/common/composables/usePickerHistory';

  import type { PickerTableRow } from '@picker/common/types';
  import { usePickerDialogActions } from '@picker/common/composables/usePickerDialogActions';
  import { DIALOG_REQUEST_KEY } from '@picker/common/dialog-capabilities';
  import pickerBreadcrumb from '@picker/common/components/picker-breadcrumb.vue';
  import pickerMobileHeader from './picker-mobile-header.vue';
  import pickerMobileTabs from './picker-mobile-tabs.vue';
  import pickerMobileFileList from './picker-mobile-file-list.vue';
  import pickerMobileFooter from './picker-mobile-footer.vue';

  const dialogRequest = inject(DIALOG_REQUEST_KEY);

  if (!dialogRequest) {
    throw new Error(
      'DialogRequestState not provided...is picker-mobile-main.ts wiring app.provide(DIALOG_REQUEST_KEY, ...)?',
    );
  }

  const picker = providePickerState(dialogRequest);

  type PickerTableComponent = ShallowUnwrapRef<Ui3nTableExpose<PickerTableRow>>;

  const tableComponent = ref<Nullable<PickerTableComponent>>(null);
  const selectedRows = computed(() => tableComponent.value?.selectedRowsArray || ([] as PickerTableRow[]));

  const { handleConfirm, handleRowConfirm, handleCancel, handleNewFolder } = usePickerDialogActions(
    dialogRequest,
    picker,
    selectedRows,
  );
  usePickerHistory(picker, handleCancel);
</script>

<template>
  <div
    :class="$style.filePickerMobileDialog"
    :inert="picker.isBusy.value"
  >
    <picker-mobile-header
      :selected-rows="selectedRows"
      @cancel="handleCancel"
    />
    <picker-mobile-tabs />
    <picker-breadcrumb @new-folder="handleNewFolder" />

    <div :class="$style.content">
      <picker-mobile-file-list
        @init="tableComponent = $event"
        @confirm="handleRowConfirm"
      />
    </div>

    <picker-mobile-footer
      :selected-rows="selectedRows"
      @confirm="handleConfirm"
    />
  </div>
</template>

<style lang="scss" module>
  .filePickerMobileDialog {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
