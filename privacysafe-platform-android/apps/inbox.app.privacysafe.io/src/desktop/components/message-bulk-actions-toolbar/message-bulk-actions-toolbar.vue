<script lang="ts" setup>
  import { useI18n } from 'vue-i18n';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import type { MessageBulkActions } from '@common/types';
  import { SYSTEM_FOLDERS } from '@common/constants';

  withDefaults(
    defineProps<{
      folder: string;
      markedMessages?: string[];
    }>(),
    {
      markedMessages: () => [],
    },
  );
  const emits = defineEmits<{
    (event: 'bulk-actions', value: { action: MessageBulkActions; messageIds: string[] }): void;
  }>();

  const { t } = useI18n();
</script>

<template>
  <div :class="$style.bulkActionsToolbar">
    <div :class="$style.block">
      <span :class="$style.info"> {{ t('msg.actions.selected') }}: {{ size(markedMessages) }} </span>

      <div :class="$style.btns">
        <ui3n-tooltip
          v-if="folder === SYSTEM_FOLDERS.trash"
          :content="t('msg.content.tooltip.restore')"
          position-strategy="fixed"
          placement="top-start"
        >
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-refresh"
            icon-color="var(--color-icon-table-primary-default)"
            @click.stop.prevent="emits('bulk-actions', { action: 'restore', messageIds: markedMessages || [] })"
          />
        </ui3n-tooltip>

        <ui3n-tooltip
          v-if="folder !== SYSTEM_FOLDERS.trash"
          :content="t('msg.content.btn.moveToTrash')"
          position-strategy="fixed"
          placement="top-start"
        >
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="outline-delete"
            icon-color="var(--color-icon-table-primary-default)"
            @click.stop.prevent="
              emits('bulk-actions', { action: 'move-to-trash', messageIds: markedMessages || [] })
            "
          />
        </ui3n-tooltip>

        <ui3n-tooltip
          :content="t('msg.content.btn.deleteForever')"
          position-strategy="fixed"
          placement="top-start"
        >
          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="trash-can"
            icon-color="var(--warning-content-default)"
            @click.stop.prevent="emits('bulk-actions', { action: 'delete', messageIds: markedMessages || [] })"
          />
        </ui3n-tooltip>
      </div>
    </div>

    <ui3n-tooltip
      :content="t('msg.actions.cancel_tooltip')"
      position-strategy="fixed"
      placement="top-end"
    >
      <ui3n-button
        type="secondary"
        @click.stop.prevent="emits('bulk-actions', { action: 'cancel', messageIds: markedMessages || [] })"
      >
        {{ t('msg.actions.cancel') }}
      </ui3n-button>
    </ui3n-tooltip>
  </div>
</template>

<style lang="scss" module>
  .bulkActionsToolbar {
    display: flex;
    width: 100%;
    height: 100%;
    justify-content: space-between;
    align-items: center;
    background-color: var(--color-bg-block-primary-default);
    padding: 0 var(--spacing-m);
  }

  .block {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-ml);
  }

  .info {
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
  }

  .btns {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }
</style>
