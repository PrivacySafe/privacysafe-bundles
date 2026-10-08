<script lang="ts" setup>
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nCheckbox, type Ui3nCheckboxValue } from '@v1nt1248/3nclient-lib';

  withDefaults(
    defineProps<{
      selectedCount?: number;
      indeterminate?: boolean;
    }>(),
    {
      selectedCount: 0,
    },
  );
  const emits = defineEmits<{
    (event: 'toggle:selected', value: Ui3nCheckboxValue): void;
    (event: 'cancel'): void;
  }>();

  const { t } = useI18n();
</script>

<template>
  <div :class="$style.tileViewToolbar">
    <ui3n-checkbox
      :model-value="selectedCount > 0 && !indeterminate"
      :indeterminate="indeterminate"
      @change="emits('toggle:selected', $event)"
    >
      {{ t('app.selected') }}: {{ selectedCount }}
    </ui3n-checkbox>

    <div :class="$style.body">
      <slot />
    </div>

    <ui3n-button
      type="secondary"
      @click="emits('cancel')"
    >
      {{ t('dialog.button.cancel') }}
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  .tileViewToolbar {
    position: relative;
    width: 100%;
    height: var(--spacing-xxl);
    border-bottom: 1px solid var(--color-border-block-primary-default);
    padding: 0 var(--spacing-m);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .body {
    display: flex;
    height: 100%;
    padding: 0 var(--spacing-s);
    flex-grow: 1;
  }
</style>
