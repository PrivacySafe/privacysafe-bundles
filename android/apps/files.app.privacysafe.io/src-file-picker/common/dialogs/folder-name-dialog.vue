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
  import { hasFileExceptionFlag } from '@picker/common/utils/folder-operations';

  const props = defineProps<{
    dialogProps?: Ui3nDialogComponentProps<boolean>;
    data: {
      name: string;
      allowEmpty?: boolean;
      create?: (name: string) => Promise<void>;
    };
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: unknown }): void;
  }>();
  const { t } = useI18n();
  const name = ref(props.data.name);
  const busy = ref(false);
  const errorKey = ref('');
  const valid = computed(() => {
    const trimmed = name.value.trim();
    return (props.data.allowEmpty && !trimmed) || isValidFileName(trimmed);
  });

  function handleAction(action: { event: Ui3nDialogEvent; data?: unknown }) {
    if (!busy.value && action.event !== 'confirm') {
      emits('action', action);
    }
  }

  async function handleConfirm() {
    if (busy.value || !valid.value) {
      return;
    }
    busy.value = true;
    errorKey.value = '';
    const trimmed = name.value.trim();
    try {
      await props.data.create?.(trimmed);
      emits('action', { event: 'confirm', data: trimmed });
    } catch (error) {
      errorKey.value = hasFileExceptionFlag(error, 'alreadyExists')
        ? 'file_picker.notification.error.folder_create_conflict'
        : 'file_picker.notification.error.create_folder';
    } finally {
      busy.value = false;
    }
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.body">
        <ui3n-input
          v-model="name"
          :placeholder="t('file_picker.folder_name')"
          :disabled="busy"
          clearable
          :class="$style.nameInput"
          @update:model-value="errorKey = ''"
          @enter="handleConfirm"
        />
        <span
          v-if="errorKey"
          role="alert"
          >{{ t(errorKey) }}</span
        >
        <span
          v-else-if="name.trim() && !valid"
          role="alert"
        >
          {{ t('file_picker.notification.error.invalid_filename') }}
        </span>
        <span v-if="data.allowEmpty">{{ t('file_picker.folder_name_empty_hint') }}</span>
      </div>
    </template>
    <template #actions>
      <div :class="$style.actionRow">
        <ui3n-button
          type="custom"
          color="var(--color-bg-button-tritery-default)"
          :disabled="busy"
          @click="handleAction({ event: 'cancel' })"
        >
          {{ t('file_picker.button.cancel') }}
        </ui3n-button>
        <ui3n-button
          :disabled="busy || !valid"
          @click="handleConfirm"
        >
          {{ data.create ? t('file_picker.button.create') : t('dialog.file_exist.button.change') }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-s);
    padding: 17px;
    color: var(--color-text-control-primary-default);
    overflow-wrap: anywhere;
  }
  .nameInput {
    width: 100%;
  }
  .actionRow {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-s);
    padding: 14px;
  }
</style>
