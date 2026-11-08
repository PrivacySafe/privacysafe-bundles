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

/** Stops whatever recording is playing right now. */
export type StopPlayback = () => void;

export interface RecordingPlayback {
  /**
   * Becomes the one recording that is playing, stopping whoever was.
   */
  claim(stop: StopPlayback): void;
  /** Forgets this stopper, if it is the current one. */
  release(stop: StopPlayback): void;
  /** Stops whatever is playing. */
  stopCurrent(): void;
}

export const RECORDING_PLAYBACK_KEY = 'recording-playback';

/**
 * Which recording of a chat is playing - one at a time, and stoppable from
 * outside the bubble that plays it.
 *
 * There has to be something like this, because taking a media element out of
 * the DOM does not stop it: Chromium goes on playing an element with no parent
 * until it is collected. Switching to another chat replaces the message list,
 * unmounting the bubbles, and a voice message would be heard over the next
 * chat - hence an explicit stop from the view's own route guard.
 *
 * Created by the chat view, so it holds exactly the recordings of the chat that
 * is open.
 */
export function useRecordingPlayback(): RecordingPlayback {
  let current: StopPlayback | undefined = undefined;

  function claim(stop: StopPlayback): void {
    const previous = current;
    // Called before the new holder is written down: stopping the previous one
    // synchronously calls release(), which must not clear the new claim.
    if (previous && (previous !== stop)) {
      previous();
    }
    current = stop;
  }

  function release(stop: StopPlayback): void {
    if (current === stop) {
      current = undefined;
    }
  }

  function stopCurrent(): void {
    const stop = current;
    current = undefined;
    stop?.();
  }

  return { claim, release, stopCurrent };
}
