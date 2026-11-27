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
import { includesAddress } from '@shared/address-utils';

/**
 * Whether deleting these messages "for everyone" will be honoured by the other
 * side, so that the option is offered only where it does something.
 *
 * The rule is the receiving side's (msg-deletion.ts, mayPeerDelete): in a
 * one-to-one chat either side deletes any message, in a group an admin deletes
 * any and everybody else only their own.
 */
export function canDeleteForEveryone(
  chat: { isGroupChat: boolean; admins?: string[] } | null | undefined,
  msgs: ({ isIncomingMsg: boolean } | undefined)[],
  ownAddr: string,
): boolean {
  if (!chat) {
    return false;
  }
  if (!chat.isGroupChat || includesAddress(chat.admins ?? [], ownAddr)) {
    return true;
  }
  return msgs.every(m => !!m && !m.isIncomingMsg);
}
