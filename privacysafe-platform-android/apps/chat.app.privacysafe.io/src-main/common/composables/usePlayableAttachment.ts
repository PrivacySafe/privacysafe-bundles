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
import { onBeforeUnmount, ref } from 'vue';
import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
import { makeLogger } from '@shared/logger';
import {
  bufferedEndOf,
  bufferedStartOf,
  MediaElementError,
  playProgressively,
  SourceBufferFullError,
  streamableMimeOf,
  streamingLimitFor,
} from '@main/common/utils/media-streaming';
import { readFileWithProgress, type OnReadProgress } from '@main/common/utils/read-with-progress';
import { useAttachmentContent } from './useAttachmentContent';
import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';

const log = makeLogger('PlayableAttachment');

/**
 * Gives a media element something to play, starting before the whole file has
 * been read where the container allows it.
 *
 * Audio and video need exactly the same thing, hence one place for it.
 */
export function usePlayableAttachment({
  item,
  incomingMsgId,
  onMissing,
  onUnplayable,
}: {
  item: AttachmentViewInfo;
  incomingMsgId?: string;
  onMissing?: () => void;
  /**
   * The file was read whole and the element still cannot play it - there is
   * nothing left to try. A file renamed to .mp3 ends up here.
   */
  onUnplayable?: () => void;
}) {
  const content = useAttachmentContent({ item, incomingMsgId });

  /** Playing from a stream, so only what has arrived can be played. */
  const isStreaming = ref(false);
  /** How far playback can go: what has arrived, or the whole file. */
  const seekableEnd = ref(0);
  /**
   * The earliest point playback can still reach. Anything but 0 means the size
   * budget failed to keep Chromium from dropping the head of the buffer.
   */
  const seekableStart = ref(0);

  let headLossReported = false;
  /** The container this file is being streamed as, once attachTo has decided. */
  let streamedAs: string | undefined = undefined;
  /**
   * Set while a streaming attempt is on the hook for the element's failures, so
   * that it can abandon MediaSource and read the file in full instead.
   */
  let failureSink: (() => void) | undefined = undefined;
  /**
   * The element is playing the last source there is. Only then does its failure
   * mean the file cannot be played at all - during the switch from a failed
   * stream to a full read it means nothing.
   */
  let onFinalSource = false;
  let watchedEl: HTMLMediaElement | undefined = undefined;

  function handleElementError(): void {
    if (failureSink) {
      failureSink();
    } else if (onFinalSource) {
      onUnplayable?.();
    }
  }

  onBeforeUnmount(() => watchedEl?.removeEventListener('error', handleElementError));

  function noteBuffered(el: HTMLMediaElement): void {
    seekableEnd.value = isStreaming.value ? bufferedEndOf(el) : el.duration || 0;
    seekableStart.value = bufferedStartOf(el);

    if (seekableStart.value > 0 && !headLossReported) {
      headLossReported = true;
      const size = item.size ?? 0;
      const limit = streamedAs ? streamingLimitFor(streamedAs) : 0;
      // A range that does not begin at zero has two unrelated causes, and
      // blaming the wrong one sends the next diagnosis the wrong way. Near the
      // budget it is Chromium's collector dropping the head to make room -
      // nothing else reports that, and the element goes on looking healthy
      // while its first minute is simply gone. Well under the budget nothing
      // has been dropped: `buffered` is the intersection of the track buffers,
      // and a recording's camera delivers its first frame later than its
      // microphone does, so the picture - and with it the playable range -
      // starts a little after the sound.
      if (limit && (size > limit / 2)) {
        log.warn(
          `Chromium dropped the first ${seekableStart.value.toFixed(1)}s of '${item.name}' `
            + `(${formatFileSize(size)}) from the source buffer; the streaming size budget is too high`,
        );
      } else {
        log.info(
          `'${item.name}' (${formatFileSize(size)}) is playable from ${seekableStart.value.toFixed(1)}s on: `
            + 'its tracks do not all start at zero',
        );
      }
    }
  }

  function playFromBytes(el: HTMLMediaElement, bytes: Uint8Array): void {
    isStreaming.value = false;
    // Before the assignment: whatever the element makes of these bytes is the
    // final word, and its verdict can arrive as soon as the source is set.
    onFinalSource = true;
    el.src = content.objectUrlFor(bytes);
    seekableEnd.value = 0;
    seekableStart.value = 0;
  }

  /**
   * Feeds the element through MediaSource. Resolves once the whole file is in
   * the source buffer; rejects if it could not be put there, or if the element
   * refused what it got.
   */
  async function streamInto(
    el: HTMLMediaElement,
    mime: string,
    file: web3n.files.ReadonlyFile,
    onProgress: OnReadProgress,
    signal: AbortSignal,
  ): Promise<void> {
    const { url, done } = playProgressively(file, mime, onProgress, signal);
    // Whichever of the two below loses the race must not surface as an
    // unhandled rejection; the race itself still sees the original promise.
    done.catch(() => undefined);

    const refused = new Promise<never>((_, reject) => {
      failureSink = () => reject(new MediaElementError(el));
    });

    el.src = content.keepObjectUrl(url);
    isStreaming.value = true;
    try {
      // Racing the element's own verdict is what catches a MediaSource that
      // died quietly: a failed parse ends the stream with a decode error, and a
      // reader that has already been told 'updateend' finishes reporting success.
      await Promise.race([done, refused]);
    } finally {
      // Cleared before anything else can reject it, so that a later element
      // failure is read as "this file cannot be played" instead.
      failureSink = undefined;
    }
    // The whole file sits in the buffer now, so seeking is bounded by the exact
    // duration rather than by whatever `buffered` last reported.
    isStreaming.value = false;
    onFinalSource = true;
  }

  /**
   * Attaches a source to the element and keeps reading in the background. Not
   * meant to be awaited for completion - the point is that playback can begin
   * while the read is still going.
   */
  function attachTo(el: HTMLMediaElement): void {
    // item.name, NOT item.filename: the latter is the name with the extension
    // already cut off, and asking it for an extension turns streaming off for
    // every file without a word.
    const mime = streamableMimeOf(item.name);

    watchedEl = el;
    el.addEventListener('error', handleElementError);

    // One withRead for both routes, so that the fallback reads the same handle
    // under the same AbortSignal instead of opening the file a second time.
    content
      .withRead(async (file, onProgress, signal) => {
        if (mime && (await fitsInSourceBuffer(file, mime))) {
          streamedAs = mime;
          try {
            await streamInto(el, mime, file, onProgress, signal);
            return;
          } catch (err) {
            // Three ways to get here, and they mean different things. A full
            // buffer says the size budget was too generous for this file; the
            // element refusing what it got, or any other MediaSource failure,
            // says the container was guessed wrong. Either way the viewer must
            // not be left silently empty - read the file and let the element
            // judge the bytes themselves.
            log.info(
              err instanceof SourceBufferFullError
                ? `The source buffer would not hold '${item.name}'; reading it in full instead`
                : `Progressive playback of '${item.name}' failed; reading it in full`,
              err,
            );
            isStreaming.value = false;
            streamedAs = undefined;
            el.removeAttribute('src');
            el.load();
          }
        }

        const bytes = await readFileWithProgress(file, onProgress, signal);
        if (bytes) {
          playFromBytes(el, bytes);
        }
      })
      .then(() => {
        if (content.isMissing.value) {
          onMissing?.();
        }
      })
      .catch(err => log.error(`Failed to load '${item.name}' for playback`, err));
  }

  return {
    isLoading: content.isLoading,
    isMissing: content.isMissing,
    percent: content.percent,
    progress: content.progress,
    isStreaming,
    seekableStart,
    seekableEnd,
    noteBuffered,
    attachTo,
    cancel: content.cancel,
  };
}

/**
 * Whether this file can be streamed and still be rewound to its start.
 *
 * Goes by stat() rather than by the size recorded on the attachment: an
 * outgoing file above ATTACHMENT_COPY_THRESHOLD is only linked, not copied, so
 * the recorded size can be stale, and every path that records it turns a failed
 * stat into a 0. An unknown size is treated as "do not stream" - guessing wrong
 * here costs the start of the file, and guessing wrong the other way costs only
 * a wait that already has a progress bar.
 */
async function fitsInSourceBuffer(file: web3n.files.ReadonlyFile, mime: string): Promise<boolean> {
  const size = (await file.stat().catch(() => undefined))?.size ?? 0;
  return size > 0 && size <= streamingLimitFor(mime);
}
