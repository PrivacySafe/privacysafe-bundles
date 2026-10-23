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
import { computed, inject, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { timeInSecondsToString } from '@common/utils';
import { usePlayableAttachment } from '@common/composables/usePlayableAttachment';
import type { AttachmentInfo } from '@common/types';

export function useVideoView({ item, incomingMsgId }: { item: AttachmentInfo; incomingMsgId?: string }) {
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const { t } = useI18n();

  const videoPlayerRef = useTemplateRef<HTMLVideoElement>('videoEl');
  const isPlaying = ref(false);
  const duration = ref(0);
  const currentTime = ref(0);
  const volume = ref(50);

  /** Not ready to be played yet, whether or not the whole file has arrived. */
  const isProcessing = ref(true);

  const { isLoading, percent, progress, isStreaming, seekableEnd, attachTo, cancel, noteBuffered } =
    usePlayableAttachment({
      item,
      incomingMsgId,
      onMissing: () => {
        isProcessing.value = false;
        $createNotice({ type: 'error', content: t('chat.view.load.file.error') });
      },
    });

  const durationAsText = computed(() => timeInSecondsToString(duration.value));
  const currentTimeAsText = computed(() => timeInSecondsToString(currentTime.value));

  function onCanplay() {
    isProcessing.value = false;
    duration.value = videoPlayerRef.value!.duration;
  }

  function onCanplaythrough() {
    isProcessing.value = false;
    duration.value = videoPlayerRef.value!.duration;
  }

  function onDurationchange() {
    duration.value = videoPlayerRef.value!.duration;
  }

  function onProgressEvent() {
    noteBuffered(videoPlayerRef.value!);
  }

  function onTimeupdate(event: Event) {
    currentTime.value = (event.target as HTMLVideoElement).currentTime;
  }

  function onEnded() {
    isPlaying.value = false;
    currentTime.value = 0;
    videoPlayerRef.value!.currentTime = 0;
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

  /** Playback cannot go past what has arrived while streaming. */
  const seekMax = computed(() => (isStreaming.value ? seekableEnd.value : duration.value));

  function updateCurrentTime(val: number | [number, number]) {
    if (!Array.isArray(val)) {
      const target = Math.min(val, seekMax.value || val);
      currentTime.value = target;
      videoPlayerRef.value!.currentTime = target;
    }
  }

  onMounted(() => {
    videoPlayerRef.value!.currentTime = 0;
    videoPlayerRef.value!.volume = volume.value / 100;

    videoPlayerRef.value!.addEventListener('canplay', onCanplay);
    videoPlayerRef.value!.addEventListener('canplaythrough', onCanplaythrough);
    videoPlayerRef.value!.addEventListener('durationchange', onDurationchange);
    videoPlayerRef.value!.addEventListener('progress', onProgressEvent);
    videoPlayerRef.value!.addEventListener('timeupdate', onTimeupdate);
    videoPlayerRef.value!.addEventListener('ended', onEnded);

    // Straight away: the setTimeout that used to be here delayed the whole read
    // by 100 ms and nothing depended on it.
    attachTo(videoPlayerRef.value!);
  });

  onBeforeUnmount(() => {
    videoPlayerRef.value!.removeEventListener('canplay', onCanplay);
    videoPlayerRef.value!.removeEventListener('canplaythrough', onCanplaythrough);
    videoPlayerRef.value!.removeEventListener('durationchange', onDurationchange);
    videoPlayerRef.value!.removeEventListener('progress', onProgressEvent);
    videoPlayerRef.value!.removeEventListener('timeupdate', onTimeupdate);
    // Was addEventListener, so the handler was added a second time instead of
    // being taken off.
    videoPlayerRef.value!.removeEventListener('ended', onEnded);
  });

  return {
    isProcessing,
    isLoading,
    percent,
    progress,
    isStreaming,
    seekMax,
    isPlaying,
    videoPlayerRef,
    currentTime,
    duration,
    volume,
    currentTimeAsText,
    durationAsText,
    t,
    cancel,
    updateVolume,
    updateCurrentTime,
    play,
    pause,
  };
}
