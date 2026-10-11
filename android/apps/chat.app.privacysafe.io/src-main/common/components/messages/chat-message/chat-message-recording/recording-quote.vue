<!--
 Copyright (C) 2026 3NSoft Inc.

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
  import { useI18n } from 'vue-i18n';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import type { AttachmentRecordingInfo, ChatMessageId } from '~/index';
  import { recordingExcerpt } from '@main/common/utils/chat-ui.helper';
  import { THUMBNAIL_CACHE_KEY, type ThumbnailCache } from '@main/common/composables/useThumbnailCache';
  import { makeLogger } from '@shared/logger';

  const log = makeLogger('RecordingQuote');

  /** Small enough to sit on one line of a quote. */
  const PREVIEW_PX = 32;

  const props = defineProps<{
    /** The message being quoted - the previews are kept under its id. */
    msgId: ChatMessageId;
    attachmentName: string;
    recording: AttachmentRecordingInfo;
  }>();

  const { t } = useI18n();
  const thumbnailCache = inject<ThumbnailCache>(THUMBNAIL_CACHE_KEY)!;

  const preview = ref<string | null>(null);

  // Only a video message has a frame, and it is in the previews table under the
  // quoted message's own id - so the quote costs no file read.
  if (props.recording.kind === 'video') {
    thumbnailCache
      .get(props.msgId, props.attachmentName)
      .then(dataUrl => {
        if (dataUrl) {
          preview.value = dataUrl;
        }
      })
      .catch(e => log.error(`Failed to read the preview of '${props.attachmentName}'`, e));
  }

  const excerpt = computed(() => recordingExcerpt(props.recording, t));

  const previewStyle = computed(() => ({
    '--recording-quote-size': `${PREVIEW_PX}px`,
    ...(preview.value && { backgroundImage: `url('${preview.value}')` }),
  }));
</script>

<template>
  <div :class="$style.quote">
    <div
      :class="[$style.thumb, recording.kind === 'video' && $style.thumbRound]"
      :style="previewStyle"
    >
      <ui3n-icon
        v-if="!preview"
        :icon="recording.kind === 'voice' ? 'round-mic' : 'round-play-arrow'"
        size="20"
        color="var(--color-icon-block-accent-default)"
      />
    </div>

    <span :class="$style.text">{{ excerpt }}</span>
  </div>
</template>

<style lang="scss" module>
  .quote {
    position: relative;
    display: flex;
    align-items: center;
    column-gap: var(--spacing-xs);
    min-width: 0;
  }

  .thumb {
    position: relative;
    flex-shrink: 0;
    width: var(--recording-quote-size);
    height: var(--recording-quote-size);
    border-radius: var(--spacing-xs);
    background-color: var(--color-bg-block-primary-default);
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
    display: flex;
    justify-content: center;
    align-items: center;

    /* A video message is a circle wherever it is shown. */
    &.thumbRound {
      border-radius: 50%;
    }
  }

  .text {
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
