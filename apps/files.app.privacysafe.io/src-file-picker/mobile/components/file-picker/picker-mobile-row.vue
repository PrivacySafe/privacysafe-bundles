<script lang="ts" setup>
  import { computed } from 'vue';
  import { Ui3nIcon, Ui3nLongPress } from '@v1nt1248/3nclient-lib';
  import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import type { PickerTableRow } from '@picker/common/types';

  const LONG_PRESS_DELAY = 500;
  const LONG_PRESS_DISTANCE_THRESHOLD = 10;
  const vUi3nLongPress = Ui3nLongPress;

  const props = defineProps<{
    row: PickerTableRow;
    isRowSelected?: boolean;
    resolveFileOnTap?: boolean;
    events?: {
      select: (row: PickerTableRow, withoutEvents?: boolean) => void;
    };
  }>();

  const emit = defineEmits<{
    navigate: [id: string];
    confirm: [row: PickerTableRow];
  }>();

  const sizeLabel = computed(() => (props.row.isFolder ? '' : formatFileSize(props.row.size)));
  let longPressTriggered = false;

  // Ui3nTable remains the only owner of checkbox selection. Both icon tap
  // and long press delegate to the table-provided select handler.
  function toggleRowSelection() {
    props.events?.select(props.row);
  }

  function selectRow(e: Event) {
    e.stopPropagation();
    toggleRowSelection();
  }

  function handlePointerDown() {
    // A fresh gesture must never inherit a completed long press whose release
    // did not produce a click (for example after cancellation by the platform).
    longPressTriggered = false;
  }

  function handleLongPress() {
    longPressTriggered = true;
    toggleRowSelection();
  }

  function handleTap() {
    // Ui3nLongPress owns gesture timing/movement cancellation, but browsers
    // still emit click after a completed long press. Consume that click so
    // long-press selection cannot also navigate/resolve the row.
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }

    if (props.row.isFolder) {
      emit('navigate', props.row.id);
      return;
    }
    if (props.resolveFileOnTap) {
      emit('confirm', props.row);
      return;
    }

    // Save mode keeps its existing file-selection behavior so selecting an
    // existing file can populate saveName before Save/collision handling.
    toggleRowSelection();
  }
</script>

<template>
  <div
    v-ui3n-long-press="{
      handler: handleLongPress,
      delay: LONG_PRESS_DELAY,
      distanceThreshold: LONG_PRESS_DISTANCE_THRESHOLD,
    }"
    :class="[$style.row, isRowSelected && $style.selected]"
    @pointerdown="handlePointerDown"
    @click="handleTap"
  >
    <span
      :class="$style.iconSlot"
      @pointerdown.stop
      @click="selectRow"
    >
      <ui3n-icon
        v-if="isRowSelected"
        icon="round-check-box"
        :size="20"
        color="var(--color-icon-control-accent-default)"
      />
      <ui3n-icon
        v-else
        :icon="row.isFolder ? 'round-folder' : 'round-subject'"
        :size="20"
        color="var(--color-icon-table-secondary-default)"
      />
    </span>

    <div :class="$style.main">
      <span :class="$style.name">{{ row.name }}</span>
      <span
        v-if="sizeLabel"
        :class="$style.size"
      >
        {{ sizeLabel }}
      </span>
    </div>

    <span :class="$style.date">{{ row.displayingDate }}</span>
  </div>
</template>

<style lang="scss" module>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    cursor: pointer;
    border-bottom: 1px solid var(--color-border-block-primary-default);

    &.selected {
      background-color: var(--color-bg-control-primary-hover);
    }
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-size: var(--font-13);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    font-size: var(--font-11);
    color: var(--color-text-control-secondary-default);
  }
  .date {
    flex-shrink: 0;
    font-size: var(--font-11);
    color: var(--color-text-control-secondary-default);
  }
</style>
