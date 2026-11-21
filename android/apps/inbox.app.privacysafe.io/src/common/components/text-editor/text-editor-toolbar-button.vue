<script lang="ts" setup>
  import { Ui3nIcon, Ui3nTooltip, type Ui3nTooltipPlacement } from '@v1nt1248/3nclient-lib';

  defineProps<{
    icon: string;
    prependIcon?: string;
    tooltip?: string;
    tooltipPlacement?: Ui3nTooltipPlacement;
    isActive?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'click', value: Event): void;
  }>();
</script>

<template>
  <ui3n-tooltip
    :content="tooltip"
    position-strategy="fixed"
    :placement="tooltipPlacement || 'top-start'"
    :disabled="!tooltip"
  >
    <button
      :class="[$style.toolbarButton, prependIcon && $style.toolbarButtonDouble, isActive && $style.toolbarButtonActive]"
      @click="emits('click', $event)"
    >
      <ui3n-icon
        :icon="icon"
        width="18"
        height="18"
      />

      <ui3n-icon
        v-if="prependIcon"
        :icon="prependIcon"
        width="18"
        height="18"
      />
    </button>
  </ui3n-tooltip>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/_mixins' as mixins;

  .toolbarButton {
    display: flex;
    width: var(--spacing-ml);
    min-width: var(--spacing-ml);
    height: var(--spacing-ml);
    min-height: var(--spacing-ml);
    justify-content: center;
    align-items: center;
    border-radius: var(--spacing-xs);
    border: none;
    outline: none;
    padding: 0;
    background-color: var(--color-bg-block-primary-default);
    cursor: pointer;
    @include mixins.ripple(var(--color-bg-button-tritery-hover));

    &.toolbarButtonActive,
    &:hover {
      & > div {
        color: var(--color-icon-control-accent-default) !important;
      }
    }
  }

  .toolbarButtonDouble {
    width: var(--spacing-xxl);
    column-gap: 2px;
  }
</style>
