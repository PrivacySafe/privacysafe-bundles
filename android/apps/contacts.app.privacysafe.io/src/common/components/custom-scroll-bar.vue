<script setup lang="ts">
  import type { Ui3nScrollbarVerticalProps, Ui3nScrollbarVerticalSlots } from '@v1nt1248/3nclient-lib';
  import { Ui3nScrollbarVertical } from '@v1nt1248/3nclient-lib';

  const scrollBarConfig = withDefaults(
    defineProps<{
      props?: Ui3nScrollbarVerticalProps;
    }>(),
    {
      props: () => ({
        thumbMinHeight: 32,
        thumbActiveColor: 'var(--color-bg-control-accent-hover)',
        trackWidth: 8,
      }),
    },
  );

  defineSlots<Ui3nScrollbarVerticalSlots>();
</script>

<template>
  <ui3n-scrollbar-vertical v-bind="scrollBarConfig.props">
    <slot />
  </ui3n-scrollbar-vertical>
</template>
