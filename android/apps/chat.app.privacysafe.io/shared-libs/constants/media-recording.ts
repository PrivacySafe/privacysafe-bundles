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

import { STREAMABLE_AUDIO_MAX_SIZE, STREAMABLE_VIDEO_MAX_SIZE } from './attachment-limits.ts';

/** What a recording made in the app is: a voice note or a video message. */
export type RecordingKind = 'voice' | 'video';

/**
 * How often MediaRecorder hands over a chunk.
 *
 * Chunks are what the running size is counted from (see the byte budgets
 * below), so the timeslice is also the granularity of that count - and the
 * most that is lost if the recorder has to be stopped abruptly.
 */
export const RECORDING_TIMESLICE_MILLIS = 1000;

/**
 * Bitrate for a voice note: opus, mono.
 *
 * Opus is very good at speech around this rate, and the neighbours sit lower
 * still - Telegram 32 kbps, WhatsApp 16, Viber 32-64, Signal 32-128. What this
 * buys over 32 kbps is room for a noisy environment without the codec
 * smearing consonants.
 */
export const VOICE_AUDIO_BITS_PER_SECOND = 64_000;

/**
 * Bitrates for a video message: vp8 video plus an opus track.
 *
 * 700 kbps rather than 800: see MAX_RECORDING_BYTES below - at 800 kbps ten
 * minutes come to 96% of the size that can still be played progressively, and
 * `videoBitsPerSecond` is a target, not a cap. At 700 the duration limit and
 * the byte budget end at the same point, so ten minutes are actually ten
 * minutes. Even so this is well above what a video message usually gets
 * elsewhere (Telegram's round message is 384x384 at some 400 kbps).
 */
export const VIDEO_VIDEO_BITS_PER_SECOND = 700_000;
export const VIDEO_AUDIO_BITS_PER_SECOND = 64_000;

/** Frame the camera is asked for. Square, and bigger than a round message. */
export const VIDEO_RECORDING_FRAME_SIZE = 640;

/**
 * How long a recording may run.
 *
 * Voice: at 64 kbps the ceiling imposed by STREAMABLE_AUDIO_MAX_SIZE is 17.5
 * minutes, so fifteen fit with 1.13 MiB to spare (6.87 MiB of 8 MiB).
 * Video: at 764 kbps in total, ten minutes come to 54.6 MiB of the 64 MiB
 * that STREAMABLE_VIDEO_MAX_SIZE allows.
 */
export const MAX_RECORDING_MILLIS: Record<RecordingKind, number> = {
  voice: 15 * 60 * 1000,
  video: 10 * 60 * 1000,
};

/**
 * How many bytes a recording may accumulate before it is stopped.
 *
 * The durations above are computed from nominal bitrates, and a nominal
 * bitrate is not a promise: `audioBitsPerSecond` and `videoBitsPerSecond` are
 * targets the encoder aims at, and VBR overshoots them on a busy scene. A
 * recording that crosses the streaming threshold is not broken - the viewer
 * falls back to reading the whole file - but for a 60 MiB video that fallback
 * means some sixty IPC round trips before the first frame.
 *
 * So the size is watched as it accumulates and the recording is stopped when
 * either limit is reached, whichever comes first.
 *
 * Expressed as the threshold MINUS a margin, and deliberately not as a
 * percentage of it. A percentage was the first form, and 85% put the budget
 * BELOW the nominal size of both durations above - 6.80 MiB against 6.87, and
 * 54.40 against 54.65. "Up to fifteen minutes" would then have been cut short
 * at fourteen every single time, and the byte budget would have been the
 * routine limit rather than the backstop it is meant to be. The spec in
 * tests-app/src/tests/media-recording.ts caught that, and is what keeps the
 * two limits agreeing from here on.
 *
 * The margin covers what can still arrive after the check - one timeslice,
 * some 8 KiB of audio or 93 KiB of video - plus container overhead and
 * Chromium's accounting of demuxed buffers, which carries per-frame metadata
 * on top of the bytes appended. Half a mebibyte for audio and four for video
 * is far more than those need, and still leaves the nominal size room for
 * overshoot: 0.63 MiB and 5.35 MiB respectively.
 */
export const MAX_RECORDING_BYTES: Record<RecordingKind, number> = {
  voice: STREAMABLE_AUDIO_MAX_SIZE - 512 * 1024,
  video: STREAMABLE_VIDEO_MAX_SIZE - 4 * 1024 * 1024,
};

/**
 * Longest side of the frame kept as a video message's preview, and its JPEG
 * quality.
 *
 * A video message is far past THUMBNAIL_AUTO_PREVIEW_LIMIT, so nobody - not
 * even the sender - would see a frame without a preview travelling with the
 * message. At these settings that preview is 10-15 KB, well inside
 * THUMBNAIL_CACHE_MAX_CHARS.
 *
 * JPEG and not PNG deliberately: `resizeImage` in the component library hands
 * back PNG (`toDataURL()` with no arguments), and a PNG of a camera frame is
 * several times heavier - the comment on THUMBNAIL_CACHE_MAX_CHARS says as
 * much.
 */
export const RECORDING_PREVIEW_SIZE = 192;
export const RECORDING_PREVIEW_JPEG_QUALITY = 0.7;
