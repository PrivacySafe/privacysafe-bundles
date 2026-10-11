<script lang="ts" setup>
  import { Ui3nChip, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';

  const props = defineProps<{
    address: string;
    tooltipContent?: string;
    allowAdding?: boolean;
    disabled?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'select'): void;
  }>();

  function select() {
    if (!props.allowAdding) {return;}

    emits('select');
  }
</script>

<template>
  <ui3n-tooltip
    :content="tooltipContent"
    position-strategy="fixed"
    placement="top-start"
    :disabled="!tooltipContent"
  >
    <ui3n-chip
      :id="address"
      height="32"
      max-width="100%"
      :class="allowAdding && $style.pointer"
      :disabled="disabled"
      @click.stop.prevent="select"
    >
      <template #left>
        <contact-icon
          :size="24"
          :name="address"
          readonly
        />
      </template>

      <span :class="$style.contact">
        {{ address }}
      </span>
    </ui3n-chip>
  </ui3n-tooltip>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/mixins' as mixins;

  .pointer {
    cursor: pointer;
  }

  .contact {
    display: block;
    font-size: var(--font-10);
    font-weight: 400;
    color: var(--color-text-control-primary-default);
    @include mixins.text-overflow-ellipsis();
  }
</style>
