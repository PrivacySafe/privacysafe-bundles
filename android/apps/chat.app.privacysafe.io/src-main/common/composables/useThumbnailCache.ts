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
import type { ChatMessageId } from '~/index';
import { chatService } from '@main/common/services/external-services';
import { chatIdToString } from '@shared/chat-ids';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ThumbnailCache');

export interface ThumbnailCache {
  /** The preview of this attachment, if one was made before. */
  get(id: ChatMessageId, fileName: string): Promise<string | undefined>;
  /** Keeps a freshly made preview, in memory and in the database. */
  put(id: ChatMessageId, fileName: string, dataUrl: string): void;
}

export const THUMBNAIL_CACHE_KEY = 'thumbnail-cache';

function keyOf({ chatId, chatMessageId }: ChatMessageId): string {
  return `${chatIdToString(chatId)}/${chatMessageId}`;
}

/**
 * Previews of message attachments, in memory in front of the database.
 *
 * An attachment chip is mounted and unmounted on every scroll of the virtual
 * list, so asking the service on mount - which is what INBOX does, where the
 * message is one - would mean a round trip per message that comes into view.
 * Instead the whole chat view shares one of these, and a message is asked for
 * once: the in-flight map is what makes several attachments of one message a
 * single call.
 *
 * It lives as long as the chat view does, so switching chats starts over rather
 * than letting the previous chat's previews leak into the next one.
 */
export function useThumbnailCache(): ThumbnailCache {
  const byMessage = new Map<string, Record<string, string>>();
  const inFlight = new Map<string, Promise<Record<string, string>>>();

  function fetchMessage(id: ChatMessageId, key: string): Promise<Record<string, string>> {
    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }

    const request = chatService
      .getThumbnails(id)
      .catch(err => {
        log.error(`Failed to read cached previews of the message ${key}`, err);
        return {} as Record<string, string>;
      })
      .then(thumbnails => {
        // Merged rather than assigned: a preview made while this call was in
        // the air is newer than what the database answered with.
        const merged = { ...thumbnails, ...(byMessage.get(key) ?? {}) };
        byMessage.set(key, merged);
        inFlight.delete(key);
        return merged;
      });

    inFlight.set(key, request);
    return request;
  }

  async function get(id: ChatMessageId, fileName: string): Promise<string | undefined> {
    const key = keyOf(id);
    const known = byMessage.get(key);
    if (known) {
      return known[fileName];
    }
    return (await fetchMessage(id, key))[fileName];
  }

  function put(id: ChatMessageId, fileName: string, dataUrl: string): void {
    const key = keyOf(id);
    byMessage.set(key, { ...(byMessage.get(key) ?? {}), [fileName]: dataUrl });
    // Fire and forget: the preview is already on screen, and an oversized one
    // the service refuses to keep is not something the user has to hear about.
    chatService
      .saveThumbnail(id, fileName, dataUrl)
      .catch(err => log.error(`Failed to keep the preview of '${fileName}'`, err));
  }

  return { get, put };
}
