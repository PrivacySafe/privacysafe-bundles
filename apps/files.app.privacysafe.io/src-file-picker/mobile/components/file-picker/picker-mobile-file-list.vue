<script setup lang="ts">
  import { computed, inject, ref, watch, type ShallowUnwrapRef } from 'vue';
  import { Ui3nTable, type Nullable, type Ui3nTableExpose } from '@v1nt1248/3nclient-lib';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { usePickerTable } from '@picker/common/composables/usePickerTable';
  import { DIALOG_REQUEST_KEY } from '@picker/common/dialog-capabilities';
  import { filterPickerFilesByType } from '@picker/common/utils/filter-file-types';
  import PickerMobileRow from './picker-mobile-row.vue';
  import type { PickerTableRow as RowType } from '@picker/common/types';
  import { useI18n } from 'vue-i18n';

  const { t } = useI18n();

  const picker = usePickerState();
  const dialogRequest = inject(DIALOG_REQUEST_KEY);
  const { prepareTableData } = usePickerTable();

  type PickerTableComponent = ShallowUnwrapRef<Ui3nTableExpose<RowType>>;

  const emit = defineEmits<{
    init: [table: Nullable<PickerTableComponent>];
    confirm: [row: RowType];
  }>();

  const tableComponent = ref<Nullable<PickerTableComponent>>(null);

  const visibleEntries = computed(() =>
    filterPickerFilesByType(picker.currentWindow.value.entries, dialogRequest?.filters),
  );

  const tableData = computed(() =>
    prepareTableData(
      visibleEntries.value,
      dialogRequest?.multiSelections ?? false,
      picker.currentWindow.value.sortBy,
      picker.currentWindow.value.sortOrder,
    ),
  );

  // Selection belongs to Ui3nTable. In save mode, selection additionally
  // updates the filename field; no picker-owned selection copy is maintained.
  function handleSelectRow(rows: RowType[]) {
    if (dialogRequest?.mode !== 'saveFile') {
      return;
    }

    const fileRow = rows.find(row => !row.isFolder);
    if (fileRow) {
      picker.saveFileName.value = fileRow.name;
    }
  }

  function clearTableSelection() {
    tableComponent.value?.clear();
  }

  function handleNavigate(id: string) {
    void picker.navigateToFolder(id);
  }

  function handleConfirm(row: RowType) {
    emit('confirm', row);
  }

  watch(
    tableComponent,
    table => {
      // Mobile unmounts Ui3nTable while loading. Emit null as well so the
      // dialog cannot retain a stale table instance/selection during reload.
      emit('init', table);
    },
    { immediate: true },
  );

  watch(
    () => [picker.activeRootId.value, picker.currentWindow.value.status, picker.currentWindow.value.currentPath],
    clearTableSelection,
  );
</script>

<template>
  <div :class="$style.listPanel">
    <div
      v-if="picker.currentWindow.value.status === 'loading'"
      :class="$style.statusMessage"
    >
      {{ t('file_picker.message_status.loading') }}
    </div>
    <div
      v-else-if="picker.currentWindow.value.status === 'error'"
      :class="$style.statusMessage"
    >
      {{ t('file_picker.message_status.load_error') }}
    </div>
    <div
      v-else
      :class="$style.tableWrapper"
    >
      <ui3n-table
        ref="tableComponent"
        :config="tableData.config"
        :head="[]"
        :body="tableData.body"
        :class="$style.tableClass"
        @select:row="handleSelectRow"
      >
        <template #row="{ row, isRowSelected, events }">
          <picker-mobile-row
            :row="row"
            :is-row-selected="isRowSelected"
            :events="events"
            :resolve-file-on-tap="dialogRequest?.mode === 'openFile'"
            @navigate="handleNavigate"
            @confirm="handleConfirm"
          />
        </template>
      </ui3n-table>
    </div>
  </div>
</template>

<style module lang="scss">
  .listPanel {
    height: 100%;
    color: var(--color-text-control-primary-default);
  }
  .statusMessage {
    color: var(--color-text-control-secondary-default, #888);
    padding: 12px 16px;
  }
  .tableWrapper {
    height: 100%;
    min-height: 0;
  }
  .tableClass {
    --ui3n-table-base-head-height: 0px;
    & > div:first-child {
      border-bottom: 1px solid var(--color-border-block-primary-default);
    }
  }
</style>
