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
import { unzipSync } from 'fflate';
import size from 'lodash/size';
import get from 'lodash/get';
import set from 'lodash/set';
import { Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
import { getFileByInfoFromMsg } from '@main/common/utils/files.helper';
import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';
import type { EntityListItem } from './types';
import isEmpty from 'lodash/isEmpty';
import FolderViewFolder from './folder-view-folder.vue';
import FolderViewFile from './folder-view-file.vue';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ArchiveView');

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

function handleZipEntry(path: string, dir: boolean) {
  const separator = path.includes('/') ? '/' : '\\';
  const processedPath = dir
    ? path.slice(0, path.length - 1).split(separator)
    : path.split(separator);
  const name = processedPath.pop()!;

  const entityItem: EntityListItem = {
    name,
    isFolder: dir,
    ...(dir && { children: [] }),
  };
  if (size(processedPath) === 0) {
    entityList.value.push(entityItem);
  } else {
    const parentFolderPath = [];
    for (let i = 0; i < size(processedPath); i++) {
      const ind: number = i === 0
        ? entityList.value.findIndex(item => item.isFolder && item.name === processedPath[i])
        : (get(entityList.value, parentFolderPath, []) as EntityListItem[])
          .findIndex(item => item.isFolder && item.name === processedPath[i]);

      if (ind > -1) {
        parentFolderPath.push(ind);
        parentFolderPath.push('children');
      }
    }

    const currentSizeParentFolder = size(get(entityList.value, parentFolderPath, []));
    set(entityList.value, [...parentFolderPath, currentSizeParentFolder], entityItem);
  }
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

    const uint8Array = await (entity as web3n.files.ReadonlyFile).readBytes();
    if (uint8Array) {
      // Only the archive's table of contents is needed here. The filter runs
      // for every central directory entry, and returning false from it keeps
      // fflate from inflating any of the content.
      unzipSync(uint8Array, {
        filter: ({ name }) => {
          handleZipEntry(name, name.endsWith('/') || name.endsWith('\\'));
          return false;
        },
      });
    }
  } catch (e) {
    log.error(`Error unzipping file ${props.item.filename}.`, e);
    emits('error');
  } finally {
    isProcessing.value = false;
  }
});
</script>

<template>
  <div :class="[$style.archiveView, isMobileMode && $style.mobile]">
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

.archiveView {
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
