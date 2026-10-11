<!--
 Copyright (C) 2025 3NSoft Inc.

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
import { Ui3nIcon } from '@v1nt1248/3nclient-lib';

defineProps<{
  name: string;
}>();
</script>

<template>
  <div :class="$style.viewFile">
    <ui3n-icon
      icon="round-subject"
      size="16"
      color="var(--color-icon-control-secondary-default)"
    />

    {{ name }}
  </div>
</template>

<style lang="scss" module>
.viewFile {
  --view-file-height: 28px;

  position: relative;
  padding-left: var(--spacing-ml);
  width: fit-content;
  height: var(--view-file-height);
  display: flex;
  justify-content: flex-start;
  align-items: center;
  column-gap: var(--spacing-xs);
  font-size: var(--font-14);
  font-weight: 500;
  color: var(--color-text-table-primary-default);
}
</style>
