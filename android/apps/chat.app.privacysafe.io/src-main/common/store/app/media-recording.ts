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

import { computed, ref } from 'vue';
import { toRO } from '@main/common/utils/readonly.ts';
import { probeRecordingSupport } from '@main/common/utils/media-recording-support.ts';

/**
 * Whether this device can record a voice note or a video message.
 *
 * Answered once at start-up, which is what gates the button in the composer,
 * and again whenever the set of devices changes - plugging a headset in should
 * not need a restart to be noticed.
 */
export function useMediaRecordingSupport() {
  const canRecordAudio = ref(false);
  const canRecordVideo = ref(false);

  const canRecord = computed(() => canRecordAudio.value || canRecordVideo.value);

  async function refresh(): Promise<void> {
    const { audio, video } = await probeRecordingSupport();
    canRecordAudio.value = audio;
    canRecordVideo.value = video;
  }

  async function initialize(): Promise<void> {
    await refresh();
    // Guarded: `navigator.mediaDevices` is absent in a runtime without the
    // capability, and the probe above has already reported that.
    if (navigator.mediaDevices) {
      navigator.mediaDevices.ondevicechange = () => {
        refresh().catch(() => undefined);
      };
    }
  }

  function stopWatching(): void {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.ondevicechange = null;
    }
  }

  return {
    canRecordAudio: toRO(canRecordAudio),
    canRecordVideo: toRO(canRecordVideo),
    canRecord,

    refreshRecordingSupport: refresh,
    initialize,
    stopWatching,
  };
}
