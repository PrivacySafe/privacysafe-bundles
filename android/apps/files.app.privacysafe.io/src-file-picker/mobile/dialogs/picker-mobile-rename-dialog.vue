<script setup lang="ts">
  import { ref, computed } from 'vue';
  import {
    Ui3nDialog,
    Ui3nButton,
    Ui3nInput,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { isValidFileName } from '@picker/common/utils/validate-filename';
  import { useI18n } from 'vue-i18n';
  const { t } = useI18n();

  const props = defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
    data: string;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: unknown }): void;
  }>();

  const newName = ref(props.data);

  const hasChanged = computed(() => {
    const trimmed = newName.value.trim();
    return trimmed.length > 0 && trimmed !== props.data && isValidFileName(trimmed);
  });

  function handleConfirm() {
    if (!hasChanged.value) {
      return;
    }
    emits('action', { event: 'confirm', data: newName.value.trim() });
  }

  function handleCancel() {
    emits('action', { event: 'cancel' });
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.body">
        <ui3n-input
          v-model="newName"
          :placeholder="t('dialog.file_exist.placeholder.new_name')"
          clearable
          :class="$style.nameInput"
          @enter="handleConfirm"
        />
      </div>
    </template>
    <template #actions>
      <div :class="$style.actionRow">
        <ui3n-button
          type="custom"
          color="var(--color-bg-button-tritery-default)"
          @click="handleCancel"
        >
          {{ t('dialog.file_exist.button.cancel') }}
        </ui3n-button>

        <ui3n-button
          :disabled="!hasChanged"
          @click="handleConfirm"
        >
          {{ t('dialog.file_exist.button.change') }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    padding: 7px 17px;
  }

  .nameInput {
    width: 100%;
    padding-bottom: 0px;
  }

  .actionRow {
    display: flex;
    gap: var(--spacing-s);
    justify-content: flex-end;
    padding: 14px;
  }
</style>
