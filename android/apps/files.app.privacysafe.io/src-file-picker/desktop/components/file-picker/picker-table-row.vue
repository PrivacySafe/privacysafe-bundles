<script lang="ts" setup>
  import { inject } from 'vue';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import FileType from './file-type/file-type.vue';

  import type { PickerTableRow } from '@picker/common/types';
  import type { FsEntityInfoProvideProps } from '@shared/types';

  const props = defineProps<{
    row: PickerTableRow;
    isRowSelected?: boolean;
    fsId: string;
    resolveFileOnClick?: boolean;
    columnStyle?: Record<string, Record<string, string>>;
    events?: {
      select: (row: PickerTableRow, withoutEvents?: boolean) => void;
    };
  }>();

  const emit = defineEmits<{
    'open:info': [row: PickerTableRow];
    navigate: [id: string];
    confirm: [row: PickerTableRow];
  }>();

  const fsEntityInfo = inject<FsEntityInfoProvideProps>('fsEntityInfo');

  if (!fsEntityInfo) {
    throw new Error('fsEntityInfo not provided...is picker-file-list.vue wrapping picker-table-row.vue?');
  }

  const { displayedFsEntityInfo } = fsEntityInfo;

  const getFieldStyle = (key: string) => props.columnStyle?.[key] ?? {};

  function selectRow() {
    props.events?.select(props.row);
  }

  function handleRowClick() {
    // Keep the established row-activation behavior. The TL-requested
    // single-select shortcut applies only to open-file rows.
    if (!props.row.isFolder && props.resolveFileOnClick) {
      emit('confirm', props.row);
      return;
    }
    emit('open:info', props.row);
  }

  function handleIconClick(e: MouseEvent) {
    e.stopPropagation();
    selectRow();
  }

  function handleDblClick() {
    if (props.row.isFolder) {
      emit('navigate', props.row.id);
      return;
    }

    emit('confirm', props.row);
  }
</script>

<template>
  <div
    :class="[displayedFsEntityInfo?.fsId === fsId && displayedFsEntityInfo?.path === row.id && $style.highlight]"
  >
    <div
      :class="$style.row"
      @click="handleRowClick"
      @dblclick="handleDblClick"
    >
      <div
        :class="$style.name"
        :style="getFieldStyle('name')"
      >
        <span
          :class="$style.iconSlot"
          @click="handleIconClick"
        >
          <!-- Selected -->
          <ui3n-icon
            v-if="isRowSelected"
            icon="round-check-box"
            :size="20"
            color="var(--color-icon-control-accent-default)"
          />
          <!-- Not selected -->
          <template v-else>
            <!-- Empty checkbox shown only on hover -->
            <ui3n-icon
              :class="$style.iconCheck"
              icon="round-check-box-outline-blank"
              :size="20"
              color="var(--color-icon-control-secondary-default)"
            />

            <!-- Normal file/folder icon -->
            <ui3n-icon
              :class="$style.iconType"
              :icon="row.isFolder ? 'round-folder' : 'round-subject'"
              :size="20"
              color="var(--color-icon-table-secondary-default)"
            />
          </template>
        </span>
        <span :title="row.name">{{ row.name }}</span>
      </div>

      <div
        :class="$style.type"
        :style="getFieldStyle('type')"
      >
        <file-type
          v-if="row.type"
          :file-type="row.type"
        />
        <span v-else />
      </div>

      <div
        :class="$style.size"
        :style="getFieldStyle('size')"
      >
        {{ row.size ? formatFileSize(row.size) : '' }}
      </div>

      <div
        :class="$style.date"
        :style="getFieldStyle('displayingDate')"
      >
        {{ row.displayingDate }}
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  .row {
    display: flex;
    width: 100%;
    cursor: pointer;
    font-size: 12px;
    padding: 3px 0px 3px 15px;
    align-items: center;
    min-height: 29px;
  }

  .highlight {
    background-color: var(--color-bg-control-primary-hover) !important;
  }

  .name,
  .type,
  .size,
  .date {
    min-width: 0;
    overflow: hidden;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 8px;

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
  .iconSlot {
    display: inline-flex;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
  }

  .iconCheck {
    display: none !important;
  }
  .iconType {
    position: relative;
  }

  .row:hover .iconCheck {
    display: block !important;
  }
  .row:hover .iconType {
    display: none !important;
  }

  .type,
  .size,
  .date {
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--ui3n-table-cell-font-size, 12px);
    color: var(--ui3n-table-row-color);
  }
</style>
