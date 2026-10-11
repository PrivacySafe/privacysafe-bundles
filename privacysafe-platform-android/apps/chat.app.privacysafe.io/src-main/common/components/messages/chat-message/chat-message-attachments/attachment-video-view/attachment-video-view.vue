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
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nIcon, Ui3nSlider, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';
  import { timeInSecondsToString } from '@main/common/utils/chat-ui.helper';
  import AttachmentLoading from '../attachment-loading.vue';
  import { useVideoView } from './useVideoView';

  export interface AttachmentVideoViewEmits {
    (event: 'error'): void;
    (event: 'cancel'): void;
    (event: 'unplayable'): void;
  }

  const props = defineProps<{
    item: AttachmentViewInfo;
    incomingMsgId?: string;
    isMobileMode?: boolean;
  }>();
  const emits = defineEmits<AttachmentVideoViewEmits>();

  const { t } = useI18n();

  const {
    isProcessing,
    isPlaying,
    videoPlayerRef,
    currentTime,
    seekMax,
    volume,
    currentTimeAsText,
    durationAsText,
    isLoading,
    percent,
    progress,
    updateVolume,
    updateCurrentTime,
    play,
    pause,
    cancel,
  } = useVideoView({ item: props.item, incomingMsgId: props.incomingMsgId, emits });

  /**
   * Cancelling is not an error: the 'error' path shows "the file may have been
   * deleted or moved", which about a read the user stopped themselves is simply
   * untrue.
   */
  function onCancel() {
    cancel();
    emits('cancel');
  }
</script>

<template>
  <div :class="[$style.videoView, isMobileMode && $style.mobile]">
    <video
      ref="videoEl"
      :class="$style.videoPlayer"
    />

    <div :class="$style.videoPlayerControl">
      <div :class="$style.videoPlayerControlBody">
        <div :class="$style.videoPlayerControlActionsAdditional">
          <ui3n-icon icon="round-volume-mute" />

          <div :class="$style.volume">
            <ui3n-slider
              v-if="videoPlayerRef"
              :model-value="volume"
              :transform-value-method="(val: number) => `${val}%`"
              :disabled="isProcessing || !videoPlayerRef?.src"
              @update:model-value="updateVolume"
            />
          </div>

          <ui3n-icon
            icon="round-volume-up"
            size="18"
          />
        </div>

        <div :class="$style.videoPlayerControlActions">
          <ui3n-tooltip
            :content="t('chat.viewer.tooltip.play')"
            placement="top-end"
            position-strategy="fixed"
          >
            <ui3n-button
              type="icon"
              icon="round-play-arrow"
              icon-size="24"
              :disabled="isPlaying || isProcessing || !videoPlayerRef?.src"
              @click.stop.prevent="play"
            />
          </ui3n-tooltip>

          <ui3n-tooltip
            :content="t('chat.viewer.tooltip.pause')"
            placement="top-end"
            position-strategy="fixed"
          >
            <ui3n-button
              type="icon"
              icon="round-pause"
              icon-size="24"
              :disabled="isProcessing || !videoPlayerRef?.src"
              @click.stop.prevent="pause"
            />
          </ui3n-tooltip>
        </div>

        <div :class="$style.videoPlayerControlActionsAdditional" />
      </div>

      <div :class="$style.videoPlayerControlBody">
        <div :class="$style.videoPlayerTime">
          {{ currentTimeAsText }}
        </div>

        <ui3n-slider
          v-if="videoPlayerRef"
          :max="seekMax"
          :model-value="currentTime"
          :transform-value-method="timeInSecondsToString"
          :disabled="isProcessing || !videoPlayerRef?.src"
          @update:model-value="updateCurrentTime"
        />

        <div :class="[$style.videoPlayerTime, $style.right]">
          {{ durationAsText }}
        </div>
      </div>
    </div>

    <attachment-loading
      v-if="isProcessing"
      :reading="isLoading"
      :percent="percent"
      :progress="progress"
      @cancel="onCancel"
    />
  </div>
</template>

<style lang="scss" module>
  .videoView {
    --video-view-padding: 48px 16px 104px 16px;
    --video-player-control-height: 64px;

    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--video-view-padding);

    &.mobile {
      .videoPlayerControlActionsAdditional {
        width: 108px;
      }
    }
  }

  .videoPlayer {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .videoPlayerControl {
    position: absolute;
    left: 0;
    bottom: 24px;
    width: 100%;
    height: var(--audio-panel-height);
    padding: 0 var(--spacing-m);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .videoPlayerControlBody {
    display: flex;
    width: 100%;
    height: 32px;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .videoPlayerTime {
    position: relative;
    width: 72px;
    font-size: var(--font-18);
    font-weight: 500;
    color: var(--color-text-block-primary-default);
    text-align: left;

    &.right {
      text-align: right;
    }
  }

  .videoPlayerControlActions,
  .videoPlayerControlActionsAdditional {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .videoPlayerControlActionsAdditional {
    width: 140px;

    span {
      font-size: var(--font-12);
    }
  }

  .volume {
    flex-grow: 1;
    display: flex;
    justify-content: center;
    align-items: center;
  }

</style>
