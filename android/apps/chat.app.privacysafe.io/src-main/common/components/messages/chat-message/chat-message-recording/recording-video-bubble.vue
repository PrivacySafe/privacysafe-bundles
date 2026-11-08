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
  import { computed, inject, ref, useTemplateRef } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nIcon, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import type { AttachmentRecordingInfo, ChatIdObj } from '~/index';
  import { CHAT_STAGE_KEY, type ChatStage } from '@main/common/composables/useChatStage';
  import { THUMBNAIL_CACHE_KEY, type ThumbnailCache } from '@main/common/composables/useThumbnailCache';
  import { makeLogger } from '@shared/logger';
  import { useRecordingPlayer } from './useRecordingPlayer';
  import type { AttachmentViewInfo } from '../chat-message-attachments/types';

  const log = makeLogger('VideoMessage');

  /** The circle in the bubble, and the ring around it. */
  const COLLAPSED_PX = 96;
  const RING_STROKE_PX = 4;
  /** How much of the smaller side of the chat an opened circle takes. */
  const EXPANDED_FRACTION = 0.85;

  const props = defineProps<{
    item: AttachmentViewInfo;
    recording: AttachmentRecordingInfo;
    chatId: ChatIdObj;
    chatMessageId: string;
    incomingMsgId?: string;
    isMobile?: boolean;
  }>();

  const { t } = useI18n();
  const stage = inject<ChatStage>(CHAT_STAGE_KEY)!;
  const thumbnailCache = inject<ThumbnailCache>(THUMBNAIL_CACHE_KEY)!;

  const mediaEl = useTemplateRef<HTMLVideoElement>('mediaEl');
  const isExpanded = ref(false);
  const preview = ref<string | null>(null);

  const {
    isPreparing,
    isPlaying,
    isBroken,
    needsUnmute,
    remainingPercent,
    remainingText,
    toggle,
    stop,
  } = useRecordingPlayer({
    item: props.item,
    incomingMsgId: props.incomingMsgId,
    durationMs: props.recording.durationMs,
    elRef: mediaEl,
    // Whatever stopped it - a click outside, or a change of chat - closes the
    // circle with it, so there is one way back to the collapsed state.
    onStopped: () => {
      isExpanded.value = false;
    },
  });

  // The frame is put into the previews table when the message is sent and when
  // it is received, so it is here without the file being read at all.
  thumbnailCache
    .get({ chatId: props.chatId, chatMessageId: props.chatMessageId }, props.item.name)
    .then(dataUrl => {
      if (dataUrl) {
        preview.value = dataUrl;
      }
    })
    .catch(e => log.error(`Failed to read the preview of '${props.item.name}'`, e));

  const expandedPx = computed(() =>
    Math.round(EXPANDED_FRACTION * Math.min(stage.width.value, stage.height.value)),
  );
  const circlePx = computed(() => (isExpanded.value ? expandedPx.value : COLLAPSED_PX));
  /**
   * The ring is drawn on a radius of `size/2 - width/2`, so its inner edge sits
   * at exactly `circle/2` - touching the circle with neither a gap nor an
   * overlap.
   */
  const ringPx = computed(() => circlePx.value + (2 * RING_STROKE_PX));
  const slotPx = COLLAPSED_PX + (2 * RING_STROKE_PX);

  const sizeStyle = computed(() => ({
    '--recording-ring': `${ringPx.value}px`,
    '--recording-circle': `${circlePx.value}px`,
    '--recording-ring-stroke': `${RING_STROKE_PX}px`,
  }));
  const slotStyle = { '--recording-slot': `${slotPx}px` };

  const previewStyle = computed(() =>
    preview.value ? { backgroundImage: `url('${preview.value}')` } : {},
  );

  const playIconSize = computed(() => Math.min(96, Math.round(circlePx.value / 3)));

  function expand() {
    // Measured on the click as well: the observer may not have reported yet if
    // the chat has only just been laid out.
    stage.measureNow();
    if (!stage.width.value || !stage.height.value) {
      return;
    }
    isExpanded.value = true;
    toggle();
  }

  function onCircleClick() {
    if (isBroken.value) {
      return;
    }
    if (!isExpanded.value) {
      expand();
      return;
    }
    // Inside the opened circle: pause and resume, which also keeps the tap that
    // turns the sound on inside a gesture.
    toggle();
  }
</script>

<template>
  <div
    class="chat-message-attachment"
    :class="$style.slot"
    :style="slotStyle"
    @click.stop.prevent
  >
    <!-- The circle is moved onto the chat's own stage rather than re-created
         there: it is the same <video> element throughout, so opening it does
         not restart what is playing. -->
    <teleport
      :to="stage.el.value ?? 'body'"
      :disabled="!isExpanded"
    >
      <div
        v-if="isExpanded"
        :class="$style.backdrop"
        @click.stop.prevent="stop"
      />

      <div
        :class="[$style.wrap, isExpanded ? $style.wrapOnStage : $style.wrapInline]"
        :style="sizeStyle"
        @click.stop.prevent="onCircleClick"
      >
        <!-- Only around the opened circle: how much is left is something to
             know while watching, and a ring left over on a collapsed one would
             tell apart the messages that have been played and nothing more. -->
        <ui3n-progress-circular
          v-if="isExpanded && !isBroken"
          :class="$style.ring"
          :value="remainingPercent"
          :size="ringPx"
          :width="RING_STROKE_PX"
          bg-color="transparent"
        />

        <div
          :class="$style.circle"
          :style="previewStyle"
        >
          <!-- Shown only on the stage: the element covers the whole circle, and
               a collapsed one has nothing to show through it - after a stop it
               paints an empty box where the frame from the previews table
               belongs. Hidden it keeps its source and its position; being out
               of view is not what stops it. -->
          <video
            v-show="isExpanded"
            ref="mediaEl"
            playsinline
            preload="none"
            :class="$style.video"
          />

          <ui3n-progress-circular
            v-if="isPreparing"
            indeterminate
            :size="playIconSize"
          />

          <ui3n-icon
            v-else-if="isBroken"
            icon="file-remove-outline"
            :size="playIconSize"
          />

          <ui3n-icon
            v-else-if="!isPlaying"
            :class="$style.playOverlay"
            icon="round-play-arrow"
            :size="playIconSize"
            color="var(--color-icon-button-primary-default)"
          />
        </div>

        <span
          v-if="isExpanded"
          :class="$style.remaining"
        >
          {{ remainingText }}
          <template v-if="needsUnmute">· {{ t('chat.recording.hint.tap_to_unmute') }}</template>
        </span>
      </div>
    </teleport>
  </div>
</template>

<style lang="scss" module>
  /* Keeps the collapsed footprint while the circle is away on the stage, so the
     message list neither reflows nor loses its place. */
  .slot {
    position: relative;
    width: var(--recording-slot);
    height: var(--recording-slot);

    /* The bubble's content is wrapped in pointer-events: none. */
    pointer-events: all;
  }

  .wrap {
    position: relative;
    cursor: pointer;
  }

  .wrapInline {
    position: absolute;
    inset: 0;
  }

  .wrapOnStage {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: var(--recording-ring);
    height: var(--recording-ring);
    pointer-events: all;
  }

  .ring,
  .circle {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }

  .ring {
    pointer-events: none;
  }

  .circle {
    width: var(--recording-circle);
    height: var(--recording-circle);
    border-radius: 50%;
    overflow: hidden;
    background-color: var(--color-bg-chat-bubble-other-quote);
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;

    /* On top of the wrapper's overflow: hidden - a composited video layer does
       not always take an ancestor's border-radius in Chromium's WebView. */
    clip-path: circle(50% at 50% 50%);
  }

  .playOverlay {
    position: relative;
    pointer-events: none;
    filter: drop-shadow(0 1px 2px oklch(20% 0 0deg / 0.6));
  }

  /* Bottom edge level with the bottom of the circle, in the corner its curve
     leaves empty - the ring is all that is between them. */
  .remaining {
    position: absolute;
    left: 0;
    bottom: var(--recording-ring-stroke);
    font-size: var(--font-12);
    line-height: var(--font-16);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--color-text-chat-bubble-other-default);
  }

  .backdrop {
    position: absolute;
    inset: 0;
    pointer-events: all;
    background-color: oklch(20% 0 0deg / 0.45);
  }
</style>
