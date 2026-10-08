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

export type MainWindowCommand = 'open-chat-with' | 'incoming-call';

export interface OpenChatCmdArg {
  peerAddress: string;
  chatId?: ChatIdObj;
}

export interface IncomingCallCmdArg {
  peerAddress: string;
  chatId: ChatIdObj;
  /**
   * Session id of the ringing call. Echoed back on join/dismiss so the
   * background service can refuse a click that was armed for a call that is
   * already over (see joinOrDismissCallInRoom).
   */
  callSessionId?: string;
  /**
   * When the background service issued this command. A command can be
   * re-delivered on window re-creation (getStartedCmd), and without an age
   * check it used to arm the incoming-call UI for a call long over.
   */
  sentAt?: number;
}
