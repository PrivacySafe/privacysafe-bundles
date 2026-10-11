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
import { computed, onBeforeUnmount, ref } from 'vue';
import { mimeTypes } from '@v1nt1248/3nclient-lib/utils';
import { getReadableFileFromMsg } from '@main/common/utils/files.helper';
import {
  readFileWithProgress,
  type OnReadProgress,
  type ReadProgress,
} from '@main/common/utils/read-with-progress';
import type { AttachmentViewInfo } from '@main/common/components/messages/chat-message/chat-message-attachments/types';

/**
 * Loading an attachment's content for a viewer: how far the read has got, how to
 * stop it, and object URLs that get revoked.
 *
 * Every viewer needs the same three things and each had its own version, with an
 * indeterminate spinner that could not tell a short wait from a long one, and
 * object URLs that were never revoked - so a viewed file stayed in memory for as
 * long as the window lived.
 *
 * There is no "on another device" state here: in a chat that is a property of
 * the whole message, decided once by chat-message-attachments.vue, which blocks
 * the chip so that no viewer opens at all. A second source of truth for it would
 * only be able to disagree.
 */
export function useAttachmentContent({
  item,
  incomingMsgId,
}: {
  item: AttachmentViewInfo;
  incomingMsgId?: string;
}) {
  const isLoading = ref(false);
  /** The file has nothing to read: moved, deleted, or its message is gone. */
  const isMissing = ref(false);
  const progress = ref<ReadProgress>({ done: 0, total: item.size ?? 0 });

  const percent = computed(() => {
    const { done, total } = progress.value;
    if (!total) {
      return 0;
    }
    return Math.min(100, Math.round((done / total) * 100));
  });

  // item.ext is already lower-cased where AttachmentViewInfo is built.
  const mimeType = computed(() => mimeTypes[item.ext] ?? '');

  let controller: AbortController | undefined = undefined;
  const objectUrls: string[] = [];

  /**
   * Runs a read of this attachment, with the loading state, the progress and the
   * cancellation around it. `action` gets the file and decides what to do with
   * its bytes - all at once, or a chunk at a time.
   *
   * @returns undefined when there was no file to read.
   */
  async function withRead<T>(
    action: (
      file: web3n.files.ReadonlyFile,
      onProgress: OnReadProgress,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T | undefined> {
    isLoading.value = true;
    progress.value = { done: 0, total: item.size ?? 0 };
    controller = new AbortController();
    try {
      const file = await getReadableFileFromMsg(item.id, incomingMsgId);
      isMissing.value = !file;
      if (!file) {
        return undefined;
      }
      return await action(
        file,
        p => {
          progress.value = p;
        },
        controller.signal,
      );
    } finally {
      isLoading.value = false;
    }
  }

  /** The whole file. Undefined when cancelled or there was nothing to read. */
  function loadBytes(): Promise<Uint8Array | undefined> {
    return withRead((file, onProgress, signal) => readFileWithProgress(file, onProgress, signal)).then(
      bytes => bytes ?? undefined,
    );
  }

  /** An object URL that is revoked when this viewer goes away. */
  function objectUrlFor(data: Uint8Array, type = mimeType.value): string {
    // The cast is the usual Uint8Array/BlobPart mismatch over which ArrayBuffer
    // flavour the view is backed by; a Blob takes it either way.
    const part = data as unknown as BlobPart;
    return keepObjectUrl(URL.createObjectURL(new Blob([part], type ? { type } : undefined)));
  }

  function keepObjectUrl(url: string): string {
    objectUrls.push(url);
    return url;
  }

  function cancel(): void {
    controller?.abort();
  }

  onBeforeUnmount(() => {
    // Closing the viewer must not leave a read of a 200 MB file running.
    cancel();
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
    objectUrls.length = 0;
  });

  return {
    isLoading,
    isMissing,
    progress,
    percent,
    mimeType,
    withRead,
    loadBytes,
    objectUrlFor,
    keepObjectUrl,
    cancel,
  };
}
