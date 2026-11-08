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
import { computed, inject, onBeforeUnmount, onMounted, ref, type ShallowRef } from 'vue';
import { timeInSecondsToString } from '@main/common/utils/chat-ui.helper';
import { usePlayableAttachment } from '@main/common/composables/usePlayableAttachment';
import {
  RECORDING_PLAYBACK_KEY,
  type RecordingPlayback,
} from '@main/common/composables/useRecordingPlayback';
import { makeLogger } from '@shared/logger';
import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';

const log = makeLogger('RecordingPlayer');

/**
 * Playing a recording inside its own message bubble.
 *
 * Everything about getting the bytes to the element is usePlayableAttachment's:
 * the progressive source, the fallback to a full read, the progress and the
 * object URLs. What is here is what a bubble needs and a viewer does not - one
 * button instead of a control panel, a source that is not touched until the
 * user asks for it, and a playback that something outside can stop.
 *
 * Deliberately not useAudioView: that one opens an AudioContext for its
 * visualiser, and ten voice messages in a chat would open ten of them.
 */
export function useRecordingPlayer<T extends HTMLMediaElement>({
  item,
  incomingMsgId,
  durationMs,
  elRef,
  onStopped,
}: {
  item: AttachmentViewInfo;
  incomingMsgId?: string;
  /** From the recording's own marker; the element cannot be asked for it. */
  durationMs: number;
  elRef: Readonly<ShallowRef<T | null>>;
  /** Playback ended by a stop, rather than by reaching the end. */
  onStopped?: () => void;
}) {
  const playback = inject<RecordingPlayback>(RECORDING_PLAYBACK_KEY)!;

  /** Asked to play, nothing coming out of the element yet. */
  const isPreparing = ref(false);
  const isPlaying = ref(false);
  /** The file has been opened at least once. */
  const hasStarted = ref(false);
  /** Nothing to play: no file, or bytes the element will not have. */
  const isBroken = ref(false);
  /** Playing without sound, because an unmuted start was refused. */
  const needsUnmute = ref(false);
  const currentTime = ref(0);

  const {
    isLoading,
    percent,
    progress,
    seekableStart,
    noteBuffered,
    attachTo,
  } = usePlayableAttachment({
    item,
    incomingMsgId,
    onMissing: () => {
      isPreparing.value = false;
      isBroken.value = true;
    },
    onUnplayable: () => {
      isPreparing.value = false;
      isBroken.value = true;
    },
  });

  const durationSec = durationMs / 1000;

  const playedPercent = computed(() =>
    (durationSec > 0) ? Math.min(100, Math.round((currentTime.value / durationSec) * 100)) : 0,
  );
  const remainingPercent = computed(() => 100 - playedPercent.value);

  const durationText = computed(() => timeInSecondsToString(Math.round(durationSec)));
  const elapsedText = computed(() => timeInSecondsToString(Math.floor(currentTime.value)));
  const remainingText = computed(() =>
    timeInSecondsToString(Math.max(0, Math.ceil(durationSec - currentTime.value))),
  );

  /**
   * Asks the element to play, coming down to a muted playback where an unmuted
   * one is refused.
   *
   * Android's WebView refuses unmuted playback outside a user gesture, and by
   * the time a source has been attached the gesture is over. Muted is better
   * than silent-and-still, and the next tap - a gesture of its own - can turn
   * the sound on.
   */
  async function tryPlay(el: T): Promise<void> {
    try {
      await el.play();
    } catch (err) {
      if ((err as { name?: string }).name === 'NotAllowedError') {
        el.muted = true;
        needsUnmute.value = true;
        try {
          await el.play();
          return;
        } catch (mutedErr) {
          log.info(`Even a muted playback of '${item.name}' was refused`, mutedErr);
          el.autoplay = false;
          isPreparing.value = false;
          return;
        }
      }
      // Everything else is a source that is not ready yet - the swap from a
      // failed stream to a full read is the usual one. `autoplay` is left on
      // deliberately: it is what starts the element once a source is there.
      log.info(`Playback of '${item.name}' did not start yet`, err);
    }
  }

  function toggle(): void {
    const el = elRef.value;
    if (!el || isBroken.value) {
      return;
    }

    // Inside a gesture, so the sound can be turned on without the element being
    // paused for it.
    if (needsUnmute.value) {
      needsUnmute.value = false;
      el.muted = false;
      if (el.paused) {
        tryPlay(el);
      }
      return;
    }

    if (isPlaying.value) {
      pause();
      return;
    }

    playback.claim(stop);
    el.muted = false;
    el.autoplay = true;
    isPreparing.value = true;

    if (!hasStarted.value) {
      hasStarted.value = true;
      // The file is opened here and nowhere earlier: a chat of voice messages
      // must not read them all on the way past. attachTo() sets the source
      // asynchronously, which is why `autoplay` rather than play() starts this
      // one - and why it is not awaited: it only resolves once the whole file
      // has been handed over.
      attachTo(el);
      return;
    }

    tryPlay(el);
  }

  function pause(): void {
    const el = elRef.value;
    if (el) {
      // Cleared, or the swap of a source would bring playback back.
      el.autoplay = false;
      el.pause();
    }
    isPlaying.value = false;
    isPreparing.value = false;
    playback.release(stop);
  }

  function rewind(): void {
    const el = elRef.value;
    // Back to the start of what can be played, not to a hard 0: should the head
    // of the buffer have been dropped, 0 lands outside it.
    currentTime.value = seekableStart.value;
    if (el && (el.readyState > 0)) {
      try {
        el.currentTime = seekableStart.value;
      } catch (err) {
        log.info(`Could not rewind '${item.name}'`, err);
      }
    }
  }

  function stop(): void {
    pause();
    rewind();
    onStopped?.();
  }

  function onPlay(): void {
    isPlaying.value = true;
    isPreparing.value = false;
  }

  function onPause(): void {
    isPlaying.value = false;
  }

  function onCanplay(): void {
    const el = elRef.value;
    if (el && el.autoplay && el.paused) {
      // A second chance for the start that could not be made when the source
      // was not there yet.
      tryPlay(el);
    }
  }

  function onTimeupdate(event: Event): void {
    const el = event.target as T;
    currentTime.value = el.currentTime;
    noteBuffered(el);
  }

  function onProgress(event: Event): void {
    noteBuffered(event.target as T);
  }

  function onEnded(): void {
    const el = elRef.value;
    if (el) {
      el.autoplay = false;
    }
    isPlaying.value = false;
    isPreparing.value = false;
    playback.release(stop);
    rewind();
  }

  const events: [string, EventListener][] = [
    ['play', onPlay],
    ['playing', onPlay],
    ['pause', onPause],
    ['canplay', onCanplay],
    ['timeupdate', onTimeupdate as EventListener],
    ['progress', onProgress as EventListener],
    ['ended', onEnded],
  ];

  onMounted(() => {
    const el = elRef.value;
    if (!el) {
      return;
    }
    for (const [name, handler] of events) {
      el.addEventListener(name, handler);
    }
  });

  onBeforeUnmount(() => {
    const el = elRef.value;
    if (el) {
      for (const [name, handler] of events) {
        el.removeEventListener(name, handler);
      }
      // An element out of the DOM goes on playing until it is collected, so
      // going away has to say so explicitly.
      el.autoplay = false;
      el.pause();
    }
    playback.release(stop);
  });

  return {
    isPreparing,
    isPlaying,
    hasStarted,
    isBroken,
    needsUnmute,
    currentTime,
    playedPercent,
    remainingPercent,
    durationText,
    elapsedText,
    remainingText,
    isLoading,
    percent,
    progress,
    toggle,
    pause,
    stop,
  };
}
