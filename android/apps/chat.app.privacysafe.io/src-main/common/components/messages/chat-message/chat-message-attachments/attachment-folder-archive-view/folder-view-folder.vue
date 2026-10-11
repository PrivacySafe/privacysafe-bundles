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
import { ref } from 'vue';
import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
import { EntityListItem } from './types';
import FolderViewFolder from './folder-view-folder.vue';
import FolderViewFile from './folder-view-file.vue';

defineProps<{
  name: string;
  children: EntityListItem[];
}>();

const isFolderExpanded = ref(false);
</script>

<template>
  <div :class="$style.viewFolder">
    <div
      :class="$style.folderName"
      @click.stop.prevent="isFolderExpanded = !isFolderExpanded"
    >
      <ui3n-icon
        :icon="isFolderExpanded ? 'round-keyboard-arrow-down' : 'round-keyboard-arrow-right'"
        size="16"
        color="var(--color-icon-control-secondary-default)"
      />

      <ui3n-icon
        icon="round-folder"
        size="16"
        color="var(--color-icon-control-secondary-default)"
      />

      {{ name }}
    </div>

    <transition-group name="fade">
      <div
        v-if="isFolderExpanded"
        :class="$style.folderBody"
      >
        <div
          v-for="item in children"
          :key="item.name"
          :class="$style.folderItem"
        >
          <folder-view-folder
            v-if="item.isFolder"
            :name="item.name"
            :children="item.children!"
          />

          <folder-view-file
            v-else
            :name="item.name"
          />
        </div>
      </div>
    </transition-group>
  </div>
</template>

<style lang="scss" module>
.viewFolder {
  --view-folder-height: 28px;

  position: relative;
  width: fit-content;
}

.folderName {
  height: var(--view-folder-height);
  display: flex;
  justify-content: flex-start;
  align-items: center;
  column-gap: var(--spacing-xs);
  font-size: var(--font-14);
  font-weight: 500;
  color: var(--color-text-table-primary-default);
  cursor: pointer;
}

.folderBody {
  position: relative;
  width: fit-content;
  padding-left: var(--spacing-ml);
}

.folderItem {
  position: relative;
}
</style>
