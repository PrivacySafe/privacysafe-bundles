<!--
 Copyright (C) 2024 - 2025 3NSoft Inc.

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

<script lang="ts" setup>
import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
import { computed, onBeforeUnmount } from 'vue';

const props = defineProps<{
  iconBytes?: Uint8Array;
  iconUrl?: string;
  size?: string;
}>();

const url = computed(() => {
  if (props.iconBytes) {
    const blob = new Blob([props.iconBytes as BlobPart], { type: 'image/png' });
    return window.URL.createObjectURL(blob);
  } else if (props.iconUrl) {
    return props.iconUrl
  } else {
    return undefined;
  }
});

const iconSize = computed(() => props.size || '32');

onBeforeUnmount(() => {
  url.value && window.URL.revokeObjectURL(url.value);
});
</script>

<template>
  <div :class="$style.iconWrapper">
    <img
      v-if="!!url"
      :src="url"
      alt="icon"
      :width="iconSize"
      :height="iconSize"
    >

    <ui3n-icon
      v-else
      icon="round-info"
      :width="iconSize"
      :height="iconSize"
      color="var(--color-icon-control-secondary-default)"
    />
  </div>
</template>

<style lang="scss" module>
.iconWrapper {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
