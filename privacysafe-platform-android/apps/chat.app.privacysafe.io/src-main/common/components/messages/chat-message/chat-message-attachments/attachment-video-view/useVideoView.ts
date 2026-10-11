/*
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
*/
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';
import { timeInSecondsToString } from '@main/common/utils/chat-ui.helper';
import { usePlayableAttachment } from '@main/common/composables/usePlayableAttachment';
import type { AttachmentVideoViewEmits } from './attachment-video-view.vue';

export function useVideoView(
  { item, incomingMsgId, emits }:
  { item: AttachmentViewInfo; incomingMsgId?: string; emits: AttachmentVideoViewEmits }
) {
  const videoPlayerRef = useTemplateRef<HTMLVideoElement>('videoEl');
  const isProcessing = ref(true);
  const isPlaying = ref(false);
  const duration = ref(0);
  const currentTime = ref(0);
  const volume = ref(50);

  const {
    isLoading,
    percent,
    progress,
    isStreaming,
    seekableStart,
    seekableEnd,
    noteBuffered,
    attachTo,
    cancel,
  } = usePlayableAttachment({
    item,
    incomingMsgId,
    onMissing: () => {
      isProcessing.value = false;
      emits('error');
    },
    onUnplayable: () => {
      isProcessing.value = false;
      emits('unplayable');
    },
  });

  /**
   * How far the slider may go. While streaming that is what has arrived: the
   * rest of the file is not in the SourceBuffer yet, and seeking into it lands
   * on nothing.
   */
  const seekMax = computed(() => (isStreaming.value ? seekableEnd.value : duration.value));

  const durationAsText = computed(() => timeInSecondsToString(duration.value));
  const currentTimeAsText = computed(() => timeInSecondsToString(currentTime.value));

  /**
   * Until endOfStream() a MediaSource-backed element reports an infinite
   * duration, and timeInSecondsToString turns that into 'Infinity:NaN:NaN'.
   */
  function readDuration() {
    const el = videoPlayerRef.value;
    return el && Number.isFinite(el.duration) ? el.duration : 0;
  }

  /**
   * With an open MediaSource 'canplaythrough' may never fire at all - the
   * browser cannot promise uninterrupted playback of a stream it is still being
   * fed - so the overlay is taken down by 'canplay' as well. Without it the
   * loading overlay stays over a file that is already playing, with every
   * control disabled.
   */
  function onCanplay() {
    isProcessing.value = false;
    duration.value = readDuration();
  }

  function onDurationchange() {
    duration.value = readDuration();
  }

  function onTimeupdate(event: Event) {
    const el = event.target as HTMLVideoElement;
    currentTime.value = el.currentTime;
    // Appends make 'progress' fire irregularly, and a slider whose maximum lags
    // behind the buffer refuses to move into what is already playable.
    noteBuffered(el);
  }

  function onProgress(event: Event) {
    noteBuffered(event.target as HTMLVideoElement);
  }

  function onEnded() {
    isPlaying.value = false;
    // Back to the start of what can be played, not to a hard 0: should Chromium
    // have dropped the head of the buffer, seeking to 0 lands outside it and the
    // element stalls waiting for data that will never be appended.
    currentTime.value = seekableStart.value;
    videoPlayerRef.value!.currentTime = seekableStart.value;
  }

  function play() {
    videoPlayerRef.value!.play();
    isPlaying.value = true;
  }

  function pause() {
    videoPlayerRef.value!.pause();
    isPlaying.value = false;
  }

  function updateVolume(val: number | [number, number]) {
    if (!Array.isArray(val)) {
      volume.value = val;
      videoPlayerRef.value!.volume = (val || 0) / 100;
    }
  }

  function updateCurrentTime(val: number | [number, number]) {
    if (!Array.isArray(val)) {
      const capped = Math.max(seekableStart.value, Math.min(val, seekMax.value || val));
      currentTime.value = capped;
      videoPlayerRef.value!.currentTime = capped;
    }
  }

  onMounted(() => {
    videoPlayerRef.value!.currentTime = 0;
    videoPlayerRef.value!.volume = volume.value / 100;

    videoPlayerRef.value!.addEventListener('canplay', onCanplay);
    videoPlayerRef.value!.addEventListener('canplaythrough', onCanplay);
    videoPlayerRef.value!.addEventListener('durationchange', onDurationchange);
    videoPlayerRef.value!.addEventListener('timeupdate', onTimeupdate);
    videoPlayerRef.value!.addEventListener('progress', onProgress);
    videoPlayerRef.value!.addEventListener('ended', onEnded);

    // Deliberately not awaited: playback is meant to begin while the read goes
    // on behind it.
    attachTo(videoPlayerRef.value!);
  });

  onBeforeUnmount(() => {
    videoPlayerRef.value!.removeEventListener('canplay', onCanplay);
    videoPlayerRef.value!.removeEventListener('canplaythrough', onCanplay);
    videoPlayerRef.value!.removeEventListener('durationchange', onDurationchange);
    videoPlayerRef.value!.removeEventListener('timeupdate', onTimeupdate);
    videoPlayerRef.value!.removeEventListener('progress', onProgress);
    videoPlayerRef.value!.removeEventListener('ended', onEnded);
  });

  return {
    isProcessing,
    isPlaying,
    videoPlayerRef,
    currentTime,
    duration,
    seekMax,
    volume,
    currentTimeAsText,
    durationAsText,
    isLoading,
    percent,
    progress,
    isStreaming,
    updateVolume,
    updateCurrentTime,
    play,
    pause,
    cancel,
  };
}
