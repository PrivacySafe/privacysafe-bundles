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
import { onMounted, ref } from 'vue';
import isEmpty from 'lodash/isEmpty';
import { Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
import { getFileByInfoFromMsg } from '@main/common/utils/files.helper';
import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';
import type { EntityListItem } from './types';
import FolderViewFolder from './folder-view-folder.vue';
import FolderViewFile from './folder-view-file.vue';
import ListingEntry = web3n.files.ListingEntry;

const props = defineProps<{
  item: AttachmentViewInfo;
  incomingMsgId?: string;
  isMobileMode?: boolean;
}>();
const emits = defineEmits<{
  (event: 'error'): void;
}>();

const isProcessing = ref(true);
const entityList = ref<EntityListItem[]>([]);
const cancelGettingFolderList = ref(false);

async function getFolderList(folder: web3n.files.ReadonlyFS) {
  const list: EntityListItem[] = [];
  let entries: ListingEntry[];
  try {
    entries = await folder.listFolder('');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    entries = [];
  }

  for (const entity of entries) {
    if (cancelGettingFolderList.value) {
      break;
    }

    const { isFolder } = entity;
    if (isFolder) {
      const newFolder = await folder.readonlySubRoot(entity.name);
      const item = {
        ...entity,
        children: await getFolderList(newFolder),
      };
      list.push(item);
    } else {
      list.push(entity);
    }
  }

  return list;
}

onMounted(async () => {
  isProcessing.value = true;

  try {
    const entity = await getFileByInfoFromMsg(props.item.id!, props.incomingMsgId);
    if (!entity) {
      isProcessing.value = false;
      emits('error');
      return;
    }

    entityList.value = await getFolderList(entity as web3n.files.ReadonlyFS);
  } finally {
    isProcessing.value = false;
  }
});
</script>

<template>
  <div :class="[$style.folderView, isMobileMode && $style.mobile]">
    <div
      v-if="!isEmpty(entityList) && !isProcessing"
      :class="$style.body"
    >
      <div :class="$style.list">
        <template
          v-for="entity in entityList"
          :key="entity.name"
        >
          <folder-view-folder
            v-if="entity.isFolder"
            :name="entity.name"
            :children="entity.children!"
          />

          <folder-view-file
            v-else
            :name="entity.name"
          />
        </template>
      </div>
    </div>

    <ui3n-progress-circular
      v-else
      indeterminate
      size="108"
      :class="$style.loader"
    />
  </div>
</template>

<style lang="scss" module>
@use '@main/common/assets/styles/mixins' as mixins;

.folderView {
  position: relative;
  width: 100%;
  height: 100%;
  padding: var(--spacing-xxl) var(--spacing-m);
  overflow: hidden;

  &.mobile {
    padding: var(--spacing-xl) var(--spacing-s);
  }
}

.body {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
  @include mixins.scrollbar(96px);
}

.list {
  position: relative;
  width: fit-content;
}

.loader {
  position: absolute;
  z-index: 5500;
  left: calc(50% - 54px);
  top: 50%;
  transform: translateY(-50%);
}
</style>
