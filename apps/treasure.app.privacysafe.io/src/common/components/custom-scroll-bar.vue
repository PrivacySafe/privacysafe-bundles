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
  import { Ui3nScrollbarVertical } from '@v1nt1248/3nclient-lib';
  import type { Ui3nScrollbarVerticalProps, Ui3nScrollbarVerticalSlots } from '@v1nt1248/3nclient-lib';

  withDefaults(
    defineProps<{
      config?: Ui3nScrollbarVerticalProps;
    }>(),
    {
      config: () => ({
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
  <ui3n-scrollbar-vertical v-bind="config">
    <slot />
  </ui3n-scrollbar-vertical>
</template>
