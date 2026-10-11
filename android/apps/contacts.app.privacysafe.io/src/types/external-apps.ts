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

/**
 * Services of other apps that this app calls. These mirror declarations of
 * the services' own apps (chat: types/external-chats.types.ts, inbox:
 * src/common/types/external-inbox.types.ts), and must be kept in line with
 * them.
 */

/** A file handed over to another app by reference. */
export interface ExternalDraftFile {
  file: web3n.files.ReadonlyFile;
  name?: string;
}

export type SingleChatStatus = 'initiated' | 'on' | 'invited' | 'accepted' | 'no-members';

/** Service 'AppChats' of chat.app.privacysafe.io */
export interface AppChatsExternalSrv {
  getOneToOneChatStatus(peerAddr: string): Promise<SingleChatStatus | null>;
  prepareOutgoingDraft(params: { peerAddress: string; files: ExternalDraftFile[] }): Promise<{ draftId: string }>;
}

/** Service 'AppInbox' of inbox.app.privacysafe.io */
export interface AppInboxExternalSrv {
  prepareDraft(params: {
    recipients: string[];
    subject?: string;
    files: ExternalDraftFile[];
  }): Promise<{ draftId: string }>;
}
