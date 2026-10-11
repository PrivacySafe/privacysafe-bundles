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
  import { computed, useTemplateRef } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nProgressLinear, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import type { AttachmentRecordingInfo } from '~/index';
  import { useRecordingPlayer } from './useRecordingPlayer';
  import type { AttachmentViewInfo } from '../chat-message-attachments/types';

  const props = defineProps<{
    item: AttachmentViewInfo;
    recording: AttachmentRecordingInfo;
    incomingMsgId?: string;
    /** A bigger button, for a finger rather than a pointer. */
    isMobile?: boolean;
  }>();

  const { t } = useI18n();

  const mediaEl = useTemplateRef<HTMLAudioElement>('mediaEl');

  const {
    isPreparing,
    isPlaying,
    isBroken,
    needsUnmute,
    currentTime,
    playedPercent,
    durationText,
    remainingText,
    toggle,
  } = useRecordingPlayer({
    item: props.item,
    incomingMsgId: props.incomingMsgId,
    durationMs: props.recording.durationMs,
    elRef: mediaEl,
  });

  // What is left to listen to while it plays, the whole length otherwise:
  // standing at the start - before the first play, or after one that ran to the
  // end - the length is what one wants to know. The same reading as the ring of
  // a video message. Not remainingText at rest as well: it rounds up, and the
  // length has to read the same here as on the chip and in a quote.
  const timeText = computed(() =>
    (isPlaying.value || (currentTime.value > 0)) ? remainingText.value : durationText.value,
  );

  const buttonTooltip = computed(() => t(isPlaying.value ? 'chat.viewer.tooltip.pause' : 'chat.viewer.tooltip.play'));
</script>

<template>
  <div
    class="chat-message-attachment"
    :class="[$style.voiceBubble, isMobile && $style.voiceBubbleMobile]"
    @click.stop.prevent
  >
    <ui3n-tooltip
      :content="buttonTooltip"
      :disabled="isMobile"
      placement="top"
      position-strategy="fixed"
    >
      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        :size="isMobile ? 'large' : 'regular'"
        :icon="isPlaying ? 'round-pause' : 'round-play-arrow'"
        :icon-size="isMobile ? 28 : 20"
        icon-color="var(--color-icon-block-accent-default)"
        :disabled="isBroken"
        @click.stop.prevent="toggle"
      />
    </ui3n-tooltip>

    <div :class="$style.body">
      <div
        v-if="isBroken"
        :class="$style.error"
      >
        {{ t('chat.viewer.error.cannot_play') }}
      </div>

      <template v-else>
        <div :class="$style.track">
          <ui3n-progress-linear
            :class="$style.line"
            :value="playedPercent"
            :height="4"
            :indeterminate="isPreparing"
          />

          <span :class="$style.time">{{ timeText }}</span>
        </div>

        <span
          v-if="needsUnmute"
          :class="$style.muted"
        >
          {{ t('chat.recording.hint.tap_to_unmute') }}
        </span>
      </template>
    </div>

    <!-- No source until the button is pressed: usePlayableAttachment gives it
         one then, and not a moment earlier. -->
    <audio
      ref="mediaEl"
      preload="none"
      :class="$style.media"
    />
  </div>
</template>

<style lang="scss" module>
  .voiceBubble {
    position: relative;

    /* The bubble's content is wrapped in pointer-events: none, and the button
       has to be reachable. */
    pointer-events: all;
    display: flex;
    align-items: center;
    column-gap: var(--spacing-s);
    min-width: 180px;

    &.voiceBubbleMobile {
      min-width: 200px;
      column-gap: var(--spacing-sm, 12px);
    }
  }

  .body {
    position: relative;
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-xs);
  }

  /* The time sits on the line's own row rather than under it: two rows made the
     bubble taller than the button that plays it. */
  .track {
    display: flex;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .line {
    flex-grow: 1;
    min-width: 0;
  }

  .time {
    flex-shrink: 0;
    font-size: var(--font-12);
    line-height: var(--font-14);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-chat-bubble-other-sub);
  }

  .muted {
    font-size: var(--font-11);
    line-height: var(--font-14);
    font-style: italic;
    color: var(--color-text-chat-bubble-other-sub);
  }

  .error {
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--error-content-default);
  }

  .media {
    display: none;
  }
</style>
