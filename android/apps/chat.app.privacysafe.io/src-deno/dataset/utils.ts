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
import type { ChatMessageId } from '../../types/asmail-msgs.types.ts';
import type { ParamsObject, SqlValue } from '../../shared-libs/sqlite-on-3nstorage/sqljs.d.ts';
import type {
  OTOChatDbEntry,
  OTOChatTableFields,
  GroupChatDbEntry,
  GroupChatTableFields,
  GroupChatDbRecord,
  MsgDbEntry,
  OrphanedMsgDbEntry,
} from '../types/index.ts';
import { ensureIsAddressString } from '../../shared-libs/address-utils.ts';
import {
  queryParamsFrom,
  andEqualExprFor,
  optStringAsEmptyTransform,
  booleanTransform,
  optJsonTransform,
  type TransformDefinition,
} from '../utils/for-sqlite.ts';
import { makeDbRecordException } from '../utils/exceptions.ts';

export const otoChatTabFields: TransformDefinition<OTOChatTableFields> = {
  peerCAddr: 'as-is',
  peerAddr: 'as-is',
  name: 'as-is',
  status: 'as-is',
  createdAt: 'as-is',
  lastUpdatedAt: 'as-is',
  settings: {
    toSQLValue: (v: object | null): string | null => (v ? JSON.stringify(v) : null),
    fromSQLValue: (sv: SqlValue): object | null => {
      if (!sv || typeof sv !== 'string') {
        return null;
      }
      try {
        return JSON.parse(sv);
      } catch {
        return null;
      }
    },
  },
};

export const groupChatTabFields: TransformDefinition<GroupChatTableFields> = {
  chatId: 'as-is',
  name: 'as-is',
  createdAt: 'as-is',
  lastUpdatedAt: 'as-is',
  status: 'as-is',
  admins: {
    toSQLValue: (admins: GroupChatDbEntry['admins']): GroupChatDbRecord['admins'] => {
      if (admins.length < 1) {
        throw makeDbRecordException({
          invalidChatInsertData: true,
          message: `Chat admins array is empty`,
        });
      }
      for (const addr of admins) {
        try {
          ensureIsAddressString(addr);
        } catch (exc) {
          throw makeDbRecordException({
            invalidChatInsertData: true,
            message: `Invalid address entry in chat admins array`,
            cause: exc,
          });
        }
      }
      return JSON.stringify(admins);
    },
    fromSQLValue: (sv: SqlValue): GroupChatDbEntry['admins'] => {
      if (!sv || typeof sv !== 'string') {
        return [];
      }
      try {
        const res = JSON.parse(sv);
        return Array.isArray(res) ? res : [];
      } catch {
        return [];
      }
    },
  },
  members: {
    toSQLValue: (members: GroupChatDbEntry['members']): GroupChatDbRecord['members'] => {
      if (Object.keys(members).length < 1) {
        throw makeDbRecordException({
          invalidChatInsertData: true,
          message: `Chat members array has too few addresses`,
        });
      }
      for (const addr of Object.keys(members)) {
        try {
          ensureIsAddressString(addr);
        } catch (exc) {
          throw makeDbRecordException({
            invalidChatInsertData: true,
            message: `Invalid address entry in chat members array`,
            cause: exc,
          });
        }
      }
      return JSON.stringify(members);
    },
    fromSQLValue: (sv: SqlValue): GroupChatDbEntry['members'] => {
      if (!sv || typeof sv !== 'string') {
        return {};
      }
      try {
        const res = JSON.parse(sv);
        return typeof res === 'object' && res !== null ? res : {};
      } catch {
        return {};
      }
    },
  },
  settings: {
    toSQLValue: (v: object | null): string | null => (v ? JSON.stringify(v) : null),
    fromSQLValue: (sv: SqlValue): object | null => {
      if (!sv || typeof sv !== 'string') {
        return null;
      }
      try {
        return JSON.parse(sv);
      } catch {
        return null;
      }
    },
  },
};

export function otoChatWhereParamsFor(peerCAddr: string): {
  whereParams: ParamsObject;
  whereClause: string;
} {
  const whereParams = queryParamsFrom<Pick<OTOChatDbEntry, 'peerCAddr'>>({ peerCAddr }, otoChatTabFields);
  const whereClause = andEqualExprFor(whereParams);
  return { whereParams, whereClause };
}

export function groupChatWhereParamsFor(chatId: string): {
  whereParams: ParamsObject;
  whereClause: string;
} {
  const whereParams = queryParamsFrom<Pick<GroupChatDbEntry, 'chatId'>>({ chatId }, groupChatTabFields);
  const whereClause = andEqualExprFor(whereParams);
  return { whereParams, whereClause };
}

export function ensureAllAdminsAreInMembers(
  admins: string[],
  members: Record<string, { hasAccepted: boolean }>,
): void {
  for (const addr of admins) {
    if (!Object.keys(members).includes(addr)) {
      throw makeDbRecordException({
        invalidChatInsertData: true,
        message: `At least one of chat admins entries is not present precisely in chat members array`,
      });
    }
  }
}

export function isUniqueViolation(err: Error, ...columns: string[]): boolean {
  if (!err.message.includes(`UNIQUE constraint failed`)) {
    return false;
  }
  for (const column of columns) {
    if (err.message.includes(column)) {
      return true;
    }
  }
  return false;
}

export const msgsTabFields: TransformDefinition<MsgDbEntry> = {
  // note that fields in primary key are forced to be non-null
  groupChatId: optStringAsEmptyTransform,
  otoPeerCAddr: optStringAsEmptyTransform,
  chatMessageId: 'as-is',
  isIncomingMsg: booleanTransform,
  incomingMsgId: 'as-is',
  groupSender: 'as-is',
  body: 'as-is',
  attachments: optJsonTransform,
  chatMessageType: 'as-is',
  relatedMessage: optJsonTransform,
  status: 'as-is',
  timestamp: 'as-is',
  removeAfter: 'as-is',
  history: optJsonTransform,
  reactions: optJsonTransform,
  settings: optJsonTransform,
};

export const msgsOrphanedTabFiels: TransformDefinition<OrphanedMsgDbEntry> = {
  // note: converted to/from '' like in msgsTabFields, so equality matching on
  // groupChatId/otoPeerCAddr works (SQL NULL never equals NULL)
  groupChatId: optStringAsEmptyTransform,
  otoPeerCAddr: optStringAsEmptyTransform,
  incomingMsgId: 'as-is',
  targetMessageId: 'as-is',
  rawPayload: optJsonTransform,
  bufferedAt: 'as-is',
};

export function msgWhereParamsFor(id: ChatMessageId): {
  whereMsgParams: ParamsObject;
  whereMsg: string;
} {
  const {
    chatId: { isGroupChat, chatId },
    chatMessageId,
  } = id;
  const whereMsgParams = queryParamsFrom<Pick<MsgDbEntry, 'chatMessageId' | 'groupChatId' | 'otoPeerCAddr'>>(
    {
      chatMessageId,
      groupChatId: isGroupChat ? chatId : null,
      otoPeerCAddr: !isGroupChat ? chatId : null,
    },
    msgsTabFields,
  );
  const whereMsg = andEqualExprFor(whereMsgParams);
  return { whereMsgParams, whereMsg };
}
