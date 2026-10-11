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
import { ref } from 'vue';
import { makeLogger } from '@shared/utils/logger';
import { bufferedEndOf, playProgressively, streamableMimeOf } from '@common/utils/media-streaming';
import { useAttachmentContent } from './useAttachmentContent';
import type { AttachmentInfo } from '@common/types';

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
}: {
  item: AttachmentInfo;
  incomingMsgId?: string;
  onMissing?: () => void;
}) {
  const content = useAttachmentContent({ item, incomingMsgId });

  /** Playing from a stream, so only what has arrived can be played. */
  const isStreaming = ref(false);
  /** How far playback can go: what has arrived, or the whole file. */
  const seekableEnd = ref(0);

  function noteBuffered(el: HTMLMediaElement): void {
    seekableEnd.value = isStreaming.value ? bufferedEndOf(el) : el.duration || 0;
  }

  async function readWholeInto(el: HTMLMediaElement): Promise<void> {
    isStreaming.value = false;
    const bytes = await content.loadBytes();
    if (!bytes) {
      if (content.isMissing.value) {
        onMissing?.();
      }
      return;
    }
    el.src = content.objectUrlFor(bytes);
    seekableEnd.value = 0;
  }

  async function streamInto(el: HTMLMediaElement, mime: string): Promise<void> {
    try {
      await content.withRead(async (file, onProgress, signal) => {
        const { url, done } = playProgressively(file, mime, onProgress, signal);
        el.src = content.keepObjectUrl(url);
        isStreaming.value = true;
        await done;
      });
      if (content.isMissing.value) {
        onMissing?.();
      }
    } catch (err) {
      // The container was a guess, and a wrong one must not leave the viewer
      // silently empty: read the file in full and play it from a Blob.
      log.info(`Progressive playback of '${item.fileName}' failed; reading it in full`, err);
      isStreaming.value = false;
      el.removeAttribute('src');
      el.load();
      await readWholeInto(el);
    }
  }

  /**
   * Attaches a source to the element and keeps reading in the background. Not
   * meant to be awaited for completion - the point is that playback can begin
   * while the read is still going.
   */
  function attachTo(el: HTMLMediaElement): void {
    const mime = streamableMimeOf(item.fileName);
    const started = mime ? streamInto(el, mime) : readWholeInto(el);
    started.catch(err => log.error(`Failed to load '${item.fileName}' for playback`, err));
  }

  return {
    isLoading: content.isLoading,
    isMissing: content.isMissing,
    percent: content.percent,
    progress: content.progress,
    isStreaming,
    seekableEnd,
    noteBuffered,
    attachTo,
    cancel: content.cancel,
  };
}
