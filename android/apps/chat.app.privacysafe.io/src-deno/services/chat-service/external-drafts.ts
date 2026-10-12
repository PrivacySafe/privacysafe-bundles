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
import type { ChatIdObj } from '../../../types/asmail-msgs.types.ts';
import type { ChatListItemView, SingleChatStatus } from '../../../types/chat.types.ts';
import type { ExternalDraft, ExternalDraftFile } from '../../../types/external-chats.types.ts';
import type { FileStoreService } from '../../types/index.ts';
import { toCanonicalAddress } from '../../../shared-libs/address-utils.ts';
import { randomStr } from '../../../shared-libs/randomStr.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';

const log = makeLogger('ExternalDrafts');

/**
 * How long a draft prepared by another app waits for the chat window to take
 * it. The window is opened by that app right after the draft is made, so a
 * draft still here after this time belongs to a window that never came, and
 * its copied files would otherwise stay in the store forever.
 */
const DRAFT_TTL_MILLIS = 10 * 60_000;

/**
 * Drafts of messages that other apps (e.g. Contacts sharing contacts) hand to
 * the chat: files are copied into this app's store here, in the background,
 * and the chat window picks the draft up by its id from the start command.
 *
 * Drafts live in memory only: they are a hand-over between two calls a moment
 * apart, not something to survive a restart of the component.
 */
export function externalDrafts(
  filesStore: FileStoreService,
  getChat: (chatId: ChatIdObj) => Promise<ChatListItemView | undefined>,
) {
  const drafts = new Map<string, ExternalDraft & { createdAt: number }>();

  async function getOneToOneChatStatus(peerAddr: string): Promise<SingleChatStatus | null> {
    if (!peerAddr || (typeof peerAddr !== 'string')) {
      return null;
    }

    const chat = await getChat({ isGroupChat: false, chatId: toCanonicalAddress(peerAddr) });
    return chat ? (chat.status as SingleChatStatus) : null;
  }

  async function dropDraft(draftId: string): Promise<void> {
    const draft = drafts.get(draftId);
    if (!draft) {
      return;
    }

    drafts.delete(draftId);
    for (const { storedId } of draft.attachments) {
      await filesStore.deleteEntity(storedId).catch(err =>
        log.error(`Fail to remove a stored file ${storedId} of an expired external draft`, err),
      );
    }
  }

  async function prepareOutgoingDraft(
    { peerAddress, files }: { peerAddress: string; files: ExternalDraftFile[] },
  ): Promise<{ draftId: string }> {
    const status = await getOneToOneChatStatus(peerAddress);
    if (status !== 'on') {
      throw new Error(`There is no active chat with ${peerAddress} (status: ${status})`);
    }

    const chatId: ChatIdObj = { isGroupChat: false, chatId: toCanonicalAddress(peerAddress) };
    const attachments: ExternalDraft['attachments'] = [];
    try {
      for (const { file, name } of files || []) {
        // A copy, not a link: the caller's file is a temporary one, and it is
        // removed as soon as this call returns.
        const storedId = await filesStore.saveCopy(file);
        attachments.push({ storedId, name: name || file.name });
      }
    } catch (err) {
      for (const { storedId } of attachments) {
        await filesStore.deleteEntity(storedId).catch(() => {});
      }
      throw err;
    }

    const draftId = randomStr(20);
    drafts.set(draftId, { chatId, attachments, createdAt: Date.now() });
    setTimeout(() => dropDraft(draftId), DRAFT_TTL_MILLIS);

    log.info(`External draft ${draftId} prepared for chat with ${peerAddress}: ${attachments.length} file(s)`);
    return { draftId };
  }

  async function takeExternalDraft(draftId: string): Promise<ExternalDraft | undefined> {
    const draft = drafts.get(draftId);
    if (!draft) {
      return;
    }

    // From here on the stored files belong to the composer that took them.
    drafts.delete(draftId);
    const { chatId, attachments } = draft;
    return { chatId, attachments };
  }

  return {
    getOneToOneChatStatus,
    prepareOutgoingDraft,
    takeExternalDraft,
  };
}
