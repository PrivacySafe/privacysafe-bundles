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
  import type { Ui3nScrollbarHorizontalProps, Ui3nScrollbarHorizontalSlots } from '@v1nt1248/3nclient-lib';
  import { Ui3nScrollbarHorizontal } from '@v1nt1248/3nclient-lib';

  const scrollBarConfig = withDefaults(
    defineProps<{
      props?: Ui3nScrollbarHorizontalProps;
    }>(),
    {
      props: () => ({
        thumbMinWidth: 32,
        thumbActiveColor: 'var(--color-bg-control-accent-hover)',
        trackHeight: 8,
      }),
    },
  );

  defineSlots<Ui3nScrollbarHorizontalSlots>();
</script>

<template>
  <ui3n-scrollbar-horizontal v-bind="scrollBarConfig.props">
    <slot />
  </ui3n-scrollbar-horizontal>
</template>
