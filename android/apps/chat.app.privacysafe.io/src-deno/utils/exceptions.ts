/*
 Copyright (C) 2025 3NSoft Inc.

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

import { makeRuntimeException } from '../../shared-libs/runtime.ts';

export interface DbRecordException extends web3n.RuntimeException {
  type: 'db-record';
  invalidChatInsertData?: true;
  chatNotFound?: true;
  invitationNotFound?: true;
  chatAlreadyExists?: true;
  messageNotFound?: true;
  chatWithMembers?: true;
  notAdmin?: true;
  notGroupChat?: true;
  notChatMember?: true;
  alreadyChatMember?: true;
  address?: string;
}

export function makeDbRecordException(params: Partial<DbRecordException>): DbRecordException {
  return makeRuntimeException('db-record', params, {});
}

