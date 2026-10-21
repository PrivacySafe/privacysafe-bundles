<!--
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
-->
<script setup lang="ts">
  import { ref } from 'vue';
  import type { Ui3nScrollbarProps, Ui3nScrollbarSlots } from '@v1nt1248/3nclient-lib';
  import { Ui3nScrollbar } from '@v1nt1248/3nclient-lib';

  const scrollBarConfig = withDefaults(
    defineProps<{
      props?: Ui3nScrollbarProps;
    }>(),
    {
      props: () => ({
        axes: 'both',
        vertical: {
          thumbMinHeight: 32,
          thumbActiveColor: 'var(--color-bg-control-accent-hover)',
          trackWidth: 8,
        },
        horizontal: {
          thumbMinWidth: 32,
          thumbActiveColor: 'var(--color-bg-control-accent-hover)',
          trackHeight: 8,
        },
      }),
    },
  );

  defineSlots<Ui3nScrollbarSlots>();

  const scrollbarRef = ref<InstanceType<typeof Ui3nScrollbar> | null>(null);

  defineExpose({
    getContainer: () => scrollbarRef.value?.getContainer(),
    scrollTo: (options: ScrollToOptions) => scrollbarRef.value?.scrollTo(options),
    scrollToVertical: (options?: { top?: number; behavior?: ScrollBehavior }) =>
      scrollbarRef.value?.scrollToVertical(options),
    scrollToHorizontal: (options?: { left?: number; behavior?: ScrollBehavior }) =>
      scrollbarRef.value?.scrollToHorizontal(options),
    updateMetrics: () => scrollbarRef.value?.updateMetrics(),
  });
</script>

<template>
  <ui3n-scrollbar
    ref="scrollbarRef"
    v-bind="scrollBarConfig.props"
  >
    <slot />
  </ui3n-scrollbar>
</template>
