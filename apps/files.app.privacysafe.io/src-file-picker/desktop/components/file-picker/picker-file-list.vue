<script setup lang="ts">
  import { computed, inject, provide, ref, watch, type ShallowUnwrapRef } from 'vue';
  import {
    Ui3nTable,
    Ui3nProgressCircular,
    type Nullable,
    type Ui3nTableExpose,
    type Ui3nTableSort,
  } from '@v1nt1248/3nclient-lib';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { usePickerTable } from '@picker/common/composables/usePickerTable';
  import { DIALOG_REQUEST_KEY } from '@picker/common/dialog-capabilities';
  import { filterPickerFilesByType } from '@picker/common/utils/filter-file-types';
  import PickerTableRow from './picker-table-row.vue';
  import type { PickerTableRow as RowType } from '@picker/common/types';
  import type { FsEntityInfoProps, FsEntityInfoProvideProps } from '@shared/types';
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
  const displayedFsEntityInfo = ref<FsEntityInfoProps | null>(null);

  const commonLoading = computed(() => picker.currentWindow.value.status === 'loading');

  const resolveFileOnRowClick = computed(
    () => dialogRequest?.mode === 'openFile' && dialogRequest.multiSelections === false,
  );

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

  // Selection belongs to Ui3nTable. Any checkbox selection change closes
  // the displayed row, while save mode also keeps the filename in sync.
  function handleSelectRow(rows: RowType[]) {
    openFsEntityInfoBlock(null);
    if (dialogRequest?.mode !== 'saveFile') {
      return;
    }

    const fileRow = rows.find(row => !row.isFolder);
    if (fileRow) {
      picker.saveFileName.value = fileRow.name;
    }
  }

  function openFsEntityInfoBlock(data: FsEntityInfoProps | null) {
    displayedFsEntityInfo.value = data;
  }

  provide<FsEntityInfoProvideProps>('fsEntityInfo', {
    displayedFsEntityInfo,
    openFsEntityInfoBlock,
  });

  function handleOpenInfo(row: RowType) {
    const entityInfo: FsEntityInfoProps = {
      fsId: picker.activeFsId.value,
      path: row.id,
    };
    const displayed = displayedFsEntityInfo.value;
    const isSameEntity = displayed?.fsId === entityInfo.fsId && displayed.path === entityInfo.path;
    openFsEntityInfoBlock(isSameEntity ? null : entityInfo);
  }

  function clearTableSelection() {
    tableComponent.value?.clear();
  }

  function handleNavigate(id: string) {
    void picker.navigateToFolder(id);
  }

  function handleSortChange(sort: Ui3nTableSort<RowType>) {
    picker.setSort(sort.field as string, sort.direction);
  }

  function handleConfirm(row: RowType) {
    // Double-click-to-resolve is desktop openFile behavior only.
    if (dialogRequest?.mode !== 'openFile' || row.isFolder) {
      return;
    }

    // Double-click means "choose this specific file". Pass that intent
    // directly to the dialog instead of rewriting table selection state.
    emit('confirm', row);
  }

  watch(
    tableComponent,
    table => {
      emit('init', table);
    },
    { immediate: true },
  );

  // Navigation changes browsing context, so selection and displayed-row
  // state must not survive it.
  watch(
    () => [picker.activeRootId.value, picker.currentWindow.value.status, picker.currentWindow.value.currentPath],
    () => {
      clearTableSelection();
      openFsEntityInfoBlock(null);
    },
  );
</script>

<template>
  <div :class="$style.fileListPanel">
    <div
      v-if="picker.currentWindow.value.status === 'error'"
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
        :head="tableData.head"
        :body="tableData.body"
        @select:row="handleSelectRow"
        @change:sort="handleSortChange"
      >
        <template #row="{ row, isRowSelected, columnStyle, events }">
          <picker-table-row
            :row="row"
            :is-row-selected="isRowSelected"
            :fs-id="picker.activeFsId.value"
            :column-style="columnStyle"
            :events="events"
            :resolve-file-on-click="resolveFileOnRowClick"
            :class="$style.parentRow"
            @open:info="handleOpenInfo"
            @navigate="handleNavigate"
            @confirm="handleConfirm"
          />
        </template>
      </ui3n-table>

      <div
        v-if="commonLoading"
        :class="$style.loader"
      >
        <ui3n-progress-circular
          indeterminate
          size="100"
        />
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
  .fileListPanel {
    color: var(--color-text-control-primary-default);
    height: 100%;
    overflow-y: auto;
  }
  .statusMessage {
    color: var(--color-text-control-secondary-default, #888);
    padding: 12px 0;
  }
  .tableWrapper {
    position: relative;
    height: 100%;
  }
  .loader {
    position: absolute;
    inset: 0;
    z-index: 10;
    background-color: var(--black-12);
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
  }
  .parentRow {
    display: flex;
    align-items: center;
    min-height: 28px;
  }
</style>
