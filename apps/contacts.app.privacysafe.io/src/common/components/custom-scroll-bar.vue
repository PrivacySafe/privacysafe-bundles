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
        thumbColor: '#6ec1e4',
        thumbHoverColor: '#89d4f0',
        thumbActiveColor: '#fb521f',
        trackWidth: 8,
        trackColor: 'transparent',
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
