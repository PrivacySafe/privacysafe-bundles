<script setup lang="ts">
  import {
    Ui3nDialog,
    Ui3nButton,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useI18n } from 'vue-i18n';

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
    data: string;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: unknown }): void;
  }>();
  const { t } = useI18n();
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.body">
        {{ t('file_picker.folder_exists.message', { name: data }) }}
      </div>
    </template>
    <template #actions>
      <div :class="$style.actionRow">
        <ui3n-button
          type="custom"
          color="var(--color-bg-button-tritery-default)"
          @click="emits('action', { event: 'cancel' })"
        >
          {{ t('file_picker.button.cancel') }}
        </ui3n-button>
        <ui3n-button @click="emits('action', { event: 'confirm' })">
          {{ t('file_picker.button.use_folder') }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    padding: 17px;
    color: var(--color-text-control-primary-default);
    overflow-wrap: anywhere;
  }
  .actionRow {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-s);
    padding: 14px;
  }
</style>
