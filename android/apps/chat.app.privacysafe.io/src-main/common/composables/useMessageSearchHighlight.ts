/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but WITHOUT
 ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
import type { Ref } from 'vue';

/**
 * The message search state a bubble needs, shared from the chat view straight
 * down to chat-message-regular. Injection, rather than props: the two values
 * are of no interest to the message list components in between.
 */
export interface MessageSearchHighlight {
  /** chatMessageId of the found message currently navigated to. */
  highlightedMessageId: Ref<string | undefined>;
  /** What the user searched for, to mark inside the message body. */
  query: Ref<string>;
}

export const MESSAGE_SEARCH_HIGHLIGHT_KEY = 'message-search-highlight';
