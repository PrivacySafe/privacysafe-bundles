/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

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

import type { ChatIdObj } from './asmail-msgs.types';
import type { SingleChatStatus } from './chat.types';

/**
 * A file another app hands over to the chat. The file object travels over
 * the inter-app RPC by reference; the chat copies it into its own store.
 */
export interface ExternalDraftFile {
  file: web3n.files.ReadonlyFile;
  name?: string;
}

/**
 * A message draft prepared by the background on another app's request, and
 * picked up by the chat window by its id from the 'open-chat-with' command.
 */
export interface ExternalDraft {
  chatId: ChatIdObj;
  attachments: { storedId: string; name: string }[];
}

/**
 * Service 'AppChats', exposed to other apps (see manifest.json).
 */
export interface AppChatsExternalSrv {
  /**
   * Status of the one-to-one chat with the given address, or null when there
   * is no such chat. Only the 'on' status means that both sides have agreed
   * to talk in this chat.
   */
  getOneToOneChatStatus(peerAddr: string): Promise<SingleChatStatus | null>;

  /**
   * Copies given files into the chat's store and keeps them as a draft for
   * the one-to-one chat with the given address. The chat must be 'on'.
   * Returned id is to be passed in the 'open-chat-with' command.
   */
  prepareOutgoingDraft(params: { peerAddress: string; files: ExternalDraftFile[] }): Promise<{ draftId: string }>;
}
