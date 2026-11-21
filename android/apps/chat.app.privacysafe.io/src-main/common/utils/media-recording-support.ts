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

export interface RecordingSupport {
  audio: boolean;
  video: boolean;
}

/**
 * Whether this device can record at all, and with what.
 *
 * Note what is NOT used here: `w3n.mediaDevices.isAudioCaptureAvailable()`.
 * Despite the name it answers nothing about a microphone - the platform
 * implements it as `platform() === 'win32'`, because it is about capturing
 * SYSTEM audio (loopback) alongside a shared screen, which is how src-video
 * uses it. On macOS and Linux it is always false, and on Android
 * `w3n.mediaDevices` does not exist at all (the runner passes
 * `makeMediaDevicesCAP: undefined`). Gating the recording button on it would
 * hide the button on every platform but Windows.
 *
 * So the question is asked of the runtime instead, in the order things can
 * fail: no MediaRecorder at all, then permission refused outright, then no
 * device of that kind.
 */
export async function probeRecordingSupport(): Promise<RecordingSupport> {
  const none: RecordingSupport = { audio: false, video: false };

  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return none;
  }

  // 'denied' here is the platform's own permission check handler answering, so
  // it is also how a missing `mediaDevices` capability shows up in the window.
  // In a try/catch because the descriptor name is not universally supported,
  // and an unsupported query is an absent signal rather than a refusal.
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (status?.state === 'denied') {
      return none;
    }
  } catch {
    /* no signal either way */
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Before permission is granted the labels come back empty, but `kind` is
    // there - which is all this needs. It answers "is there a microphone", not
    // "which microphone".
    return {
      audio: devices.some(d => d.kind === 'audioinput'),
      video: devices.some(d => d.kind === 'videoinput'),
    };
  } catch {
    return none;
  }
}
