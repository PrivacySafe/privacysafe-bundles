<script lang="ts" setup>
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import get from 'lodash/get';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nCheckbox } from '@v1nt1248/3nclient-lib';
  import { useMessagesStore } from '@common/store/messages.store';
  import type { MessageBulkActions } from '@common/types';
  import { SYSTEM_FOLDERS } from '@common/constants';

  const props = withDefaults(
    defineProps<{
      folder: string;
      markedMessages?: string[];
    }>(),
    {
      markedMessages: () => [],
    },
  );
  const emits = defineEmits<{
    (event: 'bulk-actions', value: MessageBulkActions): void;
  }>();

  const { t } = useI18n();

  const messagesStore = useMessagesStore();
  const { messagesByFolders, messageThreadsByFolder, messageThreadsFromTrash } = storeToRefs(messagesStore);

  const messagesInFolderTotal = computed(() => {
    if (props.folder === SYSTEM_FOLDERS.outbox || props.folder === SYSTEM_FOLDERS.draft) {
      return size(get(messagesByFolders.value, [props.folder, 'data'], {}));
    }

    const treads =
      props.folder === SYSTEM_FOLDERS.trash
        ? Object.values(messageThreadsFromTrash.value)
        : get(messageThreadsByFolder.value, props.folder, []);

    return treads.reduce((res, thread) => {
      const { messages } = thread;
      res += size(messages);
      return res;
    }, 0);
  });

  const areAllMessagesInFolderSelected = computed(
    () => size(props.markedMessages) === messagesInFolderTotal.value,
  );
</script>

<template>
  <div :class="$style.bulkActionsToolbar">
    <div :class="$style.row">
      <div :class="$style.block">
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-arrow-back"
          icon-color="var(--color-icon-block-primary-default)"
          icon-size="20"
          @click="emits('bulk-actions', 'cancel')"
        />

        <span :class="$style.info">{{ size(markedMessages) }}</span>
      </div>

      <div :class="$style.block">
        <ui3n-button
          v-if="folder === SYSTEM_FOLDERS.trash"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-refresh"
          icon-color="var(--color-icon-table-primary-default)"
          @click="emits('bulk-actions', 'restore')"
        />

        <ui3n-button
          v-if="folder !== SYSTEM_FOLDERS.trash"
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="outline-delete"
          icon-color="var(--color-icon-table-primary-default)"
          @click="emits('bulk-actions', 'move-to-trash')"
        />

        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="trash-can"
          icon-color="var(--warning-content-default)"
          @click="emits('bulk-actions', 'delete')"
        />
      </div>
    </div>

    <div :class="[$style.row, $style.offset]">
      <div :class="$style.block">
        <ui3n-checkbox
          :model-value="areAllMessagesInFolderSelected"
          @change="emits('bulk-actions', $event ? 'select-all' : 'deselect-all')"
        />

        <span :class="[$style.info, $style.offset]">
          {{ areAllMessagesInFolderSelected ? t('msg.actions.deselect_all') : t('msg.actions.select_all') }}
        </span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  .bulkActionsToolbar {
    position: relative;
    width: 100%;
    height: 100%;
    background-color: var(--color-bg-block-primary-default);
    padding: 0 var(--spacing-s);
  }

  .row {
    display: flex;
    width: 100%;
    height: 50%;
    justify-content: space-between;
    align-items: center;
  }

  .offset {
    padding-left: var(--spacing-s);
  }

  .block {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .info {
    font-size: var(--font-12);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
  }
</style>
