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
 * A file another app hands over to the inbox. The file object travels over
 * the inter-app RPC by reference; the inbox copies it into its own store.
 */
export interface ExternalDraftFile {
  file: web3n.files.ReadonlyFile;
  name?: string;
}

/**
 * Service 'AppInbox', exposed to other apps (see manifest.json).
 */
export interface AppInboxExternalSrv {
  /**
   * Copies given files into the inbox file store and keeps them, with given
   * recipients and subject, as a draft of a new message. Returned id is to be
   * passed in the 'open-inbox-with' command.
   */
  prepareDraft(params: {
    recipients: string[];
    subject?: string;
    files: ExternalDraftFile[];
  }): Promise<{ draftId: string }>;
}

/**
 * Argument of the 'open-inbox-with' command.
 */
export interface OpenInboxCmdArg {
  peerAddress: string;
  /** Id of a draft prepared by AppInbox.prepareDraft. */
  draftId?: string;
}
