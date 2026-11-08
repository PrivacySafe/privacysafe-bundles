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

import type { RecordingKind } from './constants/media-recording.ts';

/**
 * Containers to record into, best first.
 *
 * WebM leads because it is the only one this app can also play progressively:
 * STREAMABLE_MIME_BY_EXT in media-streaming.ts holds mp3, weba and webm, and
 * of those only webm is something MediaRecorder produces. The rest are
 * fallbacks for a runtime that refuses webm - the recording still works, it
 * just waits for a full read before it plays.
 */
const MIME_PREFERENCES: Record<RecordingKind, string[]> = {
  voice: ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'],
  video: ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'],
};

/**
 * Extension for the container a recording actually came out in.
 *
 * `weba` for audio/webm and NOT `webm` - that one letter decides which branch
 * of the app the file goes down. STREAMABLE_MIME_BY_EXT maps `webm` to
 * `video/webm`, so an audio recording named `.webm` would be offered to a
 * video element, and `isFileVideo` would send it to the video viewer.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/webm': 'weba',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/x-matroska': 'mkv',
  'video/quicktime': 'mov',
};

/** Extension used when the runtime reports a container nothing here knows. */
const FALLBACK_EXTENSION: Record<RecordingKind, string> = {
  voice: 'weba',
  video: 'webm',
};

/**
 * The container to ask MediaRecorder for, or undefined when none of them is
 * supported and the recorder should be left to its own default.
 *
 * `isSupported` is passed in rather than read off MediaRecorder here, so that
 * the choice is a pure function and can be checked without a browser.
 */
export function pickRecordingMime(
  kind: RecordingKind,
  isSupported: (mime: string) => boolean,
): string | undefined {
  return MIME_PREFERENCES[kind].find(isSupported);
}

/**
 * Extension for a recording, from the mime type the recorder REPORTS.
 *
 * Asked of `recorder.mimeType` after the recording starts, never of what was
 * requested: a runtime may hand back a container other than the one asked for
 * - Android's WebView is known for it - and it is the extension, not the
 * requested type, that decides how the file is later read and played.
 */
export function extensionForRecordingMime(kind: RecordingKind, mime: string | undefined): string {
  if (!mime) {
    return FALLBACK_EXTENSION[kind];
  }
  // 'audio/webm;codecs=opus' -> 'audio/webm'
  const base = mime.split(';')[0].trim().toLowerCase();
  return EXTENSION_BY_MIME[base] ?? FALLBACK_EXTENSION[kind];
}

/**
 * Name a recording is attached under.
 *
 * A recording has no name of its own, and the name is what the recipient sees
 * in a file dialog when they save it - so it carries the kind and the moment,
 * with dashes rather than colons in the time: a colon cannot be part of a file
 * name on Windows, and saving the attachment there would hit exactly that.
 */
export function nameForRecording(kind: RecordingKind, stamp: string, ext: string): string {
  return `${kind === 'voice' ? 'voice' : 'video'}_${stamp}.${ext}`;
}
