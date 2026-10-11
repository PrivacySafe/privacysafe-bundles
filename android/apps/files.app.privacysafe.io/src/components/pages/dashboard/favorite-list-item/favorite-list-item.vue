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
  import { Ui3nIcon, Ui3nTitle } from '@v1nt1248/3nclient-lib';
  import type { FavoriteListItemProps, FavoriteListItemEmits } from './types';

  const vUi3nTitle = Ui3nTitle;

  defineProps<FavoriteListItemProps>();
  const emits = defineEmits<FavoriteListItemEmits>();
</script>

<template>
  <div
    :class="$style.favoriteListItem"
    @click="emits('go', item)"
  >
    <ui3n-icon
      :icon="item.fsId.includes('sync') ? 'folder-sync' : 'round-folder'"
      :width="16"
      :height="16"
      color="var(--color-icon-control-secondary-default)"
    />

    <span
      v-ui3n-title="{
        text: item.fullPath.replaceAll('/', ' / '),
        maxWidth: 300,
        placement: 'top-start'
      }"
      :class="$style.name"
    >
      {{ item.folderName }}
    </span>
  </div>
</template>

<style lang="scss" module>
  @use '../../../../assets/styles/mixins' as mixins;

  .favoriteListItem {
    display: flex;
    width: 100%;
    padding: var(--spacing-s);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    border-radius: var(--spacing-xs);
    cursor: pointer;

    &:hover {
      background-color: var(--color-bg-control-primary-hover);

      & > div {
        color: var(--color-text-control-accent-default) !important;
      }
    }
  }

  .name {
    display: block;
    font-size: var(--font-13);
    line-height: var(--font-20);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
    @include mixins.text-overflow-ellipsis();
  }
</style>
