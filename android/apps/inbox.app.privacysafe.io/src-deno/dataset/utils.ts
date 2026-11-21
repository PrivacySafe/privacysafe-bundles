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
import type { QueryExecResult } from '../../shared/libs/sqlite-on-3nstorage/index.js';
import type {
  AppState,
  DbQueryParams,
  IncomingMessageView,
  MailFolder,
  MailFolderDB,
  MessageJsonBody,
  MessageViewDB,
  OutgoingMessageView,
} from '../../src/common/types/index.ts';

type SqlValue = number | string | Uint8Array | Blob | null;

function isEmpty(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (Array.isArray(value) || typeof value === 'string') {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
}

export function objectFromQueryExecResult<T>(sqlResult: QueryExecResult): Array<T> {
  const { columns, values: rows } = sqlResult;
  return rows.map((row: SqlValue[]) =>
    row.reduce((obj, cellValue, index) => {
      const field = columns[index] as keyof T;
      obj[field] = cellValue as T[keyof T];
      return obj;
    }, {} as T),
  );
}

export function appStateValueToSqlInsertParams(state: AppState): DbQueryParams<unknown, keyof unknown> {
  return {
    $id: '0',
    $state: JSON.stringify(state),
  };
}

export function appStateDbValueToAppState(sqlResult: QueryExecResult): AppState {
  const data = objectFromQueryExecResult<{ id: string; state: string }>(sqlResult);
  const raw = data[0];
  if (!raw) {
    return { lastReceivingTimestamp: 0 };
  }
  if (typeof raw.state === 'string') {
    try {
      return JSON.parse(raw.state) as AppState;
    } catch {
      return { lastReceivingTimestamp: 0 };
    }
  }
  return { lastReceivingTimestamp: 0 };
}

export function thumbnailsDbValueToRecord(sqlResult: QueryExecResult): Record<string, string> {
  const rows = objectFromQueryExecResult<{ msgId: string; fileName: string; dataUrl: string }>(sqlResult);
  const byFileName: Record<string, string> = {};
  for (const row of rows) {
    if (row.fileName && typeof row.dataUrl === 'string') {
      byFileName[row.fileName] = row.dataUrl;
    }
  }
  return byFileName;
}

export function folderValueToSqlInsertParams(
  folderData: MailFolder,
): DbQueryParams<MailFolderDB, keyof MailFolderDB> {
  const { id, name, icon, iconColor, position, path, isSystem } = folderData;
  return {
    $id: id,
    $name: name,
    $icon: icon || null,
    $iconColor: iconColor || null,
    $position: position,
    $path: path,
    $isSystem: isSystem ? 1 : 0,
  };
}

export function folderDbValueToFolderValue(sqlResult: QueryExecResult): MailFolder[] {
  const data = objectFromQueryExecResult<MailFolderDB>(sqlResult);
  return data.map(item => ({
    id: item.id,
    name: item.name,
    icon: item.icon,
    iconColor: item.iconColor,
    position: item.position,
    path: item.path,
    isSystem: !!item.isSystem,
  }));
}

export function msgValueToSqlInsertParams(
  msgData: IncomingMessageView | OutgoingMessageView,
): DbQueryParams<MessageViewDB, keyof MessageViewDB> {
  const isMsgIncoming = 'sender' in msgData && 'deliveryTS' in msgData;
  return {
    $msgId: msgData.msgId!,
    $threadId: msgData.threadId!,
    $msgType: 'mail',
    $cTime: msgData.cTime || null,
    // Kept for an outgoing record too, and not only for an incoming one. Three
    // things read it back expecting it to be there: preserveEventStamps(), which
    // cannot keep a stamp the stored record does not carry - so every draft save
    // went out as a delivery change; deliveryStateOf(), which builds that diff;
    // and message-list.vue, which sorts the Draft folder strictly by it.
    $deliveryTS: msgData.deliveryTS ?? null,
    $subject: msgData.subject || null,
    $plainTxtBody: msgData.plainTxtBody || null,
    $htmlTxtBody: msgData.htmlTxtBody || null,
    $jsonBody: JSON.stringify(msgData.jsonBody),
    $recipients: isEmpty(msgData.recipients) ? null : JSON.stringify(msgData.recipients),
    $sender: isMsgIncoming ? (msgData as IncomingMessageView).sender : null,
    $mailFolder: msgData.mailFolder,
    $status: msgData.status,
    $statusDescription: isEmpty(msgData.statusDescription) ? null : JSON.stringify(msgData.statusDescription),
    $attachmentsInfo: isEmpty(msgData.attachmentsInfo) ? null : JSON.stringify(msgData.attachmentsInfo),
    $originDeviceId: msgData.originDeviceId || null,
  };
}

/**
 * Whether two records would be stored as the very same row.
 *
 * The comparison is made on the insert parameters rather than on the records:
 * that flat object IS what goes into the table, its keys are in a fixed order,
 * and it leaves out whatever the row does not carry. Comparing the records
 * themselves would answer wrongly for two that were built by different paths and
 * differ only in key order or in a field the table has no column for.
 */
export function sameStoredMsgRow(
  a: IncomingMessageView | OutgoingMessageView,
  b: IncomingMessageView | OutgoingMessageView,
): boolean {
  return JSON.stringify(msgValueToSqlInsertParams(a)) === JSON.stringify(msgValueToSqlInsertParams(b));
}

export function msgDbValueToMsgValue(
  sqlResult: QueryExecResult,
): Array<IncomingMessageView | OutgoingMessageView> {
  const data = objectFromQueryExecResult<MessageViewDB>(sqlResult);
  return data.map(item => ({
    msgId: item.msgId,
    threadId: item.threadId,
    msgType: item.msgType,
    ...(item.cTime && { cTime: item.cTime }),
    ...(item.deliveryTS && { deliveryTS: item.deliveryTS }),
    ...(item.subject && { subject: item.subject }),
    ...(item.plainTxtBody && { plainTxtBody: item.plainTxtBody }),
    ...(item.htmlTxtBody && { htmlTxtBody: item.htmlTxtBody }),
    jsonBody: JSON.parse(item.jsonBody) as MessageJsonBody,
    ...(item.recipients && { recipients: JSON.parse(item.recipients) as string[] }),
    ...(item.sender && { sender: item.sender }),
    mailFolder: item.mailFolder,
    status: item.status,
    ...(item.statusDescription && { statusDescription: JSON.parse(item.statusDescription) }),
    ...(item.attachmentsInfo && { attachmentsInfo: JSON.parse(item.attachmentsInfo) }),
    ...(item.originDeviceId && { originDeviceId: item.originDeviceId }),
  })) as Array<IncomingMessageView | OutgoingMessageView>;
}

export { isEmpty };
