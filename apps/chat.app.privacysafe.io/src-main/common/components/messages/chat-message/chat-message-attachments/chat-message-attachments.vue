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

<script lang="ts" setup>
  import { computed } from 'vue';
  import isEmpty from 'lodash/isEmpty';
  import { useI18n } from 'vue-i18n';
  import { getFileExtension, isFileImage, isFileVideo, isFileAudio } from '@v1nt1248/3nclient-lib/utils';
  import type { ChatMessageAttachmentsInfo, RegularMsgView } from '~/index';
  import { recordingOfAttachments } from '@main/common/utils/chat-ui.helper';
  import type { AttachmentViewInfo } from './types';
  import ChatMessageAttachment from './chat-message-attachment.vue';
  import RecordingVoiceBubble from '../chat-message-recording/recording-voice-bubble.vue';
  import RecordingVideoBubble from '../chat-message-recording/recording-video-bubble.vue';

  const props = defineProps<{
    message: RegularMsgView;
    disabled?: boolean;
    isOriginDevice?: boolean;
    isMobile?: boolean;
  }>();

  const { t } = useI18n();

  /**
   * Files of a message are either all here or all on the device that sent it -
   * a message never mixes the two - so this is decided once per message rather
   * than per attachment, and shown as a single caption for the whole block.
   */
  const areAttachmentsUnavailable = computed(
    () =>
      !props.message.incomingMsgId &&
      // hasNoLocalSource is set by the phantom that synchronized this record;
      // isOriginDevice also covers records made before that flag existed.
      ((props.message.attachments ?? []).some(i => i.hasNoLocalSource) || !props.isOriginDevice),
  );

  const attachments = computed<AttachmentViewInfo[]>(() => {
    if (isEmpty(props.message.attachments)) {
      return [] as AttachmentViewInfo[];
    }

    return props.message.attachments!.map(i => {
      const lastDotPosition = i.name.lastIndexOf('.');
      const ext = getFileExtension(i.name).toLowerCase();
      const data: AttachmentViewInfo = {
        ...i,
        filename: i.name.slice(0, lastDotPosition),
        ext,
        // An incoming message keeps its files in the inbox message itself, where
        // they are looked up by name (see getFileByInfoFromMsg). Everywhere else
        // an absent id means there is no local file at all, and inventing one
        // from the name would only hide that.
        id: i.id || (props.message.incomingMsgId ? i.name : undefined),
        isActionAvailable: isActionAvailableForFile(i) || ['zip', 'pdf'].includes(ext) || i.isFolder,
      };
      return data;
    });
  });

  /**
   * A message that is a recording made in the app, and is shown as one rather
   * than as a file with a generated name.
   *
   * Not for the blocked case: playing needs a file, and there is none on this
   * device - that message keeps the chip and the caption saying why. Nor for a
   * message whose recording came without an id, which is the same thing.
   */
  const recording = computed(() => recordingOfAttachments(props.message.attachments));
  const asMediaBubble = computed(
    () => !!recording.value && !areAttachmentsUnavailable.value && !!attachments.value[0]?.id,
  );

  function isActionAvailableForFile(item: ChatMessageAttachmentsInfo) {
    const { name } = item;
    return isFileImage({ fullName: name }) || isFileVideo({ fullName: name }) || isFileAudio({ fullName: name });
  }
</script>

<template>
  <div :class="[$style.chatMessageAttachments, disabled && $style.disabled]">
    <template v-if="asMediaBubble">
      <recording-voice-bubble
        v-if="recording!.kind === 'voice'"
        :item="attachments[0]"
        :recording="recording!"
        :incoming-msg-id="message.incomingMsgId"
        :is-mobile="isMobile"
      />

      <recording-video-bubble
        v-else
        :item="attachments[0]"
        :recording="recording!"
        :chat-id="message.chatId"
        :chat-message-id="message.chatMessageId"
        :incoming-msg-id="message.incomingMsgId"
        :is-mobile="isMobile"
      />
    </template>

    <template v-else>
      <template
        v-for="(item, index) in attachments"
        :key="`${index}-${item.name}`"
      >
        <chat-message-attachment
          :item="item"
          :chat-id="message.chatId"
          :chat-message-id="message.chatMessageId"
          :incoming-msg-id="message.incomingMsgId"
          :blocked="areAttachmentsUnavailable"
        />
      </template>

      <div
        v-if="areAttachmentsUnavailable"
        :class="$style.unavailableNote"
      >
        {{ t('chat.message.attachment.only_on_sending_device') }}
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
  .chatMessageAttachments {
    position: relative;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    row-gap: var(--spacing-xs);

    &.disabled {
      opacity: 0.5;
    }
  }

  /* One caption for the whole block: the container is a stretch flex column, so
     it takes the full width and stays readable on narrow (mobile) layouts,
     instead of competing for space with a file name on the same line. */
  .unavailableNote {
    position: relative;
    font-size: var(--font-12);
    line-height: var(--font-16);
    font-weight: 400;
    color: var(--color-text-chat-bubble-user-sub);
    word-break: break-word;
  }
</style>
