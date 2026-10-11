<script setup lang="ts">
  import { computed, ref } from 'vue';
  import {
    Ui3nDialog,
    Ui3nButton,
    Ui3nInput,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { useI18n } from 'vue-i18n';

  import { isValidFileName } from '@picker/common/utils/validate-filename';

  const props = defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
    data: string;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: unknown }): void;
  }>();

  const mode = ref<'confirm' | 'rename'>('confirm');
  const newName = ref(props.data);
  const { t } = useI18n();

  const isRenameValid = computed(() => {
    const trimmed = newName.value.trim();
    return !!trimmed && trimmed !== props.data && isValidFileName(trimmed);
  });

  function handleOverwrite() {
    emits('action', { event: 'confirm' });
  }

  function enterRenameMode() {
    mode.value = 'rename';
  }

  function handleChange() {
    if (!isRenameValid.value) {
      return;
    }
    emits('action', { event: 'confirm', data: newName.value.trim() });
  }

  function handleCancel() {
    emits('action', { event: 'cancel' });
  }

  function handleCancelAction() {
    if (mode.value === 'rename') {
      newName.value = props.data;
      mode.value = 'confirm';
      return;
    }

    handleCancel();
  }

  function handlePrimaryAction() {
    if (mode.value === 'rename') {
      handleChange();
      return;
    }

    handleOverwrite();
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.modalBody">
        <span>"{{ props.data }}" {{ t('dialog.file_exist.warning') }}</span>

        <ui3n-input
          v-if="mode === 'rename'"
          v-model="newName"
          :placeholder="t('dialog.file_exist.placeholder.new_name')"
          clearable
          :class="$style.nameInput"
          @enter="handleChange"
        />
      </div>
    </template>
    <template #actions>
      <div :class="$style.actionRow">
        <ui3n-button
          type="custom"
          color="var(--color-bg-button-tritery-default)"
          @click="handleCancelAction"
        >
          {{ t('dialog.file_exist.button.cancel') }}
        </ui3n-button>

        <ui3n-button
          v-if="mode === 'confirm'"
          type="custom"
          color="var(--color-bg-button-tritery-default)"
          @click="enterRenameMode"
        >
          {{ t('dialog.file_exist.button.rename') }}
        </ui3n-button>

        <ui3n-button
          :disabled="mode === 'rename' && !isRenameValid"
          @click="handlePrimaryAction"
        >
          {{ mode === 'rename' ? t('dialog.file_exist.button.change') : t('dialog.file_exist.button.overwrite') }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .modalBody {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-m);
    padding: 17px;
    color: var(--color-text-control-primary-default);
  }

  .actionRow {
    display: flex;
    width: 100%;
    gap: var(--spacing-s);
    justify-content: flex-end;
    padding: 14px;
  }

  .nameInput {
    width: 100%;
  }
</style>
