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
 */

/**
 * The pure parts of recording a voice or video message: picking a container,
 * naming the file, and pairing a message body's `recordings` with the
 * attachments it describes.
 *
 * All of it is imported directly - no browser, no devices, no network - the way
 * `codec-preferences.ts` covers its own pure function. What these guard is the
 * two decisions that fail silently and far from here: `.weba` vs `.webm`, which
 * decides whether an audio recording is offered to a video element, and the
 * name-keyed pairing, which decides whether a duration lands on the right file.
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import {
  extensionForRecordingMime,
  nameForRecording,
  pickRecordingMime,
} from '@shared/media-recording-format';
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_MILLIS,
  VIDEO_AUDIO_BITS_PER_SECOND,
  VIDEO_VIDEO_BITS_PER_SECOND,
  VOICE_AUDIO_BITS_PER_SECOND,
} from '@shared/constants/media-recording';
import {
  STREAMABLE_AUDIO_MAX_SIZE,
  STREAMABLE_VIDEO_MAX_SIZE,
} from '@shared/constants/attachment-limits';
import {
  recordingsOfAttachments,
  withRecordingsApplied,
} from '@deno/services/chat-service/utils/_msgs-related-methods';
import type { ChatMessageAttachmentsInfo } from '~/index';

/** Supports everything, the way a current Chromium does. */
const supportsAll = () => true;
/** Supports nothing, which is what a runtime without WebM looks like. */
const supportsNone = () => false;

function attachment(
  name: string,
  recording?: ChatMessageAttachmentsInfo['recording'],
): ChatMessageAttachmentsInfo {
  return { name, size: 1024, isFolder: false, ...(recording && { recording }) };
}

describe(`Recording a voice or video message`, () => {

  itCond(`records audio into a container named .weba, never .webm`, async () => {
    const mime = pickRecordingMime('voice', supportsAll);
    expect(mime).toBe('audio/webm;codecs=opus');

    const ext = extensionForRecordingMime('voice', mime);
    expect(ext).toBe('weba');
    // The whole point of the previous line. STREAMABLE_MIME_BY_EXT maps `webm`
    // to `video/webm`, so an audio recording named `.webm` would be handed to a
    // video element and sent to the video viewer by isFileVideo().
    expect(ext)
      .withContext(`'.webm' would send an audio recording down the video path`)
      .not.toBe('webm');
  }, 10000);

  itCond(`records video into .webm`, async () => {
    const mime = pickRecordingMime('video', supportsAll);
    expect(mime).toBe('video/webm;codecs=vp8,opus');
    expect(extensionForRecordingMime('video', mime)).toBe('webm');
  }, 10000);

  itCond(`takes the extension from the container REPORTED, parameters and all`, async () => {
    // A runtime may hand back a container other than the one asked for, so the
    // extension is derived from recorder.mimeType - which carries parameters.
    expect(extensionForRecordingMime('voice', 'audio/webm;codecs=opus')).toBe('weba');
    expect(extensionForRecordingMime('voice', 'AUDIO/WEBM')).toBe('weba');
    expect(extensionForRecordingMime('voice', 'audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionForRecordingMime('voice', 'audio/mp4')).toBe('m4a');
    expect(extensionForRecordingMime('video', 'video/mp4')).toBe('mp4');
  }, 10000);

  itCond(`falls back to a safe extension for an unknown or absent container`, async () => {
    expect(extensionForRecordingMime('voice', undefined)).toBe('weba');
    expect(extensionForRecordingMime('voice', '')).toBe('weba');
    expect(extensionForRecordingMime('voice', 'audio/x-nonesuch')).toBe('weba');
    expect(extensionForRecordingMime('video', undefined)).toBe('webm');
    expect(extensionForRecordingMime('video', 'video/x-nonesuch')).toBe('webm');
  }, 10000);

  itCond(`leaves the container to the recorder when nothing on the list is supported`, async () => {
    // Undefined means "do not pass a mimeType at all": the recorder's own
    // default is a better answer than refusing to record.
    expect(pickRecordingMime('voice', supportsNone)).toBeUndefined();
    expect(pickRecordingMime('video', supportsNone)).toBeUndefined();
  }, 10000);

  itCond(`prefers webm but accepts the next container a runtime does support`, async () => {
    const oggOnly = (m: string) => m.startsWith('audio/ogg');
    expect(pickRecordingMime('voice', oggOnly)).toBe('audio/ogg;codecs=opus');

    const vp9Only = (m: string) => m.includes('vp9');
    expect(pickRecordingMime('video', vp9Only)).toBe('video/webm;codecs=vp9,opus');
  }, 10000);

  itCond(`names a recording by kind, stamp and extension, with no colon in it`, async () => {
    const name = nameForRecording('voice', '26-09-09_15-12-03', 'weba');
    expect(name).toBe('voice_26-09-09_15-12-03.weba');
    // A colon cannot be part of a file name on Windows, and the recipient
    // saving the attachment there would hit exactly that.
    expect(name).not.toContain(':');

    expect(nameForRecording('video', '26-09-09_15-12-03', 'webm'))
      .toBe('video_26-09-09_15-12-03.webm');
  }, 10000);

  itCond(`keeps every recording inside the size that can still be streamed`, async () => {
    // Both limits have to hold at once: the duration is what the user is told,
    // the byte budget is what actually guarantees it, and a nominal bitrate is
    // a target the encoder aims at rather than a promise.
    const voiceBytes = (VOICE_AUDIO_BITS_PER_SECOND * MAX_RECORDING_MILLIS.voice) / 8000;
    expect(voiceBytes).toBeLessThan(STREAMABLE_AUDIO_MAX_SIZE);
    expect(MAX_RECORDING_BYTES.voice).toBeLessThan(STREAMABLE_AUDIO_MAX_SIZE);

    const videoBytes =
      ((VIDEO_VIDEO_BITS_PER_SECOND + VIDEO_AUDIO_BITS_PER_SECOND) * MAX_RECORDING_MILLIS.video)
      / 8000;
    expect(videoBytes).toBeLessThan(STREAMABLE_VIDEO_MAX_SIZE);
    expect(MAX_RECORDING_BYTES.video).toBeLessThan(STREAMABLE_VIDEO_MAX_SIZE);

    // And the two limits have to end at roughly the same place. If the byte
    // budget ran out much sooner, "up to ten minutes" would be a claim the
    // recorder does not keep.
    expect(videoBytes).toBeLessThan(MAX_RECORDING_BYTES.video);
    expect(voiceBytes).toBeLessThan(MAX_RECORDING_BYTES.voice);
  }, 10000);

});

describe(`Pairing a message body's recordings with its attachments`, () => {

  itCond(`marks the attachment named in the body, and only it`, async () => {
    const marked = withRecordingsApplied(
      [attachment('report.pdf'), attachment('voice_26-09-09.weba')],
      { 'voice_26-09-09.weba': { kind: 'voice', durationMs: 3200 } },
    );

    expect(marked![0].recording).toBeUndefined();
    expect(marked![1].recording).toEqual({ kind: 'voice', durationMs: 3200 });
  }, 10000);

  itCond(`pairs by NAME, not by position`, async () => {
    // The attachments folder of an incoming message promises no order, so an
    // index would pair a duration with whichever file happened to be listed
    // first. Here the recording is the first entry and the body still finds it.
    const marked = withRecordingsApplied(
      [attachment('voice_26-09-09.weba'), attachment('report.pdf')],
      { 'voice_26-09-09.weba': { kind: 'voice', durationMs: 3200 } },
    );

    expect(marked![0].recording).toEqual({ kind: 'voice', durationMs: 3200 });
    expect(marked![1].recording).toBeUndefined();
  }, 10000);

  itCond(`does not put the preview into the record`, async () => {
    const marked = withRecordingsApplied(
      [attachment('video_26-09-09.webm')],
      {
        'video_26-09-09.webm': {
          kind: 'video',
          durationMs: 60000,
          preview: 'data:image/jpeg;base64,AAAA',
        },
      },
    );

    // A preview lives in the previews table; in the record it would be paid for
    // on every write of the database file.
    expect(marked![0].recording).toEqual({ kind: 'video', durationMs: 60000 });
    expect(Object.keys(marked![0].recording!)).not.toContain('preview');
  }, 10000);

  itCond(`leaves attachments alone when the body says nothing - an older sender`, async () => {
    const attachments = [attachment('voice_26-09-09.weba')];

    // A build that does not know the field sends no `recordings`. Its message
    // must show as a plain attachment rather than be guessed at by extension.
    expect(withRecordingsApplied(attachments, undefined)).toBe(attachments);
    expect(withRecordingsApplied(attachments, {})![0].recording).toBeUndefined();
    expect(withRecordingsApplied(null, undefined)).toBeNull();
    expect(withRecordingsApplied([], { 'x.weba': { kind: 'voice', durationMs: 1 } })).toEqual([]);
  }, 10000);

  itCond(`ignores a name in the body that no attachment carries`, async () => {
    const marked = withRecordingsApplied(
      [attachment('report.pdf')],
      { 'voice_26-09-09.weba': { kind: 'voice', durationMs: 3200 } },
    );

    expect(marked![0].recording).toBeUndefined();
  }, 10000);

  itCond(`reads a body's recordings back off a record, without the preview`, async () => {
    // What a message being SENT AGAIN says about its recordings: taken from the
    // record, so that the second attempt says what the first one did. The
    // preview is already in the previews table by then.
    expect(
      recordingsOfAttachments([
        attachment('report.pdf'),
        attachment('voice_26-09-09.weba', { kind: 'voice', durationMs: 3200 }),
      ]),
    ).toEqual({ 'voice_26-09-09.weba': { kind: 'voice', durationMs: 3200 } });
  }, 10000);

  itCond(`says nothing about a message that carries no recording`, async () => {
    // Undefined and not an empty object: the wire form of an ordinary message
    // must not change at all.
    expect(recordingsOfAttachments([attachment('report.pdf')])).toBeUndefined();
    expect(recordingsOfAttachments([])).toBeUndefined();
    expect(recordingsOfAttachments(null)).toBeUndefined();
    expect(recordingsOfAttachments(undefined)).toBeUndefined();
  }, 10000);

});
