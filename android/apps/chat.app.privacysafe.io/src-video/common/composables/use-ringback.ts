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

import { watch, type Ref } from 'vue';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { Sound } from '@shared/sounds';

/**
 * The caller hears the same ringtone as the person being called, only quieter:
 * it is a "still ringing over there" cue, not an alert.
 */
const RINGBACK_VOLUME = 0.5;

/**
 * Plays the ringtone on the caller's side for as long as `shouldRing` holds.
 *
 * Loading the sound is asynchronous, and the call may be answered (or the
 * window closed) while it loads; the generation counter is what keeps such a
 * late load from starting a ringtone nobody will ever stop.
 */
export function useRingback(shouldRing: Readonly<Ref<boolean>>) {
  let ring: Nullable<Sound> = null;
  let generation = 0;

  async function startRingback(): Promise<void> {
    const myGeneration = ++generation;
    const ringFileUrl = new URL('@main/common/assets/sounds/ring_tone.mp3', import.meta.url).href;
    const sound = await Sound.from(ringFileUrl);
    if (myGeneration !== generation || !shouldRing.value) {
      return;
    }
    ring = sound;
    ring.setVolume(RINGBACK_VOLUME);
    // Autoplay with sound can be refused (Android WebView without a user
    // gesture): the call goes on silently then, which is no reason to fail it.
    await ring.playInLoop();
  }

  function stopRingback(): void {
    generation += 1;
    if (ring) {
      ring.stop();
      ring = null;
    }
  }

  watch(
    shouldRing,
    flag => {
      if (flag) {
        if (!ring) {
          startRingback().catch(err => {
            console.warn('[useRingback] Failed to play the ringtone for the caller:', err);
          });
        }
      } else {
        stopRingback();
      }
    },
    { immediate: true },
  );

  return { stopRingback };
}
