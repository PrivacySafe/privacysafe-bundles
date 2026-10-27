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

  const scrollbarRef = ref<InstanceType<typeof Ui3nScrollbarVertical> | null>(null);

  defineExpose({
    getContainer: () => scrollbarRef.value?.getContainer(),
    scrollTo: (options: ScrollToOptions) => scrollbarRef.value?.scrollTo(options),
    updateMetrics: () => scrollbarRef.value?.updateMetrics(),
  });
</script>

<template>
  <ui3n-scrollbar-vertical
    ref="scrollbarRef"
    v-bind="scrollBarConfig.props"
  >
    <slot />
  </ui3n-scrollbar-vertical>
</template>
