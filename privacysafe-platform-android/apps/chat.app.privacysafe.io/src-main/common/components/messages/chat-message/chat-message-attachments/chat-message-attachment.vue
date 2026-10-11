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
  import { computed, inject, ref } from 'vue';
  import { isFileAudio, isFileImage, isFileVideo } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nButton, Ui3nIcon, Ui3nProgressCircular, Ui3nTooltip, type Nullable } from '@v1nt1248/3nclient-lib';
  import type { ChatIdObj, Task } from '~/index';
  import { createThumbnail } from '@main/common/utils/create-thumbnail';
  import { recordingLabelKey, timeInSecondsToString } from '@main/common/utils/chat-ui.helper';
  import { THUMBNAIL_AUTO_PREVIEW_LIMIT } from '@shared/constants/attachment-limits';
  import { THUMBNAIL_CACHE_KEY, type ThumbnailCache } from '@main/common/composables/useThumbnailCache';
  import { useOpenAttachment } from './useOpenAttachment';
  import type { AttachmentViewInfo } from './types';
  import ChatMessageAttachmentView from './chat-message-attachment-view.vue';
  import { makeLogger } from '@shared/logger';

  const log = makeLogger('MsgAttachment');

  import { useI18n } from 'vue-i18n';

  const props = defineProps<{
    item: AttachmentViewInfo;
    chatId: ChatIdObj;
    chatMessageId: string;
    incomingMsgId?: string;
    /**
     * Whether this message's files live only on the device that sent it. Decided
     * once per message by the container (chat-message-attachments.vue), which
     * also shows the single caption explaining it.
     */
    blocked?: boolean;
  }>();

  const { t } = useI18n();
  const { addTask } = inject('task-runner') as { addTask: (task: Task) => void };
  const thumbnailCache = inject<ThumbnailCache>(THUMBNAIL_CACHE_KEY)!;

  const { openEntity } = useOpenAttachment(props);

  const thumbnail = ref<Nullable<string>>(null);
  const isThumbnailCreationProcessGoingOn = ref(false);
  const isViewOpen = ref(false);

  const attachmentsItemPreviewSize = 96;
  const attachmentsItemPreviewSizeCss = computed(() => `${attachmentsItemPreviewSize}px`);

  const unavailableTooltip = computed(() =>
    props.blocked ? t('chat.message.attachment.not_available_on_this_device') : '',
  );

  /**
   * A recording is attached under a generated name, so it is named by what it
   * is and measured in seconds rather than in bytes. Driven by the marker and
   * not by the extension: an audio file someone attached is not a voice
   * message.
   *
   * Still reached, although a recording of its own is shown as a player now:
   * this is what a message whose files are only on the sending device falls
   * back to, and what the history's messages of "a recording plus other files"
   * - which the composer used to allow - are shown as.
   */
  const recordingLabel = computed(() =>
    props.item.recording ? t(recordingLabelKey(props.item.recording.kind)) : '',
  );
  const recordingDuration = computed(() =>
    props.item.recording
      ? timeInSecondsToString(Math.round(props.item.recording.durationMs / 1000))
      : '',
  );

  const isThumbnailAvailable = computed(
    () =>
      (isFileImage({ fullName: props.item.name }) ||
        isFileVideo({ fullName: props.item.name }) ||
        props.item.ext === 'pdf') &&
      !!props.item.size,
  );
  const previewStyle = computed(() => {
    if (!isThumbnailAvailable.value || !thumbnail.value) {
      return {};
    }

    return {
      backgroundImage: `url('${thumbnail.value}')`,
    };
  });

  async function onAttachmentElementClick() {
    if (props.blocked) {
      return;
    }

    if (props.item.isActionAvailable) {
      isViewOpen.value = true;
      return;
    }

    if (!props.incomingMsgId) {
      await openEntity();
    }
  }

  /**
   * Whether the user is offered a button to make this preview.
   *
   * Making one needs the whole file, and an attachment of an incoming message is
   * not on this device until something reads it - so a big one waits to be asked
   * for, instead of a chat with ten photos pulling all ten from the server the
   * moment it opens.
   */
  const isPreviewOnDemand = computed(
    () =>
      isThumbnailAvailable.value &&
      !props.blocked &&
      !thumbnail.value &&
      !isThumbnailCreationProcessGoingOn.value &&
      (props.item.size ?? 0) > THUMBNAIL_AUTO_PREVIEW_LIMIT,
  );

  function msgId() {
    return { chatId: props.chatId, chatMessageId: props.chatMessageId };
  }

  async function makeThumbnailTask() {
    try {
      const dataUrl = await createThumbnail({
        fileName: props.item.name,
        fileId: props.item.id,
        incomingMsgId: props.incomingMsgId,
      });
      thumbnail.value = dataUrl;
      if (dataUrl) {
        // Kept, so that scrolling this message back into view - or opening the
        // chat again tomorrow - does not read the file once more.
        thumbnailCache.put(msgId(), props.item.name, dataUrl);
      }
    } catch (e) {
      log.error(`The thumbnail making error for the file ${props.item.name}.`, e);
    } finally {
      isThumbnailCreationProcessGoingOn.value = false;
    }
  }

  function makeThumbnail() {
    if (!isThumbnailAvailable.value || props.blocked) {
      return;
    }

    isThumbnailCreationProcessGoingOn.value = true;
    addTask(makeThumbnailTask);
  }

  async function showThumbnail() {
    if (!isThumbnailAvailable.value || props.blocked) {
      return;
    }

    // Held up front, over the cache lookup as well: without it the square shows
    // the "cannot be read" mark for as long as the lookup takes.
    isThumbnailCreationProcessGoingOn.value = true;
    // The cheapest case of all: a preview made before is shown without the file
    // being read at all.
    const cached = await thumbnailCache.get(msgId(), props.item.name).catch(() => undefined);
    isThumbnailCreationProcessGoingOn.value = false;

    if (cached) {
      thumbnail.value = cached;
      return;
    }

    if ((props.item.size ?? 0) <= THUMBNAIL_AUTO_PREVIEW_LIMIT) {
      makeThumbnail();
    }
  }

  showThumbnail();
</script>

<template>
  <div
    :class="[
      'chat-message-attachment',
      $style.chatMessageAttachment,
      item.isActionAvailable && $style.chatMessageAttachmentClickable,
      blocked && $style.chatMessageAttachmentBlocked,
      item.recording && $style.chatMessageAttachmentRecording,
    ]"
    :title="unavailableTooltip"
    @click.stop.prevent="onAttachmentElementClick"
  >
    <div
      v-if="isThumbnailAvailable && !blocked"
      :class="$style.previewWrap"
    >
      <div
        :class="$style.preview"
        :style="previewStyle"
      >
        <ui3n-progress-circular
          v-if="isThumbnailCreationProcessGoingOn"
          indeterminate
          :size="(attachmentsItemPreviewSize / 4) * 3"
        />

        <!-- A big file's preview is not made until asked for, so an empty square
             here means "not yet", not "the file is gone". -->
        <ui3n-tooltip
          v-else-if="isPreviewOnDemand"
          :content="t('chat.message.attachment.make_preview')"
          placement="top"
          position-strategy="fixed"
          max-content-width="180"
        >
          <ui3n-button
            type="icon"
            icon="outline-image"
            icon-size="32"
            @click.stop.prevent="makeThumbnail"
          />
        </ui3n-tooltip>

        <ui3n-icon
          v-else-if="!thumbnail"
          icon="file-remove-outline"
          :size="(attachmentsItemPreviewSize / 5) * 4"
        />

        <!-- Over the frame of a video message, so that a still frame is not
             mistaken for a picture. -->
        <ui3n-icon
          v-if="item.recording && thumbnail"
          :class="$style.playOverlay"
          icon="round-play-arrow"
          :size="attachmentsItemPreviewSize / 2"
          color="var(--color-icon-button-primary-default)"
        />
      </div>
    </div>

    <div
      v-else
      :class="$style.icon"
    >
      <ui3n-icon
        v-if="blocked"
        icon="cloud-lock"
        :size="attachmentsItemPreviewSize"
      />

      <ui3n-icon
        v-else-if="isFileAudio({ fullName: item.name })"
        icon="sound-wave-circle"
        :size="attachmentsItemPreviewSize"
      />

      <ui3n-icon
        v-else-if="item.isFolder"
        icon="round-folder"
        :size="attachmentsItemPreviewSize"
      />

      <ui3n-icon
        v-else-if="item.ext === 'zip'"
        icon="file-zip"
        :size="attachmentsItemPreviewSize"
      />

      <ui3n-icon
        v-else
        :class="$style.icon"
        icon="round-attach-file"
        :size="attachmentsItemPreviewSize"
      />
    </div>

    <div :class="$style.chatMessageAttachmentName">
      {{ item.recording ? recordingLabel : (item.isFolder ? item.name : item.filename) }}
    </div>

    <!-- Duration where an ordinary attachment shows its extension: seconds are
         what one wants to know about a recording, and the container it happens
         to be in is not. -->
    <div
      v-if="item.recording"
      :class="$style.chatMessageAttachmentDuration"
    >
      {{ recordingDuration }}
    </div>

    <div
      v-else-if="!item.isFolder"
      :class="$style.chatMessageAttachmentExt"
    >
      .{{ item.ext }}
    </div>

    <teleport to="body">
      <chat-message-attachment-view
        v-if="isViewOpen && !blocked"
        :item="item"
        :incoming-msg-id="incomingMsgId"
        @close="isViewOpen = false"
      />
    </teleport>
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/mixins' as mixins;

  .chatMessageAttachment {
    --attachments-item-min-height: 20px;
    --attachments-item-preview-size: v-bind(attachmentsItemPreviewSizeCss);

    position: relative;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: 6px;
    min-height: var(--attachments-item-min-height);
    font-size: var(--font-14);
    font-weight: 400;
    color: var(--color-text-chat-bubble-user-default);

    //&.chatMessageAttachmentClickable {
    pointer-events: all;

    &:hover {
      color: var(--color-text-chat-bubble-user-sub);

      :global(.ui3n-icon) {
        --ui3n-icon-color: var(--color-icon-chat-bubble-user-quote);
      }
    }
    //}
  }

  .previewWrap {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
  }

  .preview {
    position: relative;
    min-width: var(--attachments-item-preview-size);
    width: var(--attachments-item-preview-size);
    height: var(--attachments-item-preview-size);
    border-radius: var(--spacing-xs);
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .icon {
    position: relative;
  }

  .chatMessageAttachmentName {
    position: relative;
    height: var(--attachments-item-height);
    text-align: left;
    flex-shrink: 1;
    line-height: var(--font-20);
    @include mixins.text-overflow-ellipsis();
  }

  .chatMessageAttachmentExt {
    flex-shrink: 0;
    line-height: var(--font-20);
  }

  .chatMessageAttachmentDuration {
    flex-shrink: 0;
    line-height: var(--font-20);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-chat-bubble-other-sub);
  }

  /* Enough to say "this was recorded here" without inventing a second kind of
     bubble: the accent edge plus the label and the duration in place of a file
     name and an extension. */
  .chatMessageAttachmentRecording {
    border-left: 2px solid var(--color-icon-block-accent-default);
  }

  .playOverlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    filter: drop-shadow(0 1px 2px oklch(20% 0 0deg / 0.6));
  }

  .chatMessageAttachmentBlocked {
    pointer-events: none;
    cursor: default;
    opacity: 0.5;
  }
</style>
