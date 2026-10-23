<!--
 Copyright (C) 2024 - 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
-->
<script setup lang="ts">
  import { computed, inject, nextTick, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import get from 'lodash/get';
  import size from 'lodash/size';
  import { type Nullable, Ui3nEditable, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { getFileExtension, formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import { useDblClickHandler } from '@/composables/useDblClickHandler';
  import { useAbilities } from '@/composables/useAbilities';
  import { useAppStore, useFsStore, useSyncQueueStore } from '@/store';
  import type { FsEntityInfoProvideProps, ListingEntryExtended } from '@shared/types';
  import type { FsTableRowProps, FsTableRowEmits } from './types';
  import FileType from '@/components/common/file-type/file-type.vue';
  import FsEntitySyncStatus from '@/components/common/fs-entity-sync-status/fs-entity-sync-status.vue';
  import { USER_FS } from '@shared/constants';

  const props = defineProps<FsTableRowProps<keyof ListingEntryExtended>>();
  const emits = defineEmits<FsTableRowEmits>();

  const { t } = useI18n();

  const { handleDblClick } = useDblClickHandler(onClick, onDblClick);

  const editNameMode = ref<boolean>(false);

  const { canRename, canSetUnsetFavorite, canCopyMove } = useAbilities();

  const { displayedFsEntityInfo, openFsEntityInfoBlock } = inject<FsEntityInfoProvideProps>('fsEntityInfo')!;

  const appStore = useAppStore();
  const { uploadProcesses, downloadProcesses, adoptProcesses } = storeToRefs(useSyncQueueStore());

  const isRowFromSyncedFsTable = computed(() => props.rootFolderId.includes('synced'));
  const isFsEntryInProcessing = computed(
    () =>
      (uploadProcesses.value.has(props.row.fullPath) ||
        downloadProcesses.value.has(props.row.fullPath) ||
        adoptProcesses.value.has(props.row.fullPath)) &&
      props.fsId === USER_FS,
  );

  const fileExtension = computed(() => {
    if (props.row.type !== 'file') {
      return '';
    }

    const value = props.row.ext || getFileExtension(props.row.name).toLowerCase();
    return size(value) > 5 ? '' : value;
  });

  const isAvailableFavoriteActions = computed(
    () => props.row.type === 'folder' && !props.disabled && canSetUnsetFavorite(props.fsId, props.rootFolderId),
  );

  const { openFile } = useFsStore();

  async function onDblClick() {
    if (props.row.brokeReason) {
      return;
    }

    switch (props.row.type) {
      case 'folder': {
        emits('action', { event: 'go', payload: props.row.fullPath });
        return;
      }

      case 'file': {
        await openFile(props.fsId, props.row.fullPath);
        return;
      }

      case 'link': {
        // TODO How can I correctly determine that a link is a link to a file?
        if (props.row.ext) {
          await openFile(props.fsId, props.row.fullPath, true);
        } else {
          emits('action', { event: 'go:linked-folder', payload: props.row.fullPath });
        }
        return;
      }
    }
  }

  function onClick(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (props.row.brokeReason) {
      return;
    }

    emits('action', { event: 'open:info', payload: { row: props.row } });
  }

  function selectRow(ev: MouseEvent) {
    const { shiftKey } = ev;
    if (shiftKey) {
      emits('select:multiple');
    } else {
      props.events?.select(props.row);
    }

    nextTick(() => openFsEntityInfoBlock(null));
  }

  function getFieldStyle(field: keyof ListingEntryExtended): Record<string, string> {
    const style = get(props.columnStyle, [field], { width: 'auto' });
    return { width: style.width, minWidth: style.width };
  }

  function updateName(name: Nullable<string>): void {
    emits('action', { event: 'rename', payload: { row: props.row, newName: name } });
  }

  function updateFavorite() {
    if (props.row?.type !== 'folder') {
      return;
    }

    emits('action', { event: 'update:favorite', payload: { row: props.row } });
  }
</script>

<template>
  <div
    :class="[
      $style.fsTableRow,
      !!row.brokeReason && $style.damaged,
      displayedFsEntityInfo?.fsId === fsId && displayedFsEntityInfo?.path === row.fullPath && $style.highlight,
      (disabled || readonly || (isFsEntryInProcessing && appStore.connectivityStatus === 'online')) &&
        $style.fsTableRowDisabled,
      isDroppable && $style.droppable,
    ]"
    :draggable="!editNameMode && canCopyMove(rootFolderId)"
    @click="handleDblClick"
  >
    <div
      :class="$style.name"
      :style="getFieldStyle('name')"
    >
      <div
        :class="$style.icon"
        @click.stop.prevent="selectRow"
      >
        <ui3n-icon
          v-if="isRowSelected"
          icon="round-check-box"
          :size="20"
          color="var(--color-icon-control-accent-default)"
        />

        <template v-else>
          <template v-if="isDroppable">
            <ui3n-icon
              icon="round-system-update-alt"
              :rotate="-90"
              color="var(--color-icon-control-accent-default)"
            />
          </template>

          <template v-else>
            <ui3n-icon
              :class="$style.iconCheck"
              icon="round-check-box-outline-blank"
              :size="20"
              color="var(--color-icon-control-accent-default)"
            />

            <ui3n-icon
              :class="$style.iconType"
              :icon="row.type === 'folder' ? 'round-folder' : 'round-subject'"
              :size="20"
              color="var(--color-icon-table-secondary-default)"
            />
          </template>
        </template>
      </div>

      <ui3n-editable
        :model-value="row.name"
        disallow-empty-value
        :disabled="!canRename(fsId, rootFolderId) || disabled || readonly || !!row.brokeReason"
        @toggle:edit-mode="editNameMode = $event"
        @update:model-value="updateName"
      />

      <ui3n-icon
        v-if="row.brokeReason"
        icon="round-crisis-alert"
        color="var(--error-content-default)"
        :title="`${t('app.damaged')}. ${t('app.damaged_reason')}: ${row.brokeReason}`"
        :class="$style.iconDamaged"
      />
    </div>

    <div
      :class="$style.type"
      :style="getFieldStyle('type')"
    >
      <file-type
        v-if="fileExtension"
        :file-type="fileExtension"
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
      v-if="isRowFromSyncedFsTable"
      :class="$style.sync"
      :style="getFieldStyle('sync')"
    >
      <fs-entity-sync-status
        :lock-changes="isLoadingData"
        :task-runner="taskRunner"
        :fs-id="fsId"
        :row="row"
        @refresh-data="emits('action', { event: 'refresh:data' })"
      />
    </div>

    <div
      :class="$style.date"
      :style="getFieldStyle('displayingCTime')"
    >
      {{ row.displayingCTime }}
    </div>

    <ui3n-icon
      v-if="isAvailableFavoriteActions && !isFsEntryInProcessing && !row.brokeReason"
      icon="round-bookmark"
      size="12"
      :color="
        row.favoriteId ? 'var(--color-icon-table-accent-selected)' : 'var(--color-icon-table-accent-unselected)'
      "
      :class="[$style.favoriteIcon, row.favoriteId && $style.favoriteIconSelected]"
      @click.stop="updateFavorite"
    />

    <ui3n-icon
      v-if="isFsEntryInProcessing && appStore.connectivityStatus === 'online'"
      icon="round-lock"
      size="12"
      color="var(--color-icon-control-warning-default)"
      :class="[$style.favoriteIcon, $style.favoriteIconSelected]"
    />
  </div>
</template>

<style lang="scss" module>
  .fsTableRow {
    --fs-table-row-height: 28px;

    position: relative;
    width: 100%;
    height: var(--fs-table-row-height);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding-left: var(--spacing-m);
    font-size: var(--font-12);
    font-weight: 400;
    color: var(--color-text-table-primary-default);

    &:not(.fsTableRowDisabled):hover {
      .favoriteIcon {
        opacity: 1;
        cursor: pointer;
      }

      .iconCheck {
        display: block !important;
      }

      .iconType {
        display: none !important;
      }
    }

    &:hover {
      .name {
        & > div {
          color: var(--color-icon-table-accent-hover) !important;
        }
      }
    }

    &.highlight {
      background-color: var(--ui3n-table-row-bg-color-selected);
    }
  }

  .fsTableRowDisabled {
    pointer-events: none;
    opacity: 0.5;
    cursor: default;
  }

  .droppable {
    position: relative;
    background-color: var(--color-bg-control-primary-hover);
  }

  .favoriteIcon {
    position: absolute;
    left: 2px;
    top: var(--spacing-s);
    z-index: 2;

    &:not(.favoriteIconSelected) {
      opacity: 0;
    }

    &.favoriteIconSelected {
      opacity: 1;
    }
  }

  .name {
    position: relative;
    flex-grow: 1;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    user-select: none;
  }

  .icon {
    position: relative;
    min-width: 20px;
    width: 20px;
    height: 20px;
  }

  .iconCheck {
    position: relative;
    display: none !important;
  }

  .iconType {
    position: relative;
  }

  .iconDamaged {
    position: absolute;
    top: 4px;
    right: 4px;
  }

  .type {
    display: flex;
    padding: 0 var(--spacing-xs);
    justify-content: flex-start;
    align-items: center;
  }
</style>
