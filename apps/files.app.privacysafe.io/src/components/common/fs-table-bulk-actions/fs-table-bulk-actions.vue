<script lang="ts" setup>
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import isEmpty from 'lodash/isEmpty';
  import { Ui3nButton, Ui3nSwitch, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAbilities } from '@/composables/useAbilities';
  import { FS_TABLE_BULK_ACTIONS } from '@/constants';
  import type { FsTableBulkActionsProps, FsTableBulkActionsEmits } from './types';

  const props = withDefaults(defineProps<FsTableBulkActionsProps>(), {
    windowIndex: 1,
    selectedEntities: () => [],
  });
  const emits = defineEmits<FsTableBulkActionsEmits>();

  const { t } = useI18n();

  const isSelectedEmpty = computed(() => isEmpty(props.selectedEntities));

  const { canDownload, canRestore, canDelete, canDeleteCompletely, canCopyMove, canResolve } = useAbilities();
</script>

<template>
  <div :class="$style.fsHomeTableBulkActions">
    <div :class="$style.actionsBlock">
      <ui3n-tooltip
        v-if="canDownload(selectedEntities)"
        :content="FS_TABLE_BULK_ACTIONS['download']?.tooltip ? t(FS_TABLE_BULK_ACTIONS['download']!.tooltip) : ''"
        :disabled="!FS_TABLE_BULK_ACTIONS['download']?.tooltip"
        position-strategy="fixed"
        placement="top-start"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="FS_TABLE_BULK_ACTIONS['download']!.icon"
          :icon-color="FS_TABLE_BULK_ACTIONS['download']!.iconColor ?? 'var(--color-icon-table-primary-default)'"
          :disabled="disabled || isSelectedEmpty"
          @click.stop.prevent="emits('action', { action: 'download' })"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        v-if="canRestore({
          currentFsId: fsId,
          currentRootFolderId: rootFolderId,
          currentFolderPath: folderPath,
          selectedEntities}
        )"
        :content="FS_TABLE_BULK_ACTIONS['restore']?.tooltip ? t(FS_TABLE_BULK_ACTIONS['restore']!.tooltip) : ''"
        :disabled="!FS_TABLE_BULK_ACTIONS['restore']?.tooltip"
        position-strategy="fixed"
        placement="top-start"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="FS_TABLE_BULK_ACTIONS['restore']!.icon"
          :icon-color="FS_TABLE_BULK_ACTIONS['restore']!.iconColor ?? 'var(--color-icon-table-primary-default)'"
          :disabled="disabled || isSelectedEmpty"
          @click.stop.prevent="emits('action', { action: 'restore' })"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        v-if="canResolve(fsId, selectedEntities)"
        :content="FS_TABLE_BULK_ACTIONS['resolve']?.tooltip ? t(FS_TABLE_BULK_ACTIONS['resolve']!.tooltip) : ''"
        :disabled="!FS_TABLE_BULK_ACTIONS['resolve']?.tooltip"
        position-strategy="fixed"
        placement="top-start"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="FS_TABLE_BULK_ACTIONS['resolve']!.icon"
          :icon-color="FS_TABLE_BULK_ACTIONS['resolve']!.iconColor ?? 'var(--color-icon-table-primary-default)'"
          :disabled="disabled || isSelectedEmpty"
          @click.stop.prevent="emits('action', { action: 'resolve' })"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        v-if="canDelete(fsId, rootFolderId)"
        :content="FS_TABLE_BULK_ACTIONS['delete']?.tooltip ? t(FS_TABLE_BULK_ACTIONS['delete']!.tooltip) : ''"
        :disabled="!FS_TABLE_BULK_ACTIONS['delete']?.tooltip"
        position-strategy="fixed"
        placement="top-start"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="FS_TABLE_BULK_ACTIONS['delete']!.icon"
          :icon-color="FS_TABLE_BULK_ACTIONS['delete']!.iconColor ?? 'var(--color-icon-table-primary-default)'"
          :disabled="disabled || isSelectedEmpty"
          @click.stop.prevent="emits('action', { action: 'delete' })"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        v-if="canDeleteCompletely(fsId, rootFolderId, folderPath)"
        :content="FS_TABLE_BULK_ACTIONS['delete:completely']?.tooltip ? t(FS_TABLE_BULK_ACTIONS['delete:completely']!.tooltip) : ''"
        :disabled="!FS_TABLE_BULK_ACTIONS['delete:completely']?.tooltip"
        position-strategy="fixed"
        placement="top-start"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          :icon="FS_TABLE_BULK_ACTIONS['delete:completely']!.icon"
          :icon-color="FS_TABLE_BULK_ACTIONS['delete:completely']!.iconColor ?? 'var(--color-icon-table-primary-default)'"
          :disabled="disabled || isSelectedEmpty"
          @click.stop.prevent="emits('action', { action: 'delete:completely' })"
        />
      </ui3n-tooltip>
    </div>

    <div
      v-if="canCopyMove(rootFolderId) && isInSplitMode"
      :class="$style.actionsBlock"
    >
      <span>{{ t('fs.action.copy_label') }}</span>

      <ui3n-tooltip
        :content="FS_TABLE_BULK_ACTIONS['copy/move']?.tooltip ? t(FS_TABLE_BULK_ACTIONS['copy/move']!.tooltip) : ''"
        :disabled="!FS_TABLE_BULK_ACTIONS['copy/move']?.tooltip"
        position-strategy="fixed"
        placement="top-end"
      >
        <ui3n-switch
          :model-value="!!isMoveMode || !!isMoveModeQuick"
          :class="$style.copyMoveSwitcher"
          @update:model-value="emits('update:move-mode', $event)"
        />
      </ui3n-tooltip>

      <span>{{ t('fs.action.move_label') }}</span>
    </div>
  </div>
</template>

<style lang="scss" module>
  .fsHomeTableBulkActions {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .actionsBlock {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-12);
    color: var(--color-text-control-primary-default);
  }

  .copyMoveSwitcher {
    --ui3n-switch-off-color: var(--success-content-default) !important;
  }
</style>
