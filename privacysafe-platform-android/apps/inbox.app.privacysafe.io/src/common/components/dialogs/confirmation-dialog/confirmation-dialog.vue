<script lang="ts" setup>
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nDialog,
    Ui3nHtml,
    type Ui3nDialogEvent,
    type Ui3nDialogComponentProps,
  } from '@v1nt1248/3nclient-lib';

  // Markup, and not only decoration: a confirmation names the address it is
  // about, and the address has to stand out from the sentence around it.
  const vUi3nHtml = Ui3nHtml;

  const props = defineProps<{
    dialogText?: string;
    additionalDialogText?: string;
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();

  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: boolean }): void;
  }>();

  const { t } = useI18n();

  const text = computed(() => props.dialogText || t('confirmation.dialog.text'));
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.confirmationDialog">
        <div v-ui3n-html="text" />
        <span
          v-if="additionalDialogText"
          v-ui3n-html="additionalDialogText"
        />
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .confirmationDialog {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-s);
    padding: var(--spacing-m);
    font-size: var(--font-14);
    line-height: var(--font-20);
    font-weight: 400;
    color: var(--color-text-block-primary-default);
    text-align: center;
  }
</style>
