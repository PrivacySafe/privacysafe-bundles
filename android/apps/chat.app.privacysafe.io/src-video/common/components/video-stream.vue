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
  import { watchEffect, useTemplateRef, onBeforeUnmount } from 'vue';
  import { makeLogger } from '@shared/logger';

  const log = makeLogger('VideoStream');

  const { stream, isStreamOwn, muted } = defineProps<{
    stream: MediaStream | Promise<MediaStream> | undefined;
    isStreamOwn?: boolean;
    muted?: boolean;
  }>();

  const emit = defineEmits<{
    (e: 'playing'): void;
    (e: 'stream-changed'): void;
    (e: 'blocked-unmuted-playback'): void;
    (e: 'unmuted'): void;
  }>();

  const videoTag = useTemplateRef<HTMLVideoElement>('video-tag');

  let removeGestureListener: (() => void) | undefined = undefined;

  function armUnmuteOnUserGesture(): void {
    if (removeGestureListener) {
      return;
    }
    const onGesture = () => {
      cleanup();
      unmute();
    };
    const cleanup = () => {
      document.removeEventListener('pointerdown', onGesture, true);
      removeGestureListener = undefined;
    };
    document.addEventListener('pointerdown', onGesture, true);
    removeGestureListener = cleanup;
  }

  /**
   * Restores the muted state intended by props after a muted-playback
   * fallback. Must be called from a user gesture context, where unmuting
   * is allowed by autoplay policies.
   */
  function unmute(): void {
    const el = videoTag.value;
    if (!el) {
      return;
    }
    el.muted = !!muted;
    if (!el.muted) {
      emit('unmuted');
    }
  }

  defineExpose({ unmute });

  onBeforeUnmount(() => removeGestureListener?.());

  async function startPlayback(el: HTMLVideoElement): Promise<void> {
    try {
      await el.play();
    } catch (err) {
      const errName = (err as DOMException)?.name;
      // AbortError means srcObject changed or the element was removed while
      // play() was pending — a newer effect run takes care of playback.
      if (errName === 'AbortError') {
        return;
      }
      // Autoplay of unmuted media can be blocked by policy (e.g. Android
      // WebView with mediaPlaybackRequiresUserGesture). Fall back to muted
      // playback so video is visible, and let a user gesture restore sound.
      if (!el.muted && (errName === 'NotAllowedError')) {
        el.muted = true;
        try {
          await el.play();
        } catch (err2) {
          log.error('Muted fallback video playback failed', err2);
          return;
        }
        emit('blocked-unmuted-playback');
        armUnmuteOnUserGesture();
      } else {
        log.error('Video playback failed to start', err);
      }
    }
  }

  watchEffect(async () => {
    if (!stream) {
      if (videoTag.value) {
        videoTag.value.srcObject = null;
      }
      emit('stream-changed');
      return;
    }

    const resolvedStream = (stream as Promise<MediaStream>).then
      ? await (stream as Promise<MediaStream>)
      : (stream as MediaStream);

    if (videoTag.value) {
      videoTag.value.muted = !!muted;
      videoTag.value.srcObject = resolvedStream;
      // The autoplay attribute alone silently does nothing when playback is
      // blocked by policy — an explicit play() surfaces the error and lets
      // us fall back to muted playback.
      void startPlayback(videoTag.value);
    }
    // A new stream (or a new resolved value of the same stream prop) means
    // playback hasn't started yet — reset the "playing" state so callers can
    // show a "stream is about to start" placeholder again until the actual
    // `playing` event fires.
    emit('stream-changed');
  });
</script>

<template>
  <video
    ref="video-tag"
    :class="[$style.video, isStreamOwn && $style.mirrorFlip]"
    playsinline
    autoplay
    :muted="muted"
    @playing="emit('playing')"
  />
</template>

<style lang="scss" module>
  .video {
    width: 100%;
    height: 100%;
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-s);
  }

  .mirrorFlip {
    transform: rotateY(180deg);
  }
</style>