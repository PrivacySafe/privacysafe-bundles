<!--
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
  import { computed, onBeforeUnmount, ref, useTemplateRef, watch, watchEffect } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import VideoPlaceholder from '@video/common/components/video-placeholder.vue';
  import VideoStream from '@video/common/components/video-stream.vue';
  import HostBadge from '@video/common/components/host-badge.vue';
  import { makeLogger } from '@shared/logger';

  const log = makeLogger('PeerVideo');

  const props = defineProps<{
    peerName: string;
    peerAddr: string;
    stream: MediaStream | Promise<MediaStream> | undefined;
    isVideoOn: boolean;
    isAudioOn: boolean;
    isReconnecting?: boolean;
    /** This tile is the call host's camera. */
    isHost?: boolean;
    styleClass?: string | (string | Record<string, boolean>)[] | Record<string, boolean>;
    size?: 'normal' | 'small';
  }>();

  const { t } = useI18n();

  const isAudioOnly = computed(() => !props.isVideoOn && props.isAudioOn);

  const mainStyle = computed(() => ({
    '--peer-icon-wrap-size': props.size === 'small' ? '20px' : '30px',
  }));

  /**
   * Whether the video stream has actually started rendering frames
   * (the `playing` event fired on the underlying <video> tag).
   * Reset to false whenever the stream reference changes, so a newly
   * assigned stream shows the "about to start" placeholder again until
   * playback actually begins.
   */
  const isStreamPlaying = ref(false);

  watch(
    () => props.stream,
    () => {
      isStreamPlaying.value = false;
    },
  );

  const showStreamStartingHint = computed(() => props.isVideoOn && !!props.stream && !isStreamPlaying.value);

  const videoStream = useTemplateRef<InstanceType<typeof VideoStream>>('video-stream');

  /**
   * True while peer's video plays with a muted fallback because the autoplay
   * policy blocked unmuted playback (e.g. Android WebView). Shows a
   * "tap to enable sound" overlay; any user gesture restores sound.
   */
  const isSoundBlocked = ref(false);

  function unmutePeerVideo(): void {
    videoStream.value?.unmute();
  }

  let audio: HTMLAudioElement | undefined = undefined;
  let removeAudioGestureListener: (() => void) | undefined = undefined;

  function armAudioPlayOnUserGesture(): void {
    if (removeAudioGestureListener) {
      return;
    }
    const onGesture = () => {
      cleanup();
      audio?.play().catch(err => log.error(`Peer audio playback failed after user gesture`, err));
    };
    const cleanup = () => {
      document.removeEventListener('pointerdown', onGesture, true);
      removeAudioGestureListener = undefined;
    };
    document.addEventListener('pointerdown', onGesture, true);
    removeAudioGestureListener = cleanup;
  }

  const onAudioOnlyEffect = watchEffect(() => {
    const currentStream = props.stream as MediaStream | undefined;
    if (isAudioOnly.value && currentStream) {
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
      }
      if (audio.srcObject !== currentStream) {
        audio.srcObject = currentStream;
        // Autoplay of sound can be blocked by policy (e.g. Android WebView);
        // an explicit play() surfaces this, and a user gesture retries it.
        audio.play().catch(err => {
          if ((err as DOMException)?.name === 'NotAllowedError') {
            armAudioPlayOnUserGesture();
          } else if ((err as DOMException)?.name !== 'AbortError') {
            log.error(`Peer audio playback failed to start`, err);
          }
        });
      }
    } else {
      if (audio) {
        audio.srcObject = null;
        audio = undefined;
      }
      removeAudioGestureListener?.();
    }
  });

  onBeforeUnmount(() => {
    onAudioOnlyEffect.stop();
    removeAudioGestureListener?.();
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio = undefined;
    }
  });
</script>

<template>
  <div
    :class="$style.peerVideo"
    :style="mainStyle"
  >
    <video-stream
      v-if="isVideoOn"
      ref="video-stream"
      :stream="stream"
      @playing="isStreamPlaying = true"
      @stream-changed="isStreamPlaying = false"
      @blocked-unmuted-playback="isSoundBlocked = true"
      @unmuted="isSoundBlocked = false"
    />

    <video-placeholder
      v-else
      :user-name="peerName"
      :width="size === 'small' ? 72 : 144"
    />

    <div
      v-if="isReconnecting"
      :class="$style.reconnectingOverlay"
    >
      <span>{{ t('call.text.participant_reconnecting', { user: peerName }) }}</span>
    </div>

    <div
      v-if="showStreamStartingHint"
      :class="$style.streamStarting"
    >
      {{ t('call.text.stream_about_to_start', { user: peerName }) }}
    </div>

    <div
      v-if="isSoundBlocked"
      :class="$style.tapToUnmute"
      @click.stop="unmutePeerVideo"
    >
      <ui3n-icon
        icon="round-volume-off"
        color="var(--info-content-default)"
        :width="16"
        :height="16"
      />
      {{ t('call.text.tap_to_unmute') }}
    </div>

    <host-badge
      v-if="isHost"
      :size="size"
    />

    <div
      v-if="!isAudioOn"
      :class="$style.micOff"
    >
      <ui3n-icon
        icon="round-mic-off"
        color="var(--color-icon-chat-bubble-other-selected)"
        :width="size === 'small' ? 16 : 24"
        :height="size === 'small' ? 16 : 24"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .peerVideo {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-s);
  }

  .micOff {
    position: absolute;
    right: calc(var(--peer-icon-wrap-size) / 4);
    top: calc(var(--peer-icon-wrap-size) / 4);
    width: var(--peer-icon-wrap-size);
    height: var(--peer-icon-wrap-size);
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: var(--color-bg-block-tritery-default);
  }

  .streamStarting {
    position: absolute;
    left: 50%;
    bottom: var(--spacing-s);
    transform: translateX(-50%);
    max-width: calc(100% - 2 * var(--spacing-s));
    padding: var(--spacing-s) var(--spacing-m);
    border-radius: var(--spacing-s);
    background-color: var(--info-fill-default);
    color: var(--info-content-default);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    box-shadow:
      0 0 16px 0 var(--shadow-key-1),
      0 0 4px 0 var(--shadow-key-2);
  }

  .tapToUnmute {
    position: absolute;
    left: 50%;
    top: var(--spacing-s);
    transform: translateX(-50%);
    max-width: calc(100% - 2 * var(--spacing-s));
    padding: var(--spacing-s) var(--spacing-m);
    border-radius: var(--spacing-s);
    display: flex;
    align-items: center;
    column-gap: var(--spacing-xs);
    background-color: var(--info-fill-default);
    color: var(--info-content-default);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    box-shadow:
      0 0 16px 0 var(--shadow-key-1),
      0 0 4px 0 var(--shadow-key-2);
  }

  .reconnectingOverlay {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: var(--spacing-m);
    background-color: var(--shadow-back);
    backdrop-filter: blur(2px);
    text-align: center;
    pointer-events: none;

    span {
      max-width: 100%;
      padding: var(--spacing-s) var(--spacing-m);
      border-radius: var(--spacing-s);
      background-color: var(--info-fill-default);
      color: var(--info-content-default);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
</style>
