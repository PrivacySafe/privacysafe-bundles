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
  import { watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import {
    Ui3nButton,
    Ui3nIcon,
    Ui3nSlider,
    Ui3nSwitch,
    Ui3nTooltip,
  } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@main/common/store/app.store';
  import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';
  import { timeInSecondsToString } from '@main/common/utils/chat-ui.helper';
  import AttachmentLoading from '../attachment-loading.vue';
  import { useAudioView } from './useAudioView';

  export interface AttachmentAudioViewEmits {
    (event: 'error'): void;
    (event: 'cancel'): void;
    (event: 'unplayable'): void;
  }

  const props = defineProps<{
    item: AttachmentViewInfo;
    incomingMsgId?: string;
    isMobileMode?: boolean;
  }>();
  const emits = defineEmits<AttachmentAudioViewEmits>();

  const { t } = useI18n();

  const { appWindowSize } = storeToRefs(useAppStore());

  const {
    isProcessing,
    isPlaying,
    canvasRef,
    audioPlayerRef,
    durationAsText,
    seekMax,
    volume,
    currentTime,
    currentTimeAsText,
    currentAudioVisualization,
    isLoading,
    percent,
    progress,
    updateVolume,
    updateCurrentTime,
    play,
    pause,
    cancel,
  } = useAudioView({ item: props.item, incomingMsgId: props.incomingMsgId, emits });

  /**
   * Cancelling is not an error: the 'error' path shows "the file may have been
   * deleted or moved", which about a read the user stopped themselves is simply
   * untrue.
   */
  function onCancel() {
    cancel();
    emits('cancel');
  }

  watch(appWindowSize, () => {
    canvasRef.value!.width = canvasRef.value!.clientWidth;
    canvasRef.value!.height = canvasRef.value!.clientHeight;
  });
</script>

<template>
  <div :class="$style.audioView">
    <audio
      ref="audioEl"
      :class="$style.audioPlayerHidden"
    />

    <canvas
      ref="canvasEl"
      :class="$style.canvas"
    />

    <div :class="$style.audioPlayer">
      <div :class="$style.audioPlayerBody">
        <div :class="$style.audioPlayerActionsAdditional">
          <ui3n-icon icon="round-volume-mute" />

          <div :class="$style.volume">
            <ui3n-slider
              v-if="audioPlayerRef"
              :model-value="volume"
              :transform-value-method="(val: number) => `${val}%`"
              :disabled="isProcessing || !audioPlayerRef?.src"
              @update:model-value="updateVolume"
            />
          </div>

          <ui3n-icon
            icon="round-volume-up"
            size="18"
          />
        </div>

        <div :class="$style.audioPlayerActions">
          <ui3n-tooltip
            :content="t('chat.viewer.tooltip.play')"
            placement="top-end"
            position-strategy="fixed"
          >
            <ui3n-button
              type="icon"
              icon="round-play-arrow"
              icon-size="24"
              :disabled="isPlaying || isProcessing || !audioPlayerRef?.src"
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
              :disabled="isProcessing || !audioPlayerRef?.src"
              @click.stop.prevent="pause"
            />
          </ui3n-tooltip>
        </div>

        <div :class="$style.audioPlayerActionsAdditional">
          <span>{{ t('chat.viewer.visualization.mode2') }}</span>

          <ui3n-tooltip
            :content="t('chat.viewer.tooltip.visual_setting')"
            placement="top"
            position-strategy="fixed"
          >
            <ui3n-switch
              :model-value="currentAudioVisualization === 1"
              size="16"
              :disabled="isPlaying || isProcessing || !audioPlayerRef?.src"
              @change="v => (currentAudioVisualization = v ? 1 : 2)"
            />
          </ui3n-tooltip>

          <span>{{ t('chat.viewer.visualization.mode1') }}</span>
        </div>
      </div>

      <div :class="$style.audioPlayerBody">
        <div :class="$style.audioPlayerTime">
          {{ currentTimeAsText }}
        </div>

        <ui3n-slider
          v-if="audioPlayerRef"
          :max="seekMax"
          :model-value="currentTime"
          :transform-value-method="timeInSecondsToString"
          :disabled="isProcessing || !audioPlayerRef?.src"
          @update:model-value="updateCurrentTime"
        />

        <div :class="[$style.audioPlayerTime, $style.right]">
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
  .audioView {
    --audio-view-padding: 48px 16px 104px 16px;
    --audio-player-height: 64px;

    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--audio-view-padding);
  }

  .audioPlayerHidden {
    position: absolute;
    visibility: hidden;
    top: -100px;
  }

  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .audioPlayer {
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

  .audioPlayerBody {
    display: flex;
    width: 100%;
    height: 32px;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .audioPlayerTime {
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

  .audioPlayerActions,
  .audioPlayerActionsAdditional {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .audioPlayerActionsAdditional {
    width: 140px;
    color: var(--color-text-block-primary-default);

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
