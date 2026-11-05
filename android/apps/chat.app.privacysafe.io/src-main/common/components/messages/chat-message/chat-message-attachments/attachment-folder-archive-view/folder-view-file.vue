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

  const props = defineProps<{
    name: string;
    path?: string[];
    canOpen?: boolean;
    isPreparing?: (path: string[]) => boolean;
  }>();
  const emits = defineEmits<{
    (event: 'open', path: string[]): void;
  }>();

  function openFile() {
    if (!props.canOpen || !props.path || props.isPreparing?.(props.path)) {
      return;
    }
    emits('open', props.path);
  }
</script>

<template>
  <component
    :is="canOpen ? 'button' : 'div'"
    :type="canOpen ? 'button' : undefined"
    :class="[$style.viewFile, canOpen && $style.openable]"
    :disabled="canOpen && path && isPreparing?.(path)"
    @click.stop="openFile"
  >
    <ui3n-icon
      icon="round-subject"
      size="16"
      color="var(--color-icon-control-secondary-default)"
    />

    {{ name }}
  </component>
</template>

<style lang="scss" module>
  .viewFile {
    --view-file-height: 28px;

    border: 0;
    background: transparent;
    font-family: inherit;
    text-align: left;
    position: relative;
    padding: 0 0 0 var(--spacing-ml);
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

  .openable {
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }

    &:disabled {
      cursor: wait;
      opacity: 0.5;
    }
  }
</style>
