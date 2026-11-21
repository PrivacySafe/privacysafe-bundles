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
import isEmpty from 'lodash/isEmpty';
import { SYSTEM_FOLDERS } from '@common/constants';
import {
  IncomingMessageView,
  MessageDeliveryStatus,
  OutgoingMessageView,
  PreparedMessageData,
} from '@common/types';

export function preparedMsgDataToOutgoingMsgView(
  data: PreparedMessageData,
  mailFolder = SYSTEM_FOLDERS.draft,
  status: MessageDeliveryStatus = 'draft',
): OutgoingMessageView {
  const now = Date.now();
  return {
    mailFolder,
    status,
    msgId: data.id,
    threadId: data.threadId,
    cTime: now,
    msgType: 'mail',
    subject: data.subject,
    recipients: data.recipients,
    ...(data.htmlTxtBody && { htmlTxtBody: data.htmlTxtBody }),
    ...(data.plainTxtBody && { plainTxtBody: data.plainTxtBody }),
    jsonBody: {
      threadId: data.threadId,
      msgKind: 'regular',
    },
    ...(!isEmpty(data.attachmentsInfo) && { attachmentsInfo: data.attachmentsInfo }),
    deliveryTS: now,
  };
}

export function msgViewToPreparedMsgData(msg: IncomingMessageView | OutgoingMessageView): PreparedMessageData {
  return {
    id: msg.msgId,
    threadId: msg.threadId!,
    recipients: msg.recipients || [],
    subject: msg.subject || '',
    attachmentsInfo: msg.attachmentsInfo || [],
    htmlTxtBody: msg.htmlTxtBody,
    plainTxtBody: msg.plainTxtBody,
  };
}
