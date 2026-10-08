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
  import { type Component, onBeforeMount, shallowRef } from 'vue';
  import { storeToRefs } from 'pinia';
  import { isFileImage, isFileVideo, isFileAudio } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@main/common/store/app.store';
  import { saveFileFromMsg } from '@main/common/utils/files.helper';
  import { useOpenAttachment } from './useOpenAttachment';
  import type { AttachmentViewInfo } from './types';
  import ImageView from './attachment-image-view.vue';
  import PdfView from './attachment-pdf-view.vue';
  import VideoView from './attachment-video-view/attachment-video-view.vue';
  import AudioView from './attachment-audio-view/attachment-audio-view.vue';
  import FolderView from './attachment-folder-archive-view/attachment-folder-view.vue';
  import ArchiveView from './attachment-folder-archive-view/attachment-archive-view.vue';

  const props = defineProps<{
    item: AttachmentViewInfo;
    incomingMsgId?: string;
  }>();
  const emits = defineEmits<{
    (event: 'close'): void;
  }>();

  const { t, $createNotice, showError, openEntity } = useOpenAttachment(props, emits);

  const { isMobileMode } = storeToRefs(useAppStore());

  const viewComponent = shallowRef<Component>();

  /**
   * The file was read and the player still could not make sense of it - a file
   * renamed to .mp3, or one damaged in transit. Deliberately not showError():
   * that says the file may have been deleted or moved, which about a file we
   * have just read from beginning to end is simply untrue.
   */
  function onUnplayable() {
    $createNotice({
      type: 'error',
      content: t('chat.viewer.error.cannot_play'),
      duration: 3000,
    });

    emits('close');
  }

  async function downloadFile() {
    const res = await saveFileFromMsg({
      fileId: props.item.id!,
      name: props.item.name,
      t,
      incomingMsgId: props.incomingMsgId,
    });
    if (res === undefined) {
      return;
    }

    $createNotice({
      type: res ? 'success' : 'error',
      content: res
        ? t('chat.message.action_message.success.file_download')
        : t('chat.message.action_message.error.file_download'),
      duration: 3000,
    });
  }

  onBeforeMount(() => {
    if (isFileImage({ fullName: props.item.name.toLowerCase() })) {
      viewComponent.value = ImageView;
    } else if (isFileVideo({ fullName: props.item.name.toLowerCase() })) {
      viewComponent.value = VideoView;
    } else if (isFileAudio({ fullName: props.item.name.toLowerCase() })) {
      viewComponent.value = AudioView;
    } else if (props.item.ext === 'pdf') {
      viewComponent.value = PdfView;
    } else if (props.item.isFolder) {
      viewComponent.value = FolderView;
    } else if (props.item.ext === 'zip') {
      viewComponent.value = ArchiveView;
    }
  });
</script>

<template>
  <div :class="[$style.chatMessageAttachmentView, isMobileMode && $style.mobile]">
    <div :class="$style.actions">
      <ui3n-tooltip
        v-if="!incomingMsgId"
        :content="item.isFolder ? t('chat.message.btn.open.folder') : t('chat.message.btn.open.file')"
        position-strategy="fixed"
        placement="bottom-end"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="outline-folder-open"
          icon-size="24"
          icon-color="var(--color-icon-table-primary-default)"
          @click.stop.prevent="openEntity"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        :content="t('chat.viewer.btn.download')"
        position-strategy="fixed"
        placement="bottom-end"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="outline-file-download"
          icon-size="24"
          icon-color="var(--color-icon-table-primary-default)"
          @click.stop.prevent="downloadFile"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        :content="t('chat.viewer.btn.exit')"
        position-strategy="fixed"
        placement="bottom-end"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-close"
          icon-size="24"
          icon-color="var(--color-icon-table-primary-default)"
          @click.stop.prevent="emits('close')"
        />
      </ui3n-tooltip>
    </div>

    <component
      :is="viewComponent"
      v-if="viewComponent"
      :item="item"
      :incoming-msg-id="incomingMsgId"
      :is-mobile-mode="isMobileMode"
      @error="showError"
      @cancel="emits('close')"
      @unplayable="onUnplayable"
    />
  </div>
</template>

<style lang="scss" module>
  .chatMessageAttachmentView {
    position: fixed;
    inset: 0;
    z-index: 5000;
    background-color: var(--color-bg-block-primary-default);

    &.mobile {
      .actions {
        top: var(--spacing-xs);
      }
    }
  }

  .actions {
    position: fixed;
    top: var(--spacing-s);
    right: var(--spacing-s);
    z-index: 5100;
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }
</style>
