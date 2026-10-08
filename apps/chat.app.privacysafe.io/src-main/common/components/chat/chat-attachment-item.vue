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
  import { computed, inject, nextTick, onBeforeMount, ref, watch } from 'vue';
  import {
    getFileExtension,
    formatFileSize,
    isFileAudio,
    isFileImage,
    isFileVideo,
    schedulerYield,
  } from '@v1nt1248/3nclient-lib/utils';
  import { type Nullable, Ui3nIcon, Ui3nProgressCircular, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import type { ChatMessageAttachmentsInfo, Task } from '~/index';
  import { getEntityStat } from '@shared/get-stats-safely';
  import ChatAttachmentType from './chat-attachment-type.vue';
  import { createThumbnail } from '@main/common/utils/create-thumbnail';
  import { makeLogger } from '@shared/logger';

  const log = makeLogger('ChatAttachmentItem');

  const props = defineProps<{
    entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS;
    info: ChatMessageAttachmentsInfo;
  }>();

  const emits = defineEmits<{
    (ev: 'change:size', value: number): void;
    (ev: 'delete'): void;
  }>();

  const { addTask } = inject('task-runner') as { addTask: (task: Task) => void };

  const isCalculatingFolderSize = ref(false);
  const folderSize = ref(0);
  const cancelFolderSizeCalculation = ref(false);

  const isThumbnailCreationProcessGoingOn = ref(false);
  const thumbnail = ref<Nullable<string>>(null);

  const ext = computed(() => getFileExtension(props.info.name).toLowerCase());

  const attachment = computed(() => {
    const lastDotPosition = props.info.name.lastIndexOf('.');
    return {
      ...props.info,
      ext: ext.value,
      attachmentName: props.info.isFolder ? props.info.name : props.info.name.slice(0, lastDotPosition),
      isPossibleThumbnail:
        (isFileImage({ fullName: props.info.name.toLowerCase() }) ||
          isFileVideo({ fullName: props.info.name.toLowerCase() }) ||
          ext.value === 'pdf') &&
        props.info.size,
    };
  });

  const previewStyle = computed(() => {
    if (!attachment.value.isPossibleThumbnail || !thumbnail.value) {
      return {};
    }

    return {
      backgroundImage: `url('${thumbnail.value}')`,
    };
  });

  async function calculateFolderSize(folder: web3n.files.ReadonlyFS): Promise<number> {
    let size = 0;
    let entries: web3n.files.ListingEntry[];
    try {
      entries = await folder.listFolder('');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      entries = [];
    }

    for (const entry of entries || []) {
      if (cancelFolderSizeCalculation.value) {
        break;
      }

      const { name, isFile, isFolder } = entry;
      if (isFile) {
        const stat = await getEntityStat(folder, name, true);
        size += stat.size!;
        folderSize.value += stat.size!;
        await schedulerYield();
      } else if (isFolder) {
        const newFolder = await folder.readonlySubRoot(name);
        size += await calculateFolderSize(newFolder);
      }
    }

    return size;
  }

  function deleteAttachment() {
    cancelFolderSizeCalculation.value = true;
    emits('delete');
  }

  async function makeThumbnailTask() {
    try {
      thumbnail.value = await createThumbnail({
        fileName: props.info.name,
        file3n: props.entity as web3n.files.ReadonlyFile,
        targetSize: 84,
      });
    } catch (e) {
      log.error(`Error making thumbnail for ${props.info.name} file.`, e);
    } finally {
      isThumbnailCreationProcessGoingOn.value = false;
    }
  }

  async function makeThumbnail() {
    if (!attachment.value.isPossibleThumbnail) {
      return;
    }

    isThumbnailCreationProcessGoingOn.value = true;
    addTask(makeThumbnailTask);
  }

  makeThumbnail();

  onBeforeMount(() => {
    if (props.info.isFolder) {
      isCalculatingFolderSize.value = true;
      folderSize.value = 0;
      nextTick(async () => {
        try {
          const folderSize = await calculateFolderSize(props.entity as web3n.files.ReadonlyFS);
          emits('change:size', folderSize);
        } finally {
          isCalculatingFolderSize.value = false;
        }
      });
    }
  });

  watch(folderSize, val => {
    emits('change:size', val || 0);
  });
</script>

<template>
  <div :class="$style.chatAttachment">
    <div :class="$style.name">
      <ui3n-tooltip
        :content="attachment.attachmentName"
        placement="top-start"
        position-strategy="fixed"
      >
        <span>{{ attachment.attachmentName }}</span>
      </ui3n-tooltip>
    </div>

    <div :class="$style.body">
      <div
        v-if="attachment.isPossibleThumbnail"
        :class="$style.preview"
        :style="previewStyle"
      >
        <ui3n-progress-circular
          v-if="isThumbnailCreationProcessGoingOn"
          indeterminate
          size="64"
        />

        <ui3n-icon
          v-if="!isThumbnailCreationProcessGoingOn && !thumbnail"
          icon="file-remove-outline"
          size="64"
        />
      </div>

      <template v-else>
        <ui3n-icon
          v-if="isFileAudio({ fullName: attachment.name.toLowerCase() })"
          icon="sound-wave-circle"
          size="64"
          color="var(--color-icon-block-secondary-default)"
        />

        <ui3n-icon
          v-else-if="attachment.isFolder"
          icon="round-folder"
          size="64"
          color="var(--color-icon-block-secondary-default)"
        />

        <ui3n-icon
          v-else-if="ext === 'zip'"
          icon="file-zip"
          size="64"
          color="var(--color-icon-block-secondary-default)"
        />

        <ui3n-icon
          v-else
          icon="round-attach-file"
          size="64"
          color="var(--color-icon-block-secondary-default)"
        />
      </template>
    </div>

    <div :class="$style.info">
      <div :class="$style.type">
        <chat-attachment-type
          v-if="!attachment.isFolder"
          :file-type="ext"
        />

        <ui3n-icon
          v-if="attachment.isFolder && isCalculatingFolderSize"
          icon="spinner-3-dots-scale"
          size="14"
          color="var(--color-bg-control-accent-default)"
        />
      </div>

      <div
        v-if="attachment.isFolder"
        :class="$style.size"
      >
        <span v-if="isCalculatingFolderSize">{{ formatFileSize(folderSize) }}</span>
        <span v-else>{{ formatFileSize(attachment.size) }}</span>
      </div>

      <div
        v-else
        :class="$style.size"
      >
        {{ formatFileSize(attachment.size) }}
      </div>
    </div>

    <div
      :class="$style.del"
      @click.stop.prevent="deleteAttachment"
    >
      <ui3n-icon
        icon="round-close"
        size="16"
        color="var(--color-icon-control-secondary-default)"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/mixins' as mixins;

  .chatAttachment {
    --chat-attachment-body-size: 124px;

    position: relative;
    display: flex;
    min-width: var(--chat-attachment-body-size);
    width: var(--chat-attachment-body-size);
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    row-gap: var(--spacing-xs);
    border-radius: var(--spacing-s);
    padding: var(--spacing-s);
    background-color: var(--color-bg-table-d-cell-default);

    &:hover {
      .del {
        opacity: 1;
      }
    }
  }

  .del {
    position: absolute;
    width: var(--spacing-m);
    height: var(--spacing-m);
    border-radius: 50%;
    top: 0;
    right: 0;
    z-index: 1;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;

    &:hover {
      opacity: 1;
    }
  }

  .name {
    position: relative;
    width: 100%;
    overflow: hidden;

    span {
      display: block;
      font-size: var(--font-12);
      font-weight: 600;
      line-height: var(--font-16);
      color: var(--color-text-control-primary-default);
      @include mixins.text-overflow-ellipsis();
    }
  }

  .body {
    position: relative;
    display: flex;
    width: 100%;
    aspect-ratio: 5 / 4;
    justify-content: center;
    align-items: center;
  }

  .preview {
    position: relative;
    min-width: 84px;
    width: 84px;
    height: 84px;
    border-radius: var(--spacing-xs);
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .info {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
  }

  .type,
  .size {
    position: relative;
    min-width: var(--spacing-s);
  }

  .size {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-table-primary-default);
  }
</style>
