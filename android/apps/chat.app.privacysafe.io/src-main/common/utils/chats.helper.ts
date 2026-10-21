/*
 Copyright (C) 2020 - 2025 3NSoft Inc.

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
import dayjs from 'dayjs';
import size from 'lodash/size';
import isEmpty from 'lodash/isEmpty';
import { html2text } from '@v1nt1248/3nclient-lib/utils';
import { messageActions } from '../constants';
import type {
  AddressCheckResult,
  AttachmentsContainer,
  ChatException,
  ChatListItemView,
  ChatMessageAction,
  ChatMessageActionType,
  ChatMessageAttachmentsInfo,
  ChatMessageView,
  FileWithId,
  ReadonlyFsWithId,
  MessageStatus,
  ReadonlyFS,
} from '~/index';
import { getFileStat, getEntityStat } from '@shared/get-stats-safely';
import { useContactsStore } from '@main/common/store/contacts.store';
import { getTextForChatInvitationMessage, getTextForChatSystemMessage, type TranslateFn } from './chat-ui.helper';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ChatsHelper');

/**
 * @param name is the name to show for the attachment, when it is not the
 * entity's own. A pasted file is stored before it can be attached at all, and
 * the stored item's name is made of an id rather than anything worth showing.
 */
export async function prepareAttachmentEntityInfo(
  entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS,
  name?: string,
): Promise<ChatMessageAttachmentsInfo | undefined> {
  if (!entity) {
    return;
  }

  const isFolder = !!(entity as ReadonlyFS).listFolder;
  const attachmentStat = isFolder
    ? { isFolder, size: 0, writable: false }
    : await getFileStat(entity as FileWithId);

  return {
    name: name ?? entity.name,
    size: attachmentStat.size!,
    isFolder,
    ...((entity as ReadonlyFsWithId).id && { id: (entity as ReadonlyFsWithId).id }),
    ...((entity as FileWithId).fileId && { id: (entity as FileWithId).fileId }),
  };
}

export async function getAttachmentFilesInfo({
  files,
  incomingAttachments,
  outgoingAttachments,
}: {
  files?: (web3n.files.ReadonlyFile | web3n.files.ReadonlyFS)[];
  incomingAttachments?: web3n.files.ReadonlyFS;
  outgoingAttachments?: AttachmentsContainer;
}): Promise<ChatMessageAttachmentsInfo[] | undefined> {
  if (isEmpty(files) && isEmpty(incomingAttachments) && isEmpty(outgoingAttachments)) {
    return;
  }

  const attachmentsInfo = [] as ChatMessageAttachmentsInfo[];
  if (!isEmpty(incomingAttachments)) {
    const entities = await incomingAttachments.listFolder('/');
    for (const entity of entities) {
      const entityStat = await getEntityStat(incomingAttachments, entity.name, entity.isFile);
      attachmentsInfo.push({ name: entity.name, size: entityStat.size || 0 });
    }
  } else {
    const processedEntities = !isEmpty(files)
      ? files
      : [...Object.values(outgoingAttachments!.files!), ...Object.values(outgoingAttachments!.folders!)];
    for (const entity of processedEntities!) {
      const entityStat = (entity as ReadonlyFsWithId).listFolder
        ? {
            name: entity.name,
            size: 0,
            isFolder: true,
            ...((entity as ReadonlyFsWithId).id && { id: (entity as ReadonlyFsWithId).id }),
          }
        : {
            name: entity.name,
            size: (await getFileStat(entity as FileWithId)).size!,
            isFolder: false,
            ...((entity as FileWithId).fileId && { id: (entity as FileWithId).fileId }),
          };

      attachmentsInfo.push(entityStat);
    }
  }

  return attachmentsInfo;
}

function prepareMsgDataToExport(
  t: TranslateFn,
  msg: ChatMessageView,
  ownAddr: string,
  getContactName: (val: string) => string,
): string {
  const { chatMessageType: type, isIncomingMsg, timestamp, sender } = msg;

  const dateValue = dayjs(timestamp);

  const dateTime = dateValue.format('YYYY-MM-DD HH:mm:ss');

  const author = getContactName(isIncomingMsg ? sender : ownAddr);

  const text =
    type === 'system'
      ? getTextForChatSystemMessage(t, msg, msg.chatId.isGroupChat, ownAddr)
      : type === 'invitation'
        ? getTextForChatInvitationMessage(t, msg)
        : html2text(msg.body);

  const attachInfo =
    type !== 'regular' || isEmpty(msg.attachments) ? '' : msg.attachments!.map(i => i.name).join(', ');

  let value = type === 'regular' ? `${dateTime} ${author}(${isIncomingMsg ? sender : ownAddr})` : `${dateTime}`;

  if (text) {
    value += `\n${text}`;
  }

  if (attachInfo) {
    value += `\n[${attachInfo}]`;
  }

  value += '\n';

  return value;
}

export async function exportChatMessages({
  t,
  chat,
  messages = [],
  ownAddr,
}: {
  t: (key: string, placeholders?: Record<string, string>) => string;
  chat: ChatListItemView;
  messages: ChatMessageView[];
  ownAddr: string;
}): Promise<boolean | undefined> {
  const { name: chatName } = chat;

  const { getContactName } = useContactsStore();
  const chatContent = messages
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(m => prepareMsgDataToExport(t, m, ownAddr, getContactName))
    .join('\n');

  if (w3n.shell?.fileDialogs?.saveFileDialog) {
    const outFile = await w3n.shell?.fileDialogs?.saveFileDialog(
      t('chat.dialog.export.title'),
      t('app.text.save'),
      `${chatName}.txt`,
    );
    if (outFile) {
      try {
        await (outFile as web3n.files.WritableFile).writeTxt(chatContent);
        return true;
      } catch (e) {
        log.error('Error chat messages content saving. ', e);
        return false;
      }
    }
  }
}

function checkAction({
  messageType,
  status,
  hasAttachments,
  condition,
  timestamp,
}: {
  messageType: 'incoming' | 'outgoing';
  status: MessageStatus | undefined;
  hasAttachments: boolean;
  condition: string;
  timestamp: number;
}): boolean {
  const [msgType, msgStatusAsString, areAttachmentsPresent, lifetime] = condition.split(':') as [
    'incoming' | 'outgoing' | '',
    string,
    'true' | 'false' | '',
    string,
  ];

  const typeMatches = msgType ? messageType === msgType : true;

  const statusMatches =
    !msgStatusAsString || !status ? true : (msgStatusAsString.split(',') as MessageStatus[]).includes(status);

  const attachmentsMatches = !areAttachmentsPresent
    ? true
    : (hasAttachments && areAttachmentsPresent === 'true') ||
      (!hasAttachments && areAttachmentsPresent === 'false');

  let timestampMatches;
  if (!lifetime || (lifetime && !lifetime.includes('>') && !lifetime.includes('<'))) {
    timestampMatches = true;
  } else {
    const timestampCondition = lifetime[0] as '>' | '<';
    const timestampValueAsString = lifetime.slice(1);
    const timestampValue = isNaN(Number(timestampValueAsString)) ? Date.now() : Number(timestampValueAsString);
    const timestampDiff = Date.now() - timestamp;
    timestampMatches =
      timestampCondition === '>' ? timestampDiff > timestampValue : timestampDiff < timestampValue;
  }

  return typeMatches && statusMatches && attachmentsMatches && timestampMatches;
}

const ORIGIN_DEVICE_ONLY_ACTIONS: ChatMessageActionType[] = ['resend', 'cancel_sending', 'edit', 'download'];
const DELETE_BLOCKED_STATUSES: MessageStatus[] = ['sending', 'syncing_self'];

export function getMessageActions(
  msg: ChatMessageView,
  t: (txt: string) => string,
  readonly?: boolean,
  isOriginDevice = true,
): Omit<ChatMessageAction, 'conditions'>[] {
  const { isIncomingMsg, status, timestamp } = msg;
  const messageType = isIncomingMsg ? 'incoming' : 'outgoing';
  return messageActions
    .filter(action => {
      const { conditions, allowInReadonlyMode, disabled = false } = action;
      if (disabled) {
        return false;
      }

      if (readonly && !allowInReadonlyMode) {
        return false;
      }

      if (!isOriginDevice && !isIncomingMsg) {
        if (ORIGIN_DEVICE_ONLY_ACTIONS.includes(action.id)) {
          return false;
        }
        if (action.id === 'delete_message' && status && DELETE_BLOCKED_STATUSES.includes(status)) {
          return false;
        }
      }

      if (isEmpty(conditions)) {
        return true;
      }

      let isAllowedAction = false;
      for (const condition of conditions) {
        const hasAttachments = msg.chatMessageType === 'regular' && !!size(msg.attachments);
        isAllowedAction =
          isAllowedAction || checkAction({ messageType, status, hasAttachments, condition, timestamp });
        if (isAllowedAction) {
          break;
        }
      }

      return isAllowedAction;
    })
    .map(item => ({
      ...item,
      title: t(item.title),
    }));
}

export function makeChatException(fields: Partial<ChatException>): ChatException {
  return {
    ...fields,
    runtimeException: true,
    type: 'chat',
  };
}

export function prepareCheckAddrErrorText(
  addr: string,
  cause: AddressCheckResult,
  t: (txt: string, placeholder?: Record<string, string>) => string,
) {
  if (cause === 'not-present-at-domain') {
    return t('validation.text.unknownRecipient', { addr });
  }

  if (cause === 'found') {
    return t('validation.text.inboxIsFull', { addr });
  }

  if (cause === 'found-but-access-restricted') {
    return t('validation.text.senderNotAllowed', { addr });
  }

  if (cause === 'not-valid-public-key') {
    return t('validation.text.recipientPubKeyFailsValidation', { addr });
  }

  if (cause === 'no-service-for-domain') {
    return t('validation.text.serviceLocating', { addr });
  }

  return t('validation.text.unknown', { addr });
}

export function prepareMessageBody(inputText: string) {
  const mentionPattern = /@.*?]/g;
  let processedText = inputText.replace(mentionPattern, match => {
    return `<a class="mention" data-mention="${match}">${match}</a>`;
  });

  const urlPattern = /(?:https?|w3n):\/\/[^\s]+|(?<!\S|@)[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*[^.,?\s])?/g;
  const combinedPattern = new RegExp(`(<a[^>]*>.*?</a>)|(${urlPattern.source})`, 'gi');

  processedText = processedText.replace(combinedPattern, (match, tagGroup, urlGroup) => {
    if (tagGroup) {
      return tagGroup;
    }

    if (urlGroup) {
      return `<a class="url" data-href="${urlGroup}">${urlGroup}</a>`;
    }

    return match;
  });

  return processedText;
}

export function restoreRawMessage(htmlMessage: string) {
  const anyTagPattern = /<a class="(?:url|mention)"[^>]*>([\s\S]*?)<\/a>/g;

  return htmlMessage.replace(anyTagPattern, (_, innerText) => innerText);
}
