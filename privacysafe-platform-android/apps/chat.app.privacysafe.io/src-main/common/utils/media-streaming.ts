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
import { getFileExtension } from '@v1nt1248/3nclient-lib/utils';
import { STREAMABLE_AUDIO_MAX_SIZE, STREAMABLE_VIDEO_MAX_SIZE } from '@shared/constants/attachment-limits';
import { pipeFileInChunks, type OnReadProgress } from './read-with-progress';

/**
 * Containers whose bytes can be fed to a SourceBuffer as they arrive.
 *
 * The list is deliberately short, and `MediaSource.isTypeSupported` is not what
 * decides it: that answers "can this be decoded", not "is a plain read of this
 * file a valid MediaSource stream". It says yes to `video/mp4`, yet appending an
 * ordinary - non-fragmented - MP4 to a SourceBuffer fails, and among chat
 * attachments a fragmented MP4 is the rare case. MP3 frames and Matroska
 * clusters, on the other hand, are streams by construction.
 *
 * Everything not here is read in full and played from a Blob, as before. See
 * doc/09-attachment-streaming.md for what would lift this limit.
 */
const STREAMABLE_MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  weba: 'audio/webm',
  webm: 'video/webm',
};

/**
 * The mime type to stream this file under, or undefined if it has to be read in
 * full first.
 */
export function streamableMimeOf(fileName: string): string | undefined {
  const mime = STREAMABLE_MIME_BY_EXT[getFileExtension(fileName).toLowerCase()];
  if (!mime) {
    return undefined;
  }
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mime)) {
    return undefined;
  }
  return mime;
}

/**
 * The biggest file that can be streamed under this mime type and still be
 * rewound to its start afterwards.
 *
 * See the constants for why there is a ceiling at all, and why the audio one is
 * exact while the video one is a guess.
 */
export function streamingLimitFor(mime: string): number {
  return mime.startsWith('audio/') ? STREAMABLE_AUDIO_MAX_SIZE : STREAMABLE_VIDEO_MAX_SIZE;
}

/**
 * Thrown when the SourceBuffer would not take any more.
 *
 * Told apart from every other MediaSource failure because it means something
 * different: not "the container was guessed wrong" but "the size budget was too
 * generous". Both end in the same fallback, and only the log line differs - but
 * a log line saying the wrong thing is how a budget stays wrong for months.
 */
export class SourceBufferFullError extends Error {
  constructor(mime: string, cause?: unknown) {
    super(`SourceBuffer for ${mime} is full`, { cause });
    this.name = 'SourceBufferFullError';
  }
}

/**
 * Thrown when the media element itself gave up on what it was handed.
 *
 * Watching the MediaSource is not enough to notice this. When appended bytes
 * cannot be parsed, the append error algorithm fires `error` AND `updateend` on
 * the SourceBuffer and ends the stream with a decode error - so a reader that
 * takes `updateend` for success finishes the file, finds readyState already
 * 'ended', and reports a clean run over a corpse. The element's own `error` is
 * the one signal that is never ambiguous.
 */
export class MediaElementError extends Error {
  constructor(el: HTMLMediaElement) {
    const { code, message } = el.error ?? {};
    super(`Media element failed${code ? ` with code ${code}` : ''}${message ? `: ${message}` : ''}`);
    this.name = 'MediaElementError';
  }
}

export interface ProgressivePlayback {
  /** Object URL given to the media element; the caller revokes it. */
  url: string;
  /** Resolves when the whole file has been appended, rejects if it could not be. */
  done: Promise<void>;
}

/**
 * Feeds a file to a media element through MediaSource, so that it can start
 * playing before the whole thing has been read.
 *
 * Reading continues to the end of the file regardless: seeking works within what
 * has arrived, and by the time a listener reaches further, it is usually all
 * there. This trades nothing away - the alternative was waiting for the entire
 * file before anything played.
 *
 * The returned `done` rejects on any MediaSource or decode failure, which is the
 * caller's cue to fall back to reading the file in full: this path can only be
 * offered on a guess about the container, and a wrong guess must not leave the
 * viewer silently empty.
 */
export function playProgressively(
  file: web3n.files.ReadonlyFile,
  mime: string,
  onProgress: OnReadProgress,
  signal: AbortSignal,
): ProgressivePlayback {
  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);

  const done = new Promise<void>((resolve, reject) => {
    mediaSource.addEventListener('sourceopen', () => {
      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mime);
      } catch (err) {
        reject(err);
        return;
      }
      // Appended in the order read, with no timestamps of our own to go by.
      sourceBuffer.mode = 'sequence';
      sourceBuffer.addEventListener('error', () => reject(new Error(`SourceBuffer failed for ${mime}`)));

      pipeFileInChunks(
        file,
        chunk => appendAndWait(sourceBuffer, chunk, mime),
        onProgress,
        signal,
      )
        .then(complete => {
          if (complete && mediaSource.readyState === 'open') {
            mediaSource.endOfStream();
          }
          resolve();
        })
        .catch(reject);
    });

    mediaSource.addEventListener('sourceclose', () => {
      // Only meaningful before the stream ended; after that it is the normal
      // teardown of a finished playback.
      if (mediaSource.readyState !== 'ended') {
        reject(new Error(`MediaSource closed before ${mime} was fully appended`));
      }
    });
  });

  return { url, done };
}

function appendAndWait(sourceBuffer: SourceBuffer, chunk: Uint8Array, mime: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onUpdateEnd = () => {
      cleanUp();
      resolve();
    };
    const onError = () => {
      cleanUp();
      reject(new Error('Failed to append a chunk to the media source'));
    };
    const cleanUp = () => {
      sourceBuffer.removeEventListener('updateend', onUpdateEnd);
      sourceBuffer.removeEventListener('error', onError);
    };

    sourceBuffer.addEventListener('updateend', onUpdateEnd);
    sourceBuffer.addEventListener('error', onError);
    try {
      sourceBuffer.appendBuffer(chunk as unknown as ArrayBufferView<ArrayBuffer>);
    } catch (err) {
      cleanUp();
      // appendBuffer throws this one synchronously once the buffer is full and
      // its garbage collector could not free enough behind the playhead.
      reject(
        (err as DOMException)?.name === 'QuotaExceededError' ? new SourceBufferFullError(mime, err) : err,
      );
    }
  });
}

/**
 * The earliest point playback can still reach.
 *
 * Normally 0, and it moves forward for two unrelated reasons. Chromium's
 * garbage collector drops the head of the buffer to make room - the size budget
 * is meant to keep that from ever happening, and this is the only way to notice
 * that it did. Or the file's tracks do not all start together: `buffered` is the
 * intersection of the track buffers, and a recording made in the app has its
 * first camera frame a little after its first sound, so the range begins there.
 */
export function bufferedStartOf(el: HTMLMediaElement): number {
  const { buffered } = el;
  return buffered.length > 0 ? buffered.start(0) : 0;
}

/** How far playback can go with what has arrived so far. */
export function bufferedEndOf(el: HTMLMediaElement): number {
  const { buffered } = el;
  return buffered.length > 0 ? buffered.end(buffered.length - 1) : 0;
}
