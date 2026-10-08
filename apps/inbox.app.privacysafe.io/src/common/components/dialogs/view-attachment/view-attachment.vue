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
  import { inject, onMounted } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { isFileImage, isFileVideo, isFileAudio, getFileExtension } from '@v1nt1248/3nclient-lib/utils';
  import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { useAppStore } from '@common/store/app.store';
  import { Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useDownloadAttachments } from '@/common/composables/useDownloadAttachments';
  import { getFileByInfoFromMsg } from '@common/utils/files';
  import { attachmentAvailabilityOf } from '@shared/utils/attachment-availability';
  import type { AttachmentInfo } from '@common/types';
  import ImageView from './attachment-image-view.vue';
  import PdfView from './attachment-pdf-view.vue';
  import VideoView from './attachment-video-view/attachment-video-view.vue';
  import AudioView from './attachment-audio-view/attachment-audio-view.vue';

  const props = defineProps<{
    item: AttachmentInfo;
    msgId: string;
    isIncomingMessage?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'close'): void;
  }>();

  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { downloadAttachment } = useDownloadAttachments({
    msgId: props.msgId,
    isIncomingMessage: props.isIncomingMessage,
    t,
  });

  const { isMobileMode } = storeToRefs(useAppStore());

  function getFileExt(fileName: string): string {
    return getFileExtension(fileName);
  }

  // Getting the file object reads no bytes, so this is a cheap way to say why
  // nothing can be shown instead of putting up a viewer that stays empty.
  //
  // The viewer is reachable from places other than the chip whose button is
  // hidden, and a silently empty window is the worst of the possible answers.
  onMounted(async () => {
    const incomingMsgId = props.isIncomingMessage ? props.msgId : undefined;
    if (attachmentAvailabilityOf(props.item, incomingMsgId) === 'on-another-device') {
      $createNotice({
        type: 'error',
        content: t('msg.attachment.on_another_device', { fileName: props.item.fileName }),
      });
      emits('close');
      return;
    }

    const file = await getFileByInfoFromMsg(props.item, incomingMsgId);
    if (!file) {
      $createNotice({
        type: 'error',
        content: t('msg.attachment.link_broken', { fileName: props.item.fileName }),
      });
      emits('close');
    }
  });
</script>

<template>
  <div :class="[$style.chatMessageAttachmentView, isMobileMode && $style.mobile]">
    <div :class="$style.actions">
      <ui3n-tooltip
        :content="t('msg.content.tooltip.download')"
        position-strategy="fixed"
        placement="bottom-end"
      >
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="outline-file-download"
          icon-size="24"
          icon-color="var(--color-icon-table-primary-default)"
          @click.stop.prevent="downloadAttachment(item)"
        />
      </ui3n-tooltip>

      <ui3n-tooltip
        :content="t('msg.attachment.view_exit')"
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

    <image-view
      v-if="isFileImage({ fullName: item.fileName })"
      :item="item"
      :incoming-msg-id="isIncomingMessage ? msgId : undefined"
      :is-mobile-mode="isMobileMode"
      @cancel="emits('close')"
    />

    <pdf-view
      v-else-if="getFileExt(item.fileName) === 'pdf'"
      :item="item"
      :incoming-msg-id="isIncomingMessage ? msgId : undefined"
      :is-mobile-mode="isMobileMode"
      @cancel="emits('close')"
    />

    <video-view
      v-else-if="isFileVideo({ fullName: item.fileName })"
      :item="item"
      :incoming-msg-id="isIncomingMessage ? msgId : undefined"
      :is-mobile-mode="isMobileMode"
      @cancel="emits('close')"
    />

    <audio-view
      v-else-if="isFileAudio({ fullName: item.fileName })"
      :item="item"
      :incoming-msg-id="isIncomingMessage ? msgId : undefined"
      :is-mobile-mode="isMobileMode"
      @cancel="emits('close')"
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
