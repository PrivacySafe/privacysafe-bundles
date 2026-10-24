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
import { onMounted, shallowRef, ref, useTemplateRef, computed, onBeforeUnmount } from 'vue';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';
import { timeInSecondsToString } from '@main/common/utils/chat-ui.helper';
import { usePlayableAttachment } from '@main/common/composables/usePlayableAttachment';
import type { AttachmentAudioViewEmits } from './attachment-audio-view.vue';
import { makeLogger } from '@shared/logger';

const log = makeLogger('AudioView');

export function useAudioView(
  { item, incomingMsgId, emits }:
  { item: AttachmentViewInfo; incomingMsgId?: string; emits: AttachmentAudioViewEmits},
) {
  const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasEl');
  const ctx = ref<Nullable<CanvasRenderingContext2D>>(null);

  const audioContext = new AudioContext();
  const source = shallowRef<Nullable<MediaElementAudioSourceNode>>(null);
  const analyser = audioContext.createAnalyser();
  analyser.smoothingTimeConstant = 0.7;
  analyser.fftSize = 256;
  const frequencyData = shallowRef(new Uint8Array(analyser.frequencyBinCount));

  const audioPlayerRef = useTemplateRef<HTMLAudioElement>('audioEl');

  const isProcessing = ref(true);
  const isPlaying = ref(false);
  const duration = ref(0);
  const currentTime = ref(0);
  const volume = ref(50);

  const currentAudioVisualization = ref(1);

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

  let requestAnimation: number;

  /**
   * Until endOfStream() a MediaSource-backed element reports an infinite
   * duration, and timeInSecondsToString turns that into 'Infinity:NaN:NaN'.
   */
  function readDuration() {
    const el = audioPlayerRef.value;
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
    const el = event.target as HTMLAudioElement;
    currentTime.value = el.currentTime;
    // Appends make 'progress' fire irregularly, and a slider whose maximum lags
    // behind the buffer refuses to move into what is already playable.
    noteBuffered(el);
  }

  function onProgress(event: Event) {
    noteBuffered(event.target as HTMLAudioElement);
  }

  function onEnded() {
    isPlaying.value = false;
    // Back to the start of what can be played, not to a hard 0: should Chromium
    // have dropped the head of the buffer, seeking to 0 lands outside it and the
    // element stalls waiting for data that will never be appended.
    currentTime.value = seekableStart.value;
    audioPlayerRef.value!.currentTime = seekableStart.value;
  }

  function play() {
    // A context made without a user gesture starts suspended. It used to be
    // unnoticeable behind the wait for the whole file; with playback starting
    // on the first chunks there is nothing left to hide it.
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(e => log.error('Failed to resume the audio context', e));
    }
    requestAnimation = window.requestAnimationFrame(render);
    audioPlayerRef.value!.play();
    isPlaying.value = true;
  }

  function pause() {
    window.cancelAnimationFrame(requestAnimation);
    audioPlayerRef.value!.pause();
    isPlaying.value = false;
  }

  function updateVolume(val: number | [number, number]) {
    if (!Array.isArray(val)) {
      volume.value = val;
      audioPlayerRef.value!.volume = (val || 0) / 100;
    }
  }

  function updateCurrentTime(val: number | [number, number]) {
    if (!Array.isArray(val)) {
      const capped = Math.max(seekableStart.value, Math.min(val, seekMax.value || val));
      currentTime.value = capped;
      audioPlayerRef.value!.currentTime = capped;
    }
  }

  /* audio visualization */

  function render() {
    switch (currentAudioVisualization.value) {
      case 1:
        render1();
        break;
      case 2:
        render2();
        break;
      default:
        log.error('Unknown audio visualization');
        break;
    }
  }

  /* variant 1 */
  const columnsGap = 1;

  function drawColumn(x: number, width: number, height: number) {
    const gradient = ctx.value!.createLinearGradient(
      0, canvasRef.value!.height - height / 2, 0, canvasRef.value!.height,
    );
    gradient.addColorStop(1, '#20639b');
    gradient.addColorStop(0.2, '#f6d55c');
    gradient.addColorStop(0, '#ed553b');
    ctx.value!.fillStyle = gradient;
    ctx.value!.fillRect(x, canvasRef.value!.height - height / 2, width, height);
  }

  function render1() {
    if (!canvasRef.value) {
      return;
    }

    const { width, height } = canvasRef.value;
    const frequencyDataSize = analyser.fftSize;

    analyser.getByteFrequencyData(frequencyData.value);
    ctx.value!.clearRect(0, 0, width, height);
    const columnWidth = (width * 1.0) / ( frequencyDataSize * 0.5);
    const heightScale = height / 100;

    let xPos = 0;
    for (const i of frequencyData.value) {
      const columnHeight = i * heightScale;
      drawColumn(xPos, columnWidth - columnsGap, columnHeight * 0.75);
      xPos += columnWidth;
    }

    requestAnimation = window.requestAnimationFrame(render);
  }

  /* variant 2 */
  function render2() {
    if (!canvasRef.value) {
      return;
    }

    const bufferLength = analyser.fftSize;
    const { width, height } = canvasRef.value;
    ctx.value!.clearRect(0, 0, width, height);

    function draw2() {
      requestAnimation = window.requestAnimationFrame(draw2);
      analyser.getByteTimeDomainData(frequencyData.value);

      ctx.value!.clearRect(0, 0, width, height);
      ctx.value!.lineWidth = 3;
      ctx.value!.strokeStyle = '#20639b';
      ctx.value!.beginPath();

      const sliceWidth = (width * 1.0) / (bufferLength * 0.5);
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = frequencyData.value[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
          ctx.value!.moveTo(x, y);
        } else {
          ctx.value!.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.value!.lineTo(width, height / 2);
      ctx.value!.stroke();
    }

    draw2();
  }

  onMounted(() => {
    canvasRef.value!.width = canvasRef.value!.clientWidth;
    canvasRef.value!.height = canvasRef.value!.clientHeight;
    ctx.value = canvasRef.value!.getContext('2d');

    audioPlayerRef.value!.currentTime = 0;
    audioPlayerRef.value!.volume = volume.value / 100;

    audioPlayerRef.value!.addEventListener('canplay', onCanplay);
    audioPlayerRef.value!.addEventListener('canplaythrough', onCanplay);
    audioPlayerRef.value!.addEventListener('durationchange', onDurationchange);
    audioPlayerRef.value!.addEventListener('timeupdate', onTimeupdate);
    audioPlayerRef.value!.addEventListener('progress', onProgress);
    audioPlayerRef.value!.addEventListener('ended', onEnded);

    // Bound to the element, not to what it plays, so it survives the change of
    // src that the fall back from streaming makes.
    source.value = audioContext.createMediaElementSource(audioPlayerRef.value!);
    source.value!.connect(analyser);
    analyser.connect(audioContext.destination);

    // Deliberately not awaited: playback is meant to begin while the read goes
    // on behind it.
    attachTo(audioPlayerRef.value!);
  });

  onBeforeUnmount(() => {
    audioPlayerRef.value!.removeEventListener('canplay', onCanplay);
    audioPlayerRef.value!.removeEventListener('canplaythrough', onCanplay);
    audioPlayerRef.value!.removeEventListener('durationchange', onDurationchange);
    audioPlayerRef.value!.removeEventListener('timeupdate', onTimeupdate);
    audioPlayerRef.value!.removeEventListener('progress', onProgress);
    audioPlayerRef.value!.removeEventListener('ended', onEnded);
    window.cancelAnimationFrame(requestAnimation);
    // A browser allows only so many audio contexts, and one was made per open
    // of this viewer and never closed.
    audioContext.close().catch(e => log.error('Failed to close the audio context', e));
  });

  return {
    isProcessing,
    isPlaying,
    canvasRef,
    audioPlayerRef,
    duration,
    durationAsText,
    seekMax,
    volume,
    currentTime,
    currentTimeAsText,
    currentAudioVisualization,
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
