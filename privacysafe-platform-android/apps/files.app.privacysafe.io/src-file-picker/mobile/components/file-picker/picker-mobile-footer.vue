<script lang="ts" setup>
  import { computed, inject } from 'vue';
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { usePickerState } from '@picker/common/composables/usePickerState';
  import { usePickerConfirmState } from '@picker/common/composables/usePickerConfirmState';
  import { DIALOG_REQUEST_KEY } from '@picker/common/dialog-capabilities';
  import type { PickerTableRow } from '@picker/common/types';

  const props = defineProps<{ selectedRows: PickerTableRow[] }>();
  const emit = defineEmits<{ confirm: [] }>();

  const picker = usePickerState();
  const dialogRequest = inject(DIALOG_REQUEST_KEY);

  const { hasSelection, confirmLabel } = usePickerConfirmState(
    dialogRequest,
    picker,
    computed(() => props.selectedRows),
  );
</script>

<template>
  <div :class="$style.footerPanel">
    <ui3n-button
      :class="$style.confirmBtn"
      :disabled="!hasSelection"
      @click="emit('confirm')"
    >
      {{ confirmLabel }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .footerPanel {
    padding: 12px 16px;
    border-top: 1px solid var(--color-border-block-primary-default);
  }
  .confirmBtn {
    width: 100%;
    border-radius: 24px !important;
    height: 48px;
  }
</style>
