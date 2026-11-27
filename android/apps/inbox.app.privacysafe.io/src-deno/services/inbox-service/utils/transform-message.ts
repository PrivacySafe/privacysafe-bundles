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
import { generateFastRandomString } from '../../../../shared/utils/generate-random-string.ts';
import { SYSTEM_FOLDERS } from '../../../../src/common/constants/mail-folders-default.ts';
import type {
  AttachmentInfo,
  IncomingMessage,
  IncomingMessageView,
  OutgoingMessage,
  OutgoingMessageView,
} from '../../../../src/common/types/mail.types.ts';
import type { LabelledFileStore } from '../../file-store/labelled-file-store.ts';

const MAX_SUBJECT_LENGTH = 2000;
const MAX_RECIPIENTS = 1000;

async function attachmentsToAttachmentsInfo(
  data: web3n.files.ReadonlyFS,
  msgId: string,
): Promise<AttachmentInfo[]> {
  const result: AttachmentInfo[] = [];
  const list = await data.listFolder('');
  for (const item of list) {
    if (item.isFile) {
      const stats = await data.stat(item.name).catch(() => ({
        isFile: true,
        writable: false,
        size: 0,
      }));
      result.push({
        id: `${msgId}__${generateFastRandomString(3)}`,
        fileName: item.name,
        size: stats.size!,
        type: 'origin',
      });
    }
  }
  return result;
}

export async function incomingMsgToIncomingMsgView(
  data: IncomingMessage,
  mailFolder = SYSTEM_FOLDERS.inbox,
): Promise<IncomingMessageView> {
  const result: IncomingMessageView = {
    mailFolder,
    status: 'received',
    msgId: data.msgId,
    // Taken as the sender wrote it; whether the message may join that thread is
    // decided where the thread is known (threadIdForIncoming in receive.ts).
    threadId: data.jsonBody?.threadId as string,
    msgType: data.msgType,
    deliveryTS: data.deliveryTS,
    sender: data.sender,
    // The rest is the sender's to write, and is taken only in the shape the
    // app reads it in: a non-array `recipients` broke reply-all and the "To"
    // line, a non-string body failed the STRICT table and held the watermark.
    subject: (typeof data.subject === 'string') ? data.subject.substring(0, MAX_SUBJECT_LENGTH) : '',
    recipients: Array.isArray(data.recipients)
      ? data.recipients.filter(r => (typeof r === 'string') && !!r).slice(0, MAX_RECIPIENTS)
      : [],
    ...((typeof data.plainTxtBody === 'string') && data.plainTxtBody && { plainTxtBody: data.plainTxtBody }),
    ...((typeof data.htmlTxtBody === 'string') && data.htmlTxtBody && { htmlTxtBody: data.htmlTxtBody }),
    jsonBody: omitThreadId(data.jsonBody ?? {}),
    attachmentsInfo: [],
  };

  if (data.attachments) {
    result.attachmentsInfo = await attachmentsToAttachmentsInfo(data.attachments, data.msgId);
  }

  return result;
}

function omitThreadId(
  jsonBody: IncomingMessage['jsonBody'],
): IncomingMessageView['jsonBody'] {
  const rest = { ...jsonBody };
  delete rest.threadId;
  return rest;
}

export interface AttachmentFileMissingException extends web3n.RuntimeException {
  type: 'inbox';
  attachmentFileMissing: true;
  fileName: string;
}

function attachmentFileMissingExc(fileName: string): AttachmentFileMissingException {
  return {
    runtimeException: true,
    type: 'inbox',
    attachmentFileMissing: true,
    fileName,
    message: `File '${fileName}' cannot be read, and has to be attached again`,
  };
}

export async function outgoingMsgViewToOutgoingMsg(
  data: OutgoingMessageView,
  fileStore: LabelledFileStore,
): Promise<OutgoingMessage> {
  const result: OutgoingMessage = {
    msgId: data.msgId,
    msgType: data.msgType,
    subject: data.subject,
    recipients: data.recipients,
    ...(data.plainTxtBody && { plainTxtBody: data.plainTxtBody }),
    ...(data.htmlTxtBody && { htmlTxtBody: data.htmlTxtBody }),
    jsonBody: {
      ...data.jsonBody,
      threadId: data.threadId,
    },
  };

  if (data.attachmentsInfo) {
    const attachments: web3n.asmail.AttachmentsContainer = {
      files: {},
    };

    for (const item of data.attachmentsInfo) {
      const { id, fileName } = item;
      if (!id) {
        continue;
      }
      // One path for every kind of attachment: a copy in the store and a link to
      // a file on the device both answer getFile(), and ASMail reads either one
      // lazily while packing. A link whose file the user has moved or deleted
      // fails here - which is the point, rather than sending an empty
      // attachment.
      attachments.files![fileName] = await fileStore.getFile(id).catch(() => {
        throw attachmentFileMissingExc(fileName);
      });
    }

    result.attachments = attachments;
  }

  return result;
}
