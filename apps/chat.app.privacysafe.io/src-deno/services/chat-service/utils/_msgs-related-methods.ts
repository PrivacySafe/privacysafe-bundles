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
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ChatIdObj,
  ChatMessageId,
  ChatIncomingMessage,
  ChatInvitationMsgV1,
  ChatMessageJsonBody,
  ChatSyncMsgV1,
  ChatSystemMessageData,
  ChatSystemMsgV1,
  InvitationProcessMsgData,
  PhantomSyncMsgDataBasedOnRegularMsgV1,
  RecordedMediaInMsg,
  StoredInvitationParams,
  UpdatedMembersInvitationData,
} from '../../../../types/asmail-msgs.types.ts';
import type {
  ChatMessageAttachmentsInfo,
  ChatMessageView,
  MessageStatus,
  RegularMsgView,
} from '../../../../types/chat.types.ts';
import type {
  ChatDbEntry,
  FileStoreService,
  GroupChatDbEntry,
  MsgDbEntry,
  MsgsDb,
  RefsToMsgsDataNoInDB,
} from '../../../types/index.ts';
import { toCanonicalAddress } from '../../../../shared-libs/address-utils.ts';
import { THUMBNAIL_CACHE_MAX_CHARS } from '../../../../shared-libs/constants/attachment-limits.ts';
import { inviteChatId, isString } from './_common.ts';
import { removeMessageFromInbox, removeMsgFromDelivery } from '../../../utils/inbox-utils.ts';

export { removeMessageFromInbox, removeMsgFromDelivery };

export function msgDbEntryToChatMessageView(data: MsgDbEntry): ChatMessageView {
  const {
    groupChatId,
    otoPeerCAddr,
    chatMessageId,
    isIncomingMsg,
    incomingMsgId,
    groupSender,
    body,
    attachments,
    chatMessageType,
    status,
    timestamp,
  } = data;

  const isGroupChat = !!groupChatId;

  let systemData: ChatSystemMessageData | undefined;
  let inviteData: StoredInvitationParams | undefined;

  if (chatMessageType === 'system' && body) {
    try {
      systemData = JSON.parse(body) as ChatSystemMessageData;
    } catch {
      systemData = undefined;
    }
  } else if (chatMessageType === 'invitation' && body) {
    try {
      inviteData = JSON.parse(body) as StoredInvitationParams;
    } catch {
      inviteData = undefined;
    }
  }

  return {
    chatId: { isGroupChat, chatId: isGroupChat ? groupChatId! : otoPeerCAddr! },
    chatMessageId,
    timestamp,
    isIncomingMsg,
    incomingMsgId: incomingMsgId || undefined,
    sender: isIncomingMsg ? groupSender || otoPeerCAddr! : '',
    chatMessageType,
    status: status || undefined,
    attachments: attachments || undefined,
    ...(chatMessageType === 'regular' && { body }),
    ...(systemData && { systemData }),
    ...(inviteData && { inviteData }),
  } as ChatMessageView;
}

export function msgDbEntryForIncomingSysMsg(
  sender: string,
  chatId: ChatIdObj,
  chatMessageId: string,
  timestamp: number,
  chatSystemData: ChatSystemMessageData,
): MsgDbEntry {
  return {
    isIncomingMsg: true,
    chatMessageId,
    chatMessageType: 'system',
    otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
    groupChatId: chatId.isGroupChat ? chatId.chatId : null,
    status: null,
    groupSender: chatId.isGroupChat ? sender : null,
    timestamp,
    removeAfter: 0,
    body: JSON.stringify(chatSystemData),
    attachments: null,
    history: null,
    incomingMsgId: null,
    reactions: null,
    settings: null,
    relatedMessage: null,
  };
}

export function msgViewFromDbEntry(
  msgDbEntry: MsgDbEntry,
  relatedMessage: RegularMsgView['relatedMessage'],
  ownAddr: string,
): ChatMessageView {
  const {
    attachments,
    body,
    chatMessageId,
    chatMessageType,
    groupChatId,
    groupSender,
    incomingMsgId,
    isIncomingMsg,
    otoPeerCAddr,
    status,
    timestamp,
    removeAfter,
    history,
    reactions,
    settings,
  } = msgDbEntry;

  const chatId: ChatIdObj = {
    isGroupChat: !!groupChatId,
    chatId: groupChatId ? groupChatId : otoPeerCAddr!,
  };
  const sender = chatId.isGroupChat
    ? (groupSender || ownAddr)
    : (isIncomingMsg ? otoPeerCAddr! : ownAddr);

  switch (chatMessageType) {
    case 'regular':
      return {
        chatId,
        chatMessageId,
        isIncomingMsg,
        incomingMsgId: incomingMsgId ?? undefined,
        chatMessageType,
        timestamp,
        removeAfter,
        sender,
        body: body ?? '',
        attachments: attachments ?? undefined,
        relatedMessage,
        status: status!,
        history: history ?? undefined,
        reactions: reactions ?? undefined,
        settings: (settings ?? {}) as RegularMsgView['settings'],
      } as RegularMsgView;

    case 'system': {
      let systemData: ChatSystemMessageData;

      try {
        systemData = JSON.parse(body!);
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        systemData = {} as any;
      }

      return {
        chatId,
        chatMessageId,
        isIncomingMsg,
        chatMessageType,
        timestamp,
        sender,
        systemData,
      };
    }

    default: {
      let inviteData: Exclude<InvitationProcessMsgData, UpdatedMembersInvitationData>;
      try {
        inviteData = JSON.parse(body!);
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inviteData = {} as any;
      }
      return {
        chatId,
        chatMessageId,
        isIncomingMsg,
        chatMessageType,
        timestamp,
        sender,
        inviteData,
      };
    }
  }
}

export function makeMsgDbEntry(
  chatMessageType: MsgDbEntry['chatMessageType'],
  chatMessageId: string,
  params: Partial<MsgDbEntry>,
): MsgDbEntry {
  return {
    isIncomingMsg: false,
    incomingMsgId: null,
    groupChatId: null,
    otoPeerCAddr: null,
    attachments: null,
    body: null,
    groupSender: null,
    history: null,
    reactions: null,
    relatedMessage: null,
    status: chatMessageType === 'regular' ? (params.isIncomingMsg ? 'unread' : 'sending') : null,
    settings: null,
    removeAfter: 0,
    timestamp: 0,
    ...params,
    chatMessageType,
    chatMessageId,
  };
}

export async function removeAttachmentsOfOutgoingMsg(
  attachments: ChatMessageAttachmentsInfo[],
  filesStore: FileStoreService,
): Promise<void> {
  for (const { id } of attachments) {
    if (id) {
      await filesStore.deleteEntity(id);
    }
  }
}


/**
 * Removes a message and everything of it that does not live in the database:
 * the inbox message an incoming record is built from, and the attachment bytes
 * of an outgoing one.
 *
 * The single place this rule lives, deliberately: the local deletion path, the
 * path driven by a phantom of another device, and a restore all have to remove
 * the same three things, and a second implementation of the rule is how the
 * phantom path came to remove only the database row (leaving inbox messages and
 * attachment bytes behind forever).
 *
 * The subtlety worth keeping: a record synchronized from another device
 * (settings.msgOwnersDeviceId set) is not incoming, yet its attachments[].id
 * point into THAT device's file store. They are not ours to delete, and an id
 * that happens to collide locally would take a stranger's file with it.
 */
export async function removeMsgBytes(
  data: Pick<MsgsDb, 'deleteMessage'>,
  filesStore: FileStoreService,
  id: ChatMessageId,
  msg: Pick<MsgDbEntry, 'isIncomingMsg' | 'incomingMsgId' | 'attachments' | 'settings'>,
): Promise<void> {
  const { isIncomingMsg, incomingMsgId, attachments, settings } = msg;
  await data.deleteMessage(id);
  if (isIncomingMsg && incomingMsgId) {
    await removeMessageFromInbox(incomingMsgId);
  } else if (!isIncomingMsg && attachments && !settings?.msgOwnersDeviceId) {
    await removeAttachmentsOfOutgoingMsg(attachments, filesStore);
  }
}

export async function removeMsgDataNotInDB(
  refs: RefsToMsgsDataNoInDB,
  filesStore: FileStoreService,
): Promise<void> {
  for (const msgId of refs.inboxMsgs) {
    await removeMessageFromInbox(msgId);
  }

  for (const { attachments } of refs.outgoingMsgs) {
    await removeAttachmentsOfOutgoingMsg(attachments, filesStore);
  }
}

export function canReceiveRegularMessages(chat: ChatDbEntry, ownAddr: string): boolean {
  const { isGroupChat, status } = chat;
  if (isGroupChat) {
    const { members } = chat as GroupChatDbEntry;
    const { hasAccepted } = members[ownAddr];
    return hasAccepted && ['on', 'partially-on', 'accepted'].includes(status);
  }

  return ['on', 'accepted'].includes(status);
}

export function checkV1(jbV1: ChatMessageJsonBody, sender: string): ChatIdObj | undefined {
  const { groupChatId, chatMessageType } = jbV1;

  switch (chatMessageType) {
    case 'invitation': {
      const { chatMessageId, inviteData } = jbV1;
      if (!isString(chatMessageId)) {
        return;
      }
      return inviteChatId(sender, inviteData);
    }

    case 'system': {
      const { chatSystemData } = jbV1;
      if (!chatSystemData || typeof chatSystemData !== 'object') {
        return;
      }
      break;
    }

    case 'synchronization': {
      const { value } = jbV1;
      if (!value || typeof value !== 'object') {
        return;
      }
      break;
    }

    case 'regular': {
      const { chatMessageId } = jbV1;
      if (!isString(chatMessageId)) {
        return;
      }
      break;
    }

    default:
      return;
  }

  if (typeof groupChatId === 'string' && groupChatId) {
    return !groupChatId.includes('@') ? { isGroupChat: true, chatId: groupChatId } : undefined;
  }

  return { isGroupChat: false, chatId: toCanonicalAddress(sender) };
}

export function checkChatMessageJSON(msg: ChatIncomingMessage):
  | {
      chatMsgBody: ChatMessageJsonBody;
      chatId: ChatIdObj;
    }
  | undefined {
  const { sender, jsonBody } = msg;
  if (jsonBody.v === 1) {
    const chatId = checkV1(jsonBody, sender);
    return chatId ? { chatId, chatMsgBody: jsonBody } : undefined;
  }
}

export async function getIncomingMessage(msgId: string): Promise<ChatIncomingMessage | undefined> {
  try {
    return (await w3n.mail!.inbox.getMsg(msgId)) as ChatIncomingMessage;
  } catch (e) {
    await w3n.log('error', `Error getting the message ${msgId}.`, e);
  }
}

/**
 * An attachment list as it may travel to another device of the same user.
 *
 * `id` is a reference into THIS device's file store and means nothing anywhere
 * else - worse, it can collide with a local id there - so it is cut out and the
 * attachment is marked as having no local source. A message without files must
 * carry no field at all rather than an empty list: `[]` is truthy, and on the
 * receiving device it reads as "there are files, they are just elsewhere".
 *
 * Exported and used by both the phantom of a regular message and a restore
 * snapshot, so that the removal of `id` lives in exactly one place. Both have
 * the same problem to solve, and a snapshot that forgot to strip it would put
 * ids of a stranger's store into a neighbour's records.
 */
export function attachmentsForPhantom(
  attachments: ChatMessageAttachmentsInfo[] | null | undefined,
  sourceDeviceId: string,
): ChatMessageAttachmentsInfo[] | undefined {
  return attachments?.length
    ? attachments.map(({ id: _id, ...rest }) => ({
        ...rest,
        hasNoLocalSource: true,
        originDeviceId: sourceDeviceId,
      }))
    : undefined;
}

/**
 * Puts a preview into the previews table, unless it is too big to keep.
 *
 * The database file is rewritten whole on every save, so an outsized preview
 * would be paid for on every write from then on. Dropping it costs only that
 * it has to be made again next time, and the caller is not told - it keeps
 * showing the preview it made, which is exactly the intent.
 *
 * Here rather than inline in the service because there are now two callers -
 * the GUI, which asks for a preview it made, and the sending and receiving of
 * a recording, whose preview travels with the message - and a cap enforced in
 * two places is a cap that will end up different in two places.
 */
export async function saveThumbnailWithinLimit(
  db: Pick<MsgsDb, 'upsertThumbnail'>,
  id: ChatMessageId,
  fileName: string,
  dataUrl: string,
): Promise<void> {
  if (dataUrl.length > THUMBNAIL_CACHE_MAX_CHARS) {
    return;
  }
  await db.upsertThumbnail(id, fileName, dataUrl);
}

/**
 * What a message body should say about the recordings among its attachments.
 *
 * Read off the record rather than off the outgoing wrappers, so that a message
 * SENT AGAIN says the same thing about its recordings as the first attempt did.
 * There is no preview here on purpose: by the time a message is re-sent its
 * preview is already in the previews table, and repeating it in the body would
 * put a data URL on the wire for nothing.
 */
export function recordingsOfAttachments(
  attachments: ChatMessageAttachmentsInfo[] | null | undefined,
): Record<string, RecordedMediaInMsg> | undefined {
  if (!attachments?.length) {
    return undefined;
  }
  const recordings: Record<string, RecordedMediaInMsg> = {};
  for (const { name, recording } of attachments) {
    if (recording) {
      recordings[name] = { kind: recording.kind, durationMs: recording.durationMs };
    }
  }
  return (Object.keys(recordings).length > 0) ? recordings : undefined;
}

/**
 * Marks the attachments an incoming message says are recordings.
 *
 * Matched by name, which is what the sender keyed the body's `recordings` by:
 * the attachments folder of an ASMail message promises no order, so an index
 * would pair a duration with whichever file happened to be listed first.
 *
 * Kept apart from reading the folder so that this - the part that can pair
 * things up wrongly - is a pure function.
 */
export function withRecordingsApplied(
  attachments: ChatMessageAttachmentsInfo[] | null,
  recordings: Record<string, RecordedMediaInMsg> | undefined,
): ChatMessageAttachmentsInfo[] | null {
  if (!attachments?.length || !recordings) {
    return attachments;
  }
  return attachments.map(item => {
    const recorded = recordings[item.name];
    // The preview does not go into the record - only the kind and duration do.
    return recorded
      ? { ...item, recording: { kind: recorded.kind, durationMs: recorded.durationMs } }
      : item;
  });
}

export function createSyncMsgBasedOnRegularMsg({
  msg,
  sourceDeviceId,
  timestamp,
}: {
  msg: MsgDbEntry;
  sourceDeviceId: string;
  timestamp: number;
}): ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1> {
  const {
    groupChatId, otoPeerCAddr, chatMessageId, body, relatedMessage, attachments,
    status, history, isIncomingMsg, groupSender,
  } = msg;

  const isGroupChat = !!groupChatId;
  const chatId = (isGroupChat ? groupChatId : otoPeerCAddr)!;

  const syncedAttachments = attachmentsForPhantom(attachments, sourceDeviceId);

  return {
    v: 1,
    chatMessageType: 'synchronization',
    sourceDeviceId,
    timestamp,
    chatId: { isGroupChat, chatId },
    value: {
      v: 1,
      chatMessageType: 'regular',
      groupChatId: groupChatId || undefined,
      chatMessageId,
      text: body || '',
      relatedMessage: relatedMessage || undefined,
      attachments: syncedAttachments,
      status: status || undefined,
      history: history || undefined,
      // Only a resync answer carries an incoming record (see the field's doc);
      // fresh outgoing records leave these fields out.
      ...(isIncomingMsg && {
        isIncomingMsg: true,
        groupSender: groupSender || undefined,
      }),
    },
  };
}

/**
 * Maps status of an outgoing message on its originating device into a status
 * for a record on other devices of the same user.
 * Terminal statuses are taken as is, while non-terminal ones become
 * 'syncing_self': other devices don't take part in sending and can't influence
 * it, so they display such a message as awaiting synchronization.
 */
export function statusForSyncedOutgoingMsg(originStatus: MessageStatus | null | undefined): MessageStatus {
  return isTerminalStatus(originStatus) ? originStatus! : 'syncing_self';
}

/**
 * Tells if a message status is a final one, i.e. sending of the message is over.
 */
export function isTerminalStatus(status: MessageStatus | null | undefined): boolean {
  return !!status && TERMINAL_STATUSES.includes(status);
}

const TERMINAL_STATUSES: MessageStatus[] = ['sent', 'error', 'canceled', 'read', 'unread'];

export function createSyncMsgBasedOnSystemMsg({
  chatId,
  msg,
  sourceDeviceId,
  timestamp,
}: {
  chatId: ChatIdObj;
  msg: ChatSystemMsgV1;
  sourceDeviceId: string;
  timestamp: number;
}): ChatSyncMsgV1<ChatSystemMsgV1> {
  const { chatMessageId, groupChatId, chatSystemData } = msg;

  return {
    v: 1,
    chatMessageType: 'synchronization',
    sourceDeviceId,
    timestamp,
    chatId,
    value: {
      v: 1,
      chatMessageType: 'system',
      groupChatId,
      chatMessageId,
      chatSystemData,
    },
  };
}

export function createSyncMsgBasedOnInvitationMsg({
  chatId,
  msg,
  sourceDeviceId,
  timestamp,
}: {
  chatId: ChatIdObj;
  msg: Pick<ChatInvitationMsgV1, 'chatMessageId' | 'inviteData'>;
  sourceDeviceId: string;
  timestamp: number;
}): ChatSyncMsgV1<ChatInvitationMsgV1> {
  const { chatMessageId, inviteData } = msg;

  return {
    v: 1,
    chatMessageType: 'synchronization',
    sourceDeviceId,
    timestamp,
    chatId,
    chatMessageId,
    value: {
      v: 1,
      chatMessageType: 'invitation',
      chatMessageId,
      inviteData,
    },
  };
}
