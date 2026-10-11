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
// @ts-ignore
import { excerpt } from 'jsr:@dbushell/hyperless';
import type {
  ChatIdObj,
  ChatIncomingMessage,
  ChatMessageId,
  ChatRegularMsgV1,
  RecordedMediaInMsg,
  RelatedMessage,
} from '../../../../types/asmail-msgs.types.ts';
import type { ChatMessageAttachmentsInfo, OutgoingAttachment } from '../../../../types/chat.types.ts';
import type { OpenChatCmdArg } from '../../../../types/chat-commands.types.ts';
import type { AttachmentsContainer, ReadonlyFsWithId } from '../../../../types/app.types.ts';
import type { ChatDbEntry, ChatSrvEmit, DB, FileStoreService, MsgDbEntry } from '../../../types/index.ts';
import { LOGO_ICON_AS_ARRAY } from '../../../../src-main/common/constants/files.ts';
import { AUTO_DELETE_MESSAGES_BY_ID, AUTODELETE_OFF } from '../../../../shared-libs/constants/chat-settings.ts';
import { ATTACHMENT_COPY_THRESHOLD } from '../../../../shared-libs/constants/attachment-limits.ts';
import { addFolderTo, addFileTo } from '../../../../shared-libs/attachments-container.ts';
import { generateChatMessageId } from '../../../../shared-libs/chat-ids.ts';
import { getEntityStat } from '../../../../shared-libs/get-stats-safely.ts';
import { folderSizeUpTo } from '../../../../shared-libs/folder-size.ts';
import { AppSettings } from '../../../utils/app-settings.ts';
import { makeDbRecordException } from '../../../utils/exceptions.ts';
import { replaceSystemNotification } from '../../../utils/system-notifications.ts';
import {
  makeMsgRecordPhantom,
  queueSyncPhantom,
  sendRegularMessage as _sendRegularMessage,
  sendSystemMessage,
} from '../../mail-sending-service/index.ts';
import { chatIdOfChat, recipientsInChat } from './_chats-related-methods.ts';
import {
  createSyncMsgBasedOnRegularMsg,
  makeMsgDbEntry,
  recordingsOfAttachments,
  saveThumbnailWithinLimit,
  withRecordingsApplied,
} from './_msgs-related-methods.ts';
import { msgEntityId } from './sync-versions.ts';

export async function msgSending({
  data,
  emit,
  filesStore,
  appSettings,
  ownAddr,
  getAppDeviceId,
  nextSyncStamp,
}: {
  data: DB;
  emit: ChatSrvEmit;
  filesStore: FileStoreService;
  appSettings: AppSettings;
  ownAddr: string;
  getAppDeviceId: () => string;
  nextSyncStamp: () => Promise<number>;
}) {
  /**
   * Size of an attachment, and whether it is small enough to be worth copying.
   *
   * A size that could not be established counts as too big: it must not fall
   * into the copying branch, where a file that cannot even be measured would
   * only fail later. Note that `getFileStat` cannot be used here for the same
   * reason - it answers 0 for a file it failed to stat.
   */
  async function sizeOfAttachment(
    entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS,
    isFolder: boolean,
  ): Promise<{ size: number; worthCopying: boolean }> {
    if (isFolder) {
      const { size, exceeded } = await folderSizeUpTo(
        entity as web3n.files.ReadonlyFS,
        ATTACHMENT_COPY_THRESHOLD,
      );
      // A walk that stopped early knows no total, and 0 is what a folder's size
      // has always been in this record - the GUI computes it for display.
      return exceeded ? { size: 0, worthCopying: false } : { size, worthCopying: true };
    }

    try {
      const { size = 0 } = await (entity as web3n.files.ReadonlyFile).stat();
      return { size, worthCopying: size <= ATTACHMENT_COPY_THRESHOLD };
    } catch (exc) {
      await w3n.log('error', `Fail to stat the file ${entity.name} being attached`, exc);
      return { size: 0, worthCopying: false };
    }
  }

  /**
   * Puts an attachment into this app's file store and returns the id under
   * which the message will refer to it, together with the entity the message
   * should actually carry.
   *
   * A copy is sent as the copy, not as the file it was made from: delivery reads
   * attachments lazily, long after the message was queued, and reading the copy
   * is the whole point of having made one.
   */
  async function storeAttachment(
    entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS,
    worthCopying: boolean,
  ): Promise<{ id?: string; toSend: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS }> {
    if (worthCopying) {
      try {
        const id = await filesStore.saveCopy(entity);
        const copy = await filesStore.getFile(id);
        if (copy) {
          return { id, toSend: copy as web3n.files.ReadonlyFile | web3n.files.ReadonlyFS };
        }
        await w3n.log('error', `Copy ${id} of the attachment ${entity.name} cannot be read back`);
      } catch (exc) {
        await w3n.log('error', `Fail to copy the attachment ${entity.name} into the store`, exc);
      }
    }

    try {
      return { id: await filesStore.saveLink(entity), toSend: entity };
    } catch (exc) {
      // The message still goes out with the file in it; what is lost is only
      // this device's own way back to the attachment. Recorded without an id,
      // which every reader already treats as "nothing to read here", instead of
      // with an id that leads nowhere.
      await w3n.log('error', `Fail to store the attachment ${entity.name}`, exc);
      return { toSend: entity };
    }
  }

  async function prepOutgoingAttachments(entities: OutgoingAttachment[] | undefined): Promise<{
    attachments: ChatMessageAttachmentsInfo[] | null;
    attachmentContainer?: AttachmentsContainer;
    /**
     * What goes into the message body for the recordings among these
     * attachments, previews included. Built here and not from `attachments`
     * because the preview is only ever on the outgoing wrapper: it belongs in
     * the preview table, not in the message record.
     */
    recordings?: Record<string, RecordedMediaInMsg>;
  }> {
    if (!entities || entities.length === 0) {
      return { attachments: null };
    }

    const attachments: ChatMessageAttachmentsInfo[] = [];
    const attachmentContainer = {} as AttachmentsContainer;
    const recordings: Record<string, RecordedMediaInMsg> = {};
    for (const { entity, storedId, name, recording } of entities) {
      const isFolder = !!(entity as ReadonlyFsWithId).listFolder;
      const { size, worthCopying } = await sizeOfAttachment(entity, isFolder);

      // An entity that came with a stored id is already in the store, and
      // neither a copy nor a link is made for it: the id it arrived with is the
      // attachment's id, and its bytes are held exactly once.
      const { id, toSend } = storedId
        ? { id: storedId, toSend: entity }
        : await storeAttachment(entity, worthCopying);

      // Named explicitly, and not left to the container to take from the entity
      // it is given: a stored copy is named after its id, which is no name to
      // send anybody.
      const attachmentName = name ?? entity.name;

      attachments.push({
        name: attachmentName,
        size,
        isFolder,
        ...(id && { id }),
        // The preview is deliberately left out of the record: it goes into the
        // previews table, which is where every other preview is looked up.
        ...(recording && { recording: { kind: recording.kind, durationMs: recording.durationMs } }),
      });

      if (recording) {
        recordings[attachmentName] = {
          kind: recording.kind,
          durationMs: recording.durationMs,
          ...(recording.preview && { preview: recording.preview }),
        };
      }

      if (isFolder) {
        addFolderTo(attachmentContainer, toSend as web3n.files.ReadonlyFS, attachmentName);
      } else {
        addFileTo(attachmentContainer, toSend as web3n.files.ReadonlyFile, attachmentName);
      }
    }
    return {
      attachments,
      attachmentContainer,
      ...(Object.keys(recordings).length > 0 && { recordings }),
    };
  }

  /**
   * Container for a message that is being sent again: its attachments are
   * already in the store, and the store is where they are read from. Storing
   * them anew - which is what calling prepOutgoingAttachments here used to do -
   * left one more copy of every file behind on each attempt.
   */
  async function containerOfStoredAttachments(
    attachments: ChatMessageAttachmentsInfo[] | null,
  ): Promise<AttachmentsContainer | undefined> {
    if (!attachments || attachments.length === 0) {
      return;
    }

    const attachmentContainer = {} as AttachmentsContainer;
    for (const { id, name, isFolder } of attachments) {
      if (!id) {
        continue;
      }

      const entity = await filesStore.getFile(id);
      if (!entity) {
        await w3n.log('error', `Attachment ${name} of a message being resent cannot be read`);
        continue;
      }

      if (isFolder) {
        addFolderTo(attachmentContainer, entity as web3n.files.ReadonlyFS, name);
      } else {
        addFileTo(attachmentContainer, entity as web3n.files.ReadonlyFile, name);
      }
    }
    return attachmentContainer;
  }

  async function infoOfIncomingAttachments(
    attachmentsFS: web3n.files.ReadonlyFS | undefined,
  ): Promise<ChatMessageAttachmentsInfo[] | null> {
    if (!attachmentsFS) {
      return null;
    }

    const info: ChatMessageAttachmentsInfo[] = [];
    for (const entry of await attachmentsFS.listFolder('')) {
      if (entry.isFile) {
        const stats = await getEntityStat(attachmentsFS, entry.name, true);
        info.push({
          name: entry.name,
          size: stats.size!,
          isFolder: false,
        });
      } else {
        info.push({
          name: entry.name,
          size: 0,
          isFolder: true,
        });
      }
    }
    return info;
  }

  async function sendRegularMessage({
    chatId,
    chatMessageId,
    text,
    files,
    relatedMessage,
  }: {
    chatId: ChatIdObj;
    chatMessageId?: string;
    text: string;
    files: OutgoingAttachment[] | undefined;
    relatedMessage: RelatedMessage | undefined;
  }): Promise<void> {
    const chat = data.findChat(chatId);
    if (!chat) {
      throw makeDbRecordException({ chatNotFound: true });
    }

    const { timestamp, chatMessageId: newChatMessageId } = generateChatMessageId();
    const msgId = chatMessageId || newChatMessageId;

    const existingMsg = await data.getMessage({ chatId, chatMessageId: msgId });

    if (existingMsg) {
      const updatedMsg = await data.updateMessageRecord({ chatId, chatMessageId: msgId }, { status: 'sending' });

      // Record of the message already exists on other devices, only its status
      // needs to get back to a non-terminal one there.
      if (updatedMsg) {
        await sendStatusSyncMsg(chatId, updatedMsg);
      }

      const attachmentContainer = await containerOfStoredAttachments(existingMsg.attachments);
      const recipients = recipientsInChat(chat, ownAddr);
      await _sendRegularMessage(
        chatId,
        msgId,
        recipients,
        text,
        attachmentContainer,
        relatedMessage,
        recordingsOfAttachments(existingMsg.attachments),
      );
      return;
    }

    const { settings } = chat;
    const autoDeleteMessagesId = settings?.autoDeleteMessages as '0' | '1' | '2' | '3' | '4' | '5';
    const autoDeleteTSValue = AUTO_DELETE_MESSAGES_BY_ID[autoDeleteMessagesId].value || AUTODELETE_OFF;

    const { attachments, attachmentContainer, recordings } = await prepOutgoingAttachments(files);

    const msg = makeMsgDbEntry('regular', msgId, {
      groupChatId: chat.isGroupChat ? chat.chatId : null,
      otoPeerCAddr: chat.isGroupChat ? null : chat.peerCAddr,
      timestamp,
      removeAfter: autoDeleteMessagesId === '0' ? 0 : timestamp + autoDeleteTSValue,
      body: text,
      attachments,
      relatedMessage: relatedMessage ?? null,
      settings: {},
    });

    await data.addMessage(msg);

    // The sender's own preview, and it has to be put here rather than made on
    // demand: a recording is far bigger than THUMBNAIL_AUTO_PREVIEW_LIMIT, so
    // without this the sender's own chip would show a file icon for a video
    // they just took.
    await storeRecordingPreviews({ chatId, chatMessageId: msgId }, recordings);

    // Phantom (sync) message goes out optimistically, right after the record is
    // placed into a database, and not on a delivery to peers being done. Own
    // devices should learn about the message even if peers are unreachable, and
    // phantoms of subsequent changes (reactions, edits, status) reference it.
    // Terminal status is synchronized later, with 'update:msg-record' phantom.
    await sendSyncMsgOfRegularMsg(chatId, msg);

    const recipients = recipientsInChat(chat, ownAddr);
    await _sendRegularMessage(
      chatId,
      msgId,
      recipients,
      text,
      attachmentContainer,
      relatedMessage,
      recordings,
    );
    emit.message.added(msg);
  }

  /**
   * Puts the previews a message's recordings carry into the previews table.
   *
   * Same call on both sides - the sender does it for the previews it just made,
   * the recipient for the ones that arrived - so that a recording's frame is
   * looked up exactly where every other preview is, and the size cap lives in
   * one place (saveThumbnail) rather than in two.
   */
  async function storeRecordingPreviews(
    msgId: ChatMessageId,
    recordings: Record<string, RecordedMediaInMsg> | undefined,
  ): Promise<void> {
    if (!recordings) {
      return;
    }
    for (const [fileName, { preview }] of Object.entries(recordings)) {
      if (!preview) {
        continue;
      }
      try {
        await saveThumbnailWithinLimit(data, msgId, fileName, preview);
      } catch (exc) {
        // A missing preview costs a file icon, not the message: reported and
        // stepped over, so one oversized frame cannot fail a delivery.
        await w3n.log('error', `Failed to store the preview of the recording ${fileName}`, exc);
      }
    }
  }

  /**
   * A phantom of the message record itself: it carries the entity rather than
   * a change of one of its aspects, so there is no version to stamp - a
   * record's creation is guarded by tombstones instead.
   */
  async function sendSyncMsgOfRegularMsg(chatId: ChatIdObj, msg: MsgDbEntry): Promise<void> {
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: createSyncMsgBasedOnRegularMsg({
        msg,
        sourceDeviceId: getAppDeviceId(),
        timestamp: await nextSyncStamp(),
      }),
      entity: {
        entityType: 'msg',
        entityId: msgEntityId(chatId, msg.chatMessageId),
        aspect: 'record',
      },
    });
  }

  /**
   * Status of a (re)sending that just started. Not stamped as the 'status'
   * aspect: the authoritative terminal status comes from the delivery-progress
   * hook, which does stamp it (handle-regular-sending-progress.ts).
   */
  async function sendStatusSyncMsg(chatId: ChatIdObj, msg: MsgDbEntry): Promise<void> {
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeMsgRecordPhantom({
        chatId,
        sourceDeviceId: getAppDeviceId(),
        timestamp: await nextSyncStamp(),
        msg,
      }),
      entity: {
        entityType: 'msg',
        entityId: msgEntityId(chatId, msg.chatMessageId),
        aspect: 'record',
      },
    });
  }

  async function cancelSendingMessage(deliveryId: string): Promise<void> {
    await w3n.mail?.delivery.rmMsg(deliveryId, true);
  }

  /**
   * What a notification says about a message whose only content is a recording.
   */
  async function recordingNotificationBody(
    attachments: ChatMessageAttachmentsInfo[] | null,
  ): Promise<string> {
    const recording = attachments?.find(a => a.recording)?.recording;
    if (!recording) {
      return '';
    }
    const label = await appSettings.t(
      recording.kind === 'voice' ? 'chat.recording.label.voice' : 'chat.recording.label.video',
    );
    return label ?? '';
  }

  async function handleRegularMsg(
    incomingMsg: ChatIncomingMessage,
    chat: ChatDbEntry,
    chatMsgBody: ChatRegularMsgV1,
  ): Promise<void> {
    const { msgId, sender, plainTxtBody, attachments: attachmentsFS, deliveryTS } = incomingMsg;
    const { chatMessageId, relatedMessage, recordings } = chatMsgBody;
    const removeFromInbox = !incomingMsg.attachments;

    const chatId = chatIdOfChat(chat);
    const existingMsg = await data.getMessage({ chatId, chatMessageId });
    if (existingMsg) {
      // Already processed - this is a redelivery within the deferred inbox
      // removal window (P1); re-applying would violate the messages table PK
      // and would re-send the 'sent' status notification pointlessly.
      if (removeFromInbox) {
        await data.scheduleInboxMsgRemoval(msgId);
      }
      return;
    }

    const attachments = withRecordingsApplied(await infoOfIncomingAttachments(attachmentsFS), recordings);

    const { settings } = chat;
    const autoDeleteMessagesId = settings?.autoDeleteMessages as '0' | '1' | '2' | '3' | '4' | '5';
    const autoDeleteTSValue = AUTO_DELETE_MESSAGES_BY_ID[autoDeleteMessagesId].value || AUTODELETE_OFF;

    const msg = makeMsgDbEntry('regular', chatMessageId, {
      isIncomingMsg: true,
      incomingMsgId: removeFromInbox ? null : msgId,
      groupChatId: chat.isGroupChat ? chat.chatId : null,
      otoPeerCAddr: chat.isGroupChat ? null : chat.peerCAddr,
      groupSender: chat.isGroupChat ? sender : null,
      body: plainTxtBody ?? null,
      attachments,
      relatedMessage: relatedMessage ?? null,
      timestamp: deliveryTS,
      removeAfter: autoDeleteMessagesId === '0' ? 0 : deliveryTS + autoDeleteTSValue,
    });

    await data.addMessage(msg);

    // Before the event, so that the chip has its frame the first time it is
    // drawn: a recording is well past THUMBNAIL_AUTO_PREVIEW_LIMIT, so this
    // preview is the only one it will ever get without the user asking.
    await storeRecordingPreviews({ chatId, chatMessageId }, recordings);

    emit.message.added(msg);

    if (removeFromInbox) {
      await data.scheduleInboxMsgRemoval(msgId);
    }

    const icon = Uint8Array.from(LOGO_ICON_AS_ARRAY);
    // A one-to-one chat is the sender itself, so naming it would add nothing.
    const notificationTitle = chat.isGroupChat
      ? await appSettings.t('app.notification.new_group_message', { sender, chatName: chat.name })
      : await appSettings.t('app.notification.new_message', { sender });

    await replaceSystemNotification({
      icon,
      title: notificationTitle,
      // A recording carries no text, and a notification with an empty body says
      // only that something arrived. What kind of recording it was is the least
      // the notification can say instead.
      body: plainTxtBody
        ? excerpt(`<div>${plainTxtBody}</div>`, 50)
        : await recordingNotificationBody(attachments),
      cmd: {
        cmd: 'open-chat-with',
        params: [
          {
            chatId: {
              isGroupChat: chat.isGroupChat,
              chatId: chat.isGroupChat ? chat.chatId : chat.peerCAddr,
            },
            peerAddress: sender,
          } as OpenChatCmdArg,
        ],
      },
    });

    await sendSystemMessage({
      chatId: chatIdOfChat(chat),
      recipients: [incomingMsg.sender],
      chatSystemData: {
        event: 'update:status',
        value: {
          chatMessageId,
          status: 'sent',
        },
      },
    });
  }

  return {
    sendRegularMessage,
    cancelSendingMessage,
    handleRegularMsg,
  };
}
