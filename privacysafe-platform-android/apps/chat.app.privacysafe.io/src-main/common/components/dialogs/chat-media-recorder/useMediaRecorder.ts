/*
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
*/
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { timeInSecondsToString } from '@main/common/utils/chat-ui.helper';
import { makeLogger } from '@shared/logger';
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_MILLIS,
  RECORDING_PREVIEW_JPEG_QUALITY,
  RECORDING_PREVIEW_SIZE,
  RECORDING_TIMESLICE_MILLIS,
  VIDEO_AUDIO_BITS_PER_SECOND,
  VIDEO_RECORDING_FRAME_SIZE,
  VIDEO_VIDEO_BITS_PER_SECOND,
  VOICE_AUDIO_BITS_PER_SECOND,
  type RecordingKind,
} from '@shared/constants/media-recording';
import { extensionForRecordingMime, pickRecordingMime } from '@shared/media-recording-format';

const log = makeLogger('MediaRecorder');

/** Why a recording stopped, so that the user can be told which limit it was. */
export type RecordingStopReason = 'user' | 'duration' | 'size';

export interface MediaRecordingResult {
  kind: RecordingKind;
  blob: Blob;
  mimeType: string;
  ext: string;
  durationMs: number;
  /** Data URL of a frame; only a video recording has one. */
  preview?: string;
  stoppedBy: RecordingStopReason;
}

/** What went wrong, in terms the dialog can turn into one sentence. */
export type RecordingFailure = 'access_denied' | 'no_device' | 'device_busy' | 'unsupported' | 'failed';

export type RecordingStage = 'choice' | 'preparing' | 'recording' | 'finishing' | 'review';

function failureOf(err: unknown): RecordingFailure {
  const name = (err as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'access_denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no_device';
    case 'NotReadableError':
    case 'AbortError':
      return 'device_busy';
    default:
      return 'failed';
  }
}

export function useMediaRecorder({
  onFailure,
}: {
  onFailure: (failure: RecordingFailure) => void;
}) {
  const stage = ref<RecordingStage>('choice');
  const kind = ref<RecordingKind | null>(null);
  const elapsedMs = ref(0);
  const recordedBytes = ref(0);

  /** Held in shallowRef: none of these want their internals made reactive. */
  const stream = shallowRef<MediaStream | null>(null);
  const recorder = shallowRef<MediaRecorder | null>(null);
  const analyser = shallowRef<AnalyserNode | null>(null);

  let audioContext: AudioContext | null = null;
  let chunks: Blob[] = [];
  let ticker: ReturnType<typeof setInterval> | undefined;
  let startedAt = 0;
  let cancelled = false;
  let stopReason: RecordingStopReason = 'user';
  /** Set while the video element is on screen, so a frame can be grabbed. */
  let videoEl: HTMLVideoElement | null = null;
  let settle: ((result: MediaRecordingResult | undefined) => void) | undefined;

  const limitMs = computed(() => (kind.value ? MAX_RECORDING_MILLIS[kind.value] : 0));
  const limitBytes = computed(() => (kind.value ? MAX_RECORDING_BYTES[kind.value] : 0));

  const elapsedAsText = computed(() => timeInSecondsToString(Math.floor(elapsedMs.value / 1000)));
  const limitAsText = computed(() => timeInSecondsToString(Math.floor(limitMs.value / 1000)));

  /**
   * How full the recording is, as the nearer of the two limits.
   *
   * Both are shown by one bar rather than two: whichever fills first is the one
   * that will stop the recording, and that is the only thing the bar has to say.
   */
  const usedPercent = computed(() => {
    if (!kind.value) {
      return 0;
    }
    const byTime = elapsedMs.value / limitMs.value;
    const bySize = recordedBytes.value / limitBytes.value;
    return Math.min(100, Math.round(Math.max(byTime, bySize) * 100));
  });

  function constraintsFor(k: RecordingKind): MediaStreamConstraints {
    return k === 'voice'
      ? { audio: true }
      : {
          audio: true,
          video: {
            width: { ideal: VIDEO_RECORDING_FRAME_SIZE },
            height: { ideal: VIDEO_RECORDING_FRAME_SIZE },
          },
        };
  }

  function bitratesFor(k: RecordingKind): MediaRecorderOptions {
    return k === 'voice'
      ? { audioBitsPerSecond: VOICE_AUDIO_BITS_PER_SECOND }
      : {
          audioBitsPerSecond: VIDEO_AUDIO_BITS_PER_SECOND,
          videoBitsPerSecond: VIDEO_VIDEO_BITS_PER_SECOND,
        };
  }

  /**
   * Wires the analyser for the level meter.
   *
   * Note what is missing next to what useAudioView does: the analyser is NOT
   * connected to `audioContext.destination`. There the source is a media
   * element being played; here it is the microphone, and putting it through to
   * the speakers gives acoustic feedback.
   */
  function attachAnalyser(src: MediaStream): void {
    try {
      audioContext = new AudioContext();
      // A context can come up suspended, and a suspended one processes nothing -
      // the meter would sit flat while the recording went on perfectly well.
      // Same call, for the same reason, as in useAudioView.play().
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(e => log.error('Failed to resume the audio context', e));
      }
      const node = audioContext.createAnalyser();
      node.smoothingTimeConstant = 0.7;
      node.fftSize = 256;
      audioContext.createMediaStreamSource(src).connect(node);
      analyser.value = node;
    } catch (err) {
      // A missing level meter is not a reason to refuse a recording.
      log.error('Failed to set up the level meter', err);
      analyser.value = null;
    }
  }

  /** The element showing the camera, so that a preview frame can be taken. */
  function useVideoElement(el: HTMLVideoElement | null): void {
    videoEl = el;
  }

  /**
   * A frame of the recording, as a small JPEG data URL.
   *
   * Taken from the live element rather than made from the file afterwards:
   * createVideoThumbnail() seeks to the fifth second, and a video message can
   * be shorter than that.
   */
  function grabPreview(): string | undefined {
    const el = videoEl;
    if (!el || !el.videoWidth || !el.videoHeight) {
      return undefined;
    }
    try {
      const scale = RECORDING_PREVIEW_SIZE / Math.max(el.videoWidth, el.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(el.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(el.videoHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return undefined;
      }
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', RECORDING_PREVIEW_JPEG_QUALITY);
    } catch (err) {
      log.error('Failed to take a preview frame of the recording', err);
      return undefined;
    }
  }

  /**
   * Asks for the device and starts recording.
   *
   * The stream is asked for here and not when the dialog opens: the device
   * indicator should not light up while the user is still reading what the
   * dialog offers, and a refusal this way belongs unambiguously to an action
   * they took.
   *
   * @returns a promise of the recording, resolving to undefined when it was
   * cancelled or could not be made.
   */
  async function start(k: RecordingKind): Promise<MediaRecordingResult | undefined> {
    kind.value = k;
    stage.value = 'preparing';
    cancelled = false;
    stopReason = 'user';
    chunks = [];
    recordedBytes.value = 0;
    elapsedMs.value = 0;

    let mediaStream: MediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(constraintsFor(k));
    } catch (err) {
      log.error(`Failed to get a ${k} stream`, err);
      reset();
      onFailure(failureOf(err));
      return undefined;
    }
    stream.value = mediaStream;

    const mime = pickRecordingMime(k, m => MediaRecorder.isTypeSupported(m));
    let rec: MediaRecorder;
    try {
      // No mimeType at all when nothing on the list is supported: the recorder's
      // own default is a better answer than refusing to record.
      rec = new MediaRecorder(mediaStream, { ...bitratesFor(k), ...(mime && { mimeType: mime }) });
    } catch (err) {
      log.error('MediaRecorder refused the stream', err);
      teardown();
      reset();
      onFailure('unsupported');
      return undefined;
    }
    recorder.value = rec;

    // Only for a voice note: a video recording shows the camera, so an audio
    // context there would be a second one open for nothing to look at.
    if (k === 'voice') {
      attachAnalyser(mediaStream);
    }

    const finished = new Promise<MediaRecordingResult | undefined>(resolve => {
      settle = resolve;
    });

    rec.ondataavailable = ev => {
      if (ev.data.size === 0) {
        return;
      }
      chunks.push(ev.data);
      recordedBytes.value += ev.data.size;
      // The size limit is checked here, where the size actually becomes known:
      // a nominal bitrate is a target the encoder aims at, not a promise, so
      // the duration limit alone cannot keep a recording inside the size that
      // can still be played progressively.
      if (recordedBytes.value >= limitBytes.value) {
        stop('size');
      }
    };

    rec.onerror = ev => {
      log.error('Recording failed', (ev as unknown as { error?: unknown }).error);
      cancelled = true;
      stop('user');
      onFailure('failed');
    };

    rec.onstop = () => {
      const durationMs = elapsedMs.value;
      const mimeType = rec.mimeType || mime || '';
      const preview = (k === 'video' && !cancelled) ? grabPreview() : undefined;
      const blob = cancelled ? undefined : new Blob(chunks, mimeType ? { type: mimeType } : undefined);

      teardown();
      const result: MediaRecordingResult | undefined = blob
        ? {
            kind: k,
            blob,
            mimeType,
            ext: extensionForRecordingMime(k, mimeType),
            durationMs,
            ...(preview && { preview }),
            stoppedBy: stopReason,
          }
        : undefined;
      recorder.value = null;
      // A recording that came out is handed to the review stage rather than
      // straight out of the dialog: it is sent as soon as it is approved, so
      // the approval is the only chance to hear it first. Putting the stage
      // back to 'choice' instead would flash the choice screen on the way out
      // of a cancelled recording.
      if (result) {
        stage.value = 'review';
      }
      settle?.(result);
      settle = undefined;
    };

    startedAt = performance.now();
    // A timeslice, so that chunks - and with them the running size - arrive as
    // the recording goes on rather than only at the end.
    rec.start(RECORDING_TIMESLICE_MILLIS);
    stage.value = 'recording';

    ticker = setInterval(() => {
      // Off the clock rather than by counting ticks: a counted tick drifts, and
      // over fifteen minutes the drift is visible.
      elapsedMs.value = performance.now() - startedAt;
      if (elapsedMs.value >= limitMs.value) {
        stop('duration');
      }
    }, 100);

    return await finished;
  }

  function stop(reason: RecordingStopReason = 'user'): void {
    const rec = recorder.value;
    if (!rec || rec.state === 'inactive') {
      return;
    }
    stopReason = reason;
    stage.value = 'finishing';
    // The final elapsed value is taken here, not in onstop: onstop runs after
    // the last chunk is flushed, which is measurably later.
    elapsedMs.value = performance.now() - startedAt;
    stopTicker();
    rec.stop();
  }

  /** Throws the recording away. Nothing is handed up. */
  function cancel(): void {
    cancelled = true;
    if (recorder.value && recorder.value.state !== 'inactive') {
      stop('user');
      return;
    }
    teardown();
    reset();
    settle?.(undefined);
    settle = undefined;
  }

  function stopTicker(): void {
    if (ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
  }

  /**
   * Lets go of the device. The one place that does, so that closing the dialog,
   * cancelling and finishing cannot each get it a little bit wrong.
   */
  function teardown(): void {
    stopTicker();
    try {
      stream.value?.getTracks().forEach(t => t.stop());
    } catch (err) {
      log.error('Failed to stop the recording tracks', err);
    }
    stream.value = null;
    analyser.value = null;
    audioContext?.close().catch(err => log.error('Failed to close the audio context', err));
    audioContext = null;
    chunks = [];
  }

  function reset(): void {
    recorder.value = null;
    stage.value = 'choice';
    kind.value = null;
  }

  onBeforeUnmount(() => {
    // Closing the dialog mid-recording must not leave the microphone or the
    // camera running, and must not hand a recording nobody asked for upwards.
    cancelled = true;
    teardown();
    settle?.(undefined);
    settle = undefined;
  });

  return {
    stage,
    kind,
    stream,
    analyser,
    elapsedMs,
    elapsedAsText,
    limitAsText,
    usedPercent,
    recordedBytes,

    useVideoElement,
    start,
    stop,
    cancel,
    resetToChoice: reset,
  };
}
