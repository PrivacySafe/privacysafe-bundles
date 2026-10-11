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
import type {
  AcceptedMsgBodySysMsgData,
  ChatIdObj,
  ChatInvitationMsgV1,
  ChatSyncMsgV1,
  ChatSystemMessageData,
  ChatSystemMsgV1,
  DeleteMessageSysMsgData,
  GroupChatParameters,
  MemberLeftSysMsgData,
  MemberRemovalSysMsgData,
  OneToOneChatParameters,
  PhantomSyncMsgDataBasedOnRegularMsgV1,
  ResyncMsgRecordSysMsgData,
  RestoreSnapshotSysMsgData,
  UpdateAdminsSysMsgData,
  UpdatedChatNameSysMsgData,
  UpdatedChatSettingsSysMsgData,
  UpdatedMsgBodySysMsgData,
  UpdatedMsgReactionSysMsgData,
  UpdatedMsgRecordSysMsgData,
  UpdatedMsgStatusSysMsgData,
  UpdateMembersSysMsgData,
} from '../../../../types/asmail-msgs.types.ts';
import type { GroupChatStatus, SingleChatStatus } from '../../../../types/chat.types.ts';
import type { ChatSrvEmit, DB, FileStoreService, OrphanedMsgDbEntry } from '../../../types/index.ts';
import { AUTODELETE_OFF, AUTO_DELETE_MESSAGES_BY_ID } from '../../../../shared-libs/constants/chat-settings.ts';
import {
  isTerminalStatus,
  makeMsgDbEntry,
  removeMsgBytes,
  removeMsgDataNotInDB,
  statusForSyncedOutgoingMsg,
} from './_msgs-related-methods.ts';
import { requestMsgRecordResync, respondToMsgRecordResync, type ResyncCtx } from './msg-resync.ts';
import { applyRestoreSnapshot } from './restore-snapshot.ts';
import {
  applyIfNewer,
  chatEntityId,
  isDeletedLaterThan,
  isRecordDeletedLater,
  msgEntityId,
  recordDeletion,
  type SyncToken,
} from './sync-versions.ts';

/**
 * Processes incoming synchronization messages (ghost messages) from other devices
 * of the same user.
 *
 * Ghost messages are used to synchronize chat states between devices:
 * - regular: synchronize regular messages
 * - system: synchronize system events (rename, settings, members, etc.)
 * - invitation: synchronize invitations (and create chats if necessary)
 *
 * CAUSAL CONSISTENCY:
 * A ghost message may arrive before the original message (or even before the chat is created).
 * In such cases, we use the orphaned_messages table for buffering.
 *
 * CONFLICT RESOLUTION:
 * Each synchronized aspect of a chat or a message carries an ordering token,
 * (syncMsg.timestamp, sourceDeviceId), and a change is applied only when its
 * token is newer than the one already recorded - last-write-wins with a total
 * order, so every device converges on the same state regardless of the order in
 * which phantoms happen to arrive. See sync-versions.ts.
 */
export async function handleIncomingSync({
  syncMsg,
  db,
  emit,
  ownAddr,
  filesStore,
  observeSyncStamp,
  resync,
}: {
  syncMsg: ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1>;
  db: DB;
  emit: ChatSrvEmit;
  ownAddr: string;
  filesStore: FileStoreService;
  observeSyncStamp: (ts: number) => Promise<void>;
  resync?: ResyncCtx;
}): Promise<void> {
  // Feed the hybrid logical clock, so that a change made on this device after
  // seeing this one is guaranteed to outrank it. Done only for phantoms as they
  // arrive - re-processing a buffered one (dispatchSync below) must not, its
  // stamp was already observed when it was first received.
  if (syncMsg.timestamp) {
    await observeSyncStamp(syncMsg.timestamp);
  }

  await dispatchSync({ syncMsg, db, emit, ownAddr, filesStore, resync });
}

async function dispatchSync({
  syncMsg,
  db,
  emit,
  ownAddr,
  filesStore,
  resync,
}: {
  syncMsg: ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1>;
  db: DB;
  emit: ChatSrvEmit;
  ownAddr: string;
  filesStore: FileStoreService;
  resync?: ResyncCtx;
}): Promise<void> {
  const { value, chatId, sourceDeviceId } = syncMsg;

  if (value.chatMessageType === 'regular') {
    await handleRegularSync({
      syncData: value as PhantomSyncMsgDataBasedOnRegularMsgV1,
      chatId,
      db,
      emit,
      sourceDeviceId,
      syncMsg: syncMsg as ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1>,
      ownAddr,
      filesStore,
      resync,
    });
    return;
  }

  if (value.chatMessageType === 'system') {
    await handleSystemSync({
      syncData: value as ChatSystemMsgV1,
      chatId,
      db,
      emit,
      sourceDeviceId,
      syncMsg: syncMsg as ChatSyncMsgV1<ChatSystemMsgV1>,
      ownAddr,
      filesStore,
      resync,
    });
    return;
  }

  if (value.chatMessageType === 'invitation') {
    await handleInvitationSync({
      syncData: value as ChatInvitationMsgV1,
      chatId,
      db,
      emit,
      sourceDeviceId,
      syncMsg: syncMsg as ChatSyncMsgV1<ChatInvitationMsgV1>,
      ownAddr,
      filesStore,
      resync,
    });
    return;
  }

  await w3n.log('warning', `Unknown sync message type: ${(value as { chatMessageType: string }).chatMessageType}`);
}

function chatExists(db: DB, chatId: ChatIdObj): boolean {
  return !!db.findChat(chatId);
}

/**
 * Orders buffered phantoms by the time of the change they carry, rather than by
 * the time they happened to reach this device (bufferedAt, which is what the DB
 * queries sort by). Applying them in arrival order would leave the older change
 * written last for aspects whose conflict resolution is per-aspect.
 */
function orderedByChangeTime<T extends OrphanedMsgDbEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const aTs = (a.rawPayload as { timestamp?: number })?.timestamp ?? a.bufferedAt;
    const bTs = (b.rawPayload as { timestamp?: number })?.timestamp ?? b.bufferedAt;
    return aTs - bTs;
  });
}

/**
 * Records the same visible system message that the initiating device records
 * locally (chat-renaming.ts, chat-setting-up.ts, chat-members-updating.ts) -
 * without this, chat history would show the state change on the initiating
 * device but not on its other devices, even though the chat record itself is
 * already kept in sync.
 */
async function addVisibleSystemSyncMsg(
  db: DB,
  emit: ChatSrvEmit,
  chatId: ChatIdObj,
  chatMessageId: string | undefined,
  chatSystemData: ChatSystemMessageData,
  sourceDeviceId: string,
  syncMsg: ChatSyncMsgV1<ChatSystemMsgV1>,
  token: SyncToken,
): Promise<void> {
  if (!chatMessageId) {
    return;
  }

  const existingMsg = await db.getMessage({ chatId, chatMessageId });
  if (existingMsg) {
    return;
  }

  if (isRecordDeletedLater(db, chatId, chatMessageId, token)) {
    return;
  }

  const msg = makeMsgDbEntry('system', chatMessageId, {
    isIncomingMsg: false,
    groupChatId: chatId.isGroupChat ? chatId.chatId : null,
    otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
    body: JSON.stringify(chatSystemData),
    timestamp: syncMsg.timestamp || Date.now(),
    settings: { msgOwnersDeviceId: sourceDeviceId },
  });

  await db.addMessage(msg);
  emit.message.added(msg);
}

async function bufferOrphanedSync(
  db: DB,
  chatId: ChatIdObj,
  targetMessageId: string | undefined,
  syncMsg: ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1>,
): Promise<void> {
  const orphanedEntry: OrphanedMsgDbEntry = {
    groupChatId: chatId.isGroupChat ? chatId.chatId : null,
    otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
    incomingMsgId: null,
    targetMessageId: targetMessageId || null,
    rawPayload: syncMsg,
    bufferedAt: Date.now(),
  };

  try {
    await db.addOrphanedMessage(orphanedEntry);
    await w3n.log('info', `Buffered orphaned sync message for target ${targetMessageId || 'chat-creation'}`);
  } catch (err) {
    // Buffering must not break processing of the whole inbox: on a failure the
    // causally advanced phantom is dropped, and the state stays as it was.
    await w3n.log(
      'error',
      `Failed to buffer orphaned sync message for target ${targetMessageId || 'chat-creation'}; it is dropped.`,
      err,
    );
  }
}

/**
 * Buffers a phantom that waits for a specific message record, and asks the
 * user's other devices to repeat that record. Waiting alone is not enough:
 * the record's own carrier may be lost for good (e.g. an inbox message whose
 * delivery never completed cannot be retrieved by any device), and then no
 * amount of waiting fills the buffer's target in.
 */
async function bufferOrphanedSyncAwaitingRecord(
  db: DB,
  chatId: ChatIdObj,
  targetMessageId: string,
  syncMsg: ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1>,
  resync: ResyncCtx | undefined,
): Promise<void> {
  await bufferOrphanedSync(db, chatId, targetMessageId, syncMsg);
  if (resync) {
    await requestMsgRecordResync(resync, chatId, targetMessageId);
  }
}

/**
 * Creates a chat based on the invitation data (for synchronization).
 * This is necessary when a ghosted invitation arrives before the chat has been created.
 */
async function createChatFromInvitationSync(
  db: DB,
  emit: ChatSrvEmit,
  chatId: ChatIdObj,
  inviteData: GroupChatParameters | OneToOneChatParameters,
): Promise<void> {
  if (inviteData.type === 'oto-chat-invite') {
    const chat = await db.addOneToOneChat({
      peerAddr: chatId.chatId,
      name: inviteData.name,
      settings: inviteData.settings ?? {
        autoDeleteMessages: '1',
      },
      status: inviteData.status ?? 'on',
    });
    emit.chat.added(chat);
    await w3n.log('info', `Created OTO chat ${chatId.chatId} from invitation sync`);
  } else if (inviteData.type === 'group-chat-invite') {
    const chat = await db.addGroupChat({
      chatId: inviteData.groupChatId,
      name: inviteData.name,
      members: inviteData.members || {},
      admins: inviteData.admins || [],
      settings: inviteData.settings ?? {
        autoDeleteMessages: '1',
      },
      status: inviteData.status ?? 'on',
    });
    emit.chat.added(chat);
    await w3n.log('info', `Created group chat ${inviteData.groupChatId} from invitation sync`);
  }
}

/**
 * Handles regular message synchronization.
 *
 * Logic:
 * 1. Check if the chat exists
 * 2. If there is no chat, buffer it in orphaned_messages
 * 3. If there is a chat, check if the same message already exists
 * 4. If there is, log it (possibly needs to be updated).
 * 5. If there isn't, create a new one
 * 6. Check if there are orphaned records for this message and apply them
 */
async function handleRegularSync({
  syncData,
  chatId,
  db,
  emit,
  sourceDeviceId,
  syncMsg,
  ownAddr,
  filesStore,
  resync,
}: {
  syncData: PhantomSyncMsgDataBasedOnRegularMsgV1;
  chatId: ChatIdObj;
  db: DB;
  emit: ChatSrvEmit;
  sourceDeviceId: string;
  syncMsg: ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1>;
  ownAddr: string;
  filesStore: FileStoreService;
  resync?: ResyncCtx;
}): Promise<void> {
  const { chatMessageId, text, attachments, relatedMessage, status, history, isIncomingMsg, groupSender } =
    syncData;

  const chat = db.findChat(chatId);
  if (!chat) {
    // The dependency here is the chat's existence, not a specific message: buffer
    // without a targetMessageId so it is picked up by getStuckMessagesWithoutTarget()
    // once the chat is created (see processOrphanedForChatCreation()).
    await bufferOrphanedSync(db, chatId, undefined, syncMsg);
    return;
  }

  const syncedStatus = statusForSyncedOutgoingMsg(status);
  const token: SyncToken = { ts: syncMsg.timestamp || Date.now(), deviceId: sourceDeviceId };
  const existingMsg = await db.getMessage({ chatId, chatMessageId });

  if (existingMsg) {
    // This phantom carries the status the message had when its record was
    // created, which is not an authoritative status source - those come as
    // 'update:msg-record'. So it may never pull a terminal status back to
    // 'syncing_self', on top of the ordering the token already provides.
    if (isTerminalStatus(existingMsg.status) || syncedStatus === existingMsg.status) {
      await w3n.log('info', `Received sync for existing regular message ${chatMessageId}`);
      return;
    }

    const entityId = msgEntityId(chatId, chatMessageId);
    await applyIfNewer({ db, entityType: 'msg', entityId, aspect: 'status', token }, async () => {
      const updatedMsg = await db.updateMessageStatus({ chatId, chatMessageId }, syncedStatus);
      if (updatedMsg) {
        emit.message.updated(updatedMsg);
      }
    });
    return;
  }

  if (isRecordDeletedLater(db, chatId, chatMessageId, token)) {
    await w3n.log('info', `Skipping regular message ${chatMessageId} deleted after this phantom was made`);
    return;
  }

  const timestamp = syncMsg.timestamp || Date.now();
  const autoDeleteMessagesId = chat.settings?.autoDeleteMessages as '0' | '1' | '2' | '3' | '4' | '5';
  const autoDeleteTSValue = AUTO_DELETE_MESSAGES_BY_ID[autoDeleteMessagesId].value || AUTODELETE_OFF;

  const msg = makeMsgDbEntry('regular', chatMessageId, {
    // A record of an incoming message arrives only as a resync answer; keep
    // its direction and sender instead of presenting it as the user's own.
    isIncomingMsg: !!isIncomingMsg,
    groupSender: (isIncomingMsg && groupSender) || null,
    groupChatId: chatId.isGroupChat ? chatId.chatId : null,
    otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
    body: text,
    // An empty list is not "no attachments" once it reaches the UI: the record
    // column becomes '[]' instead of NULL, and a truthy empty array reads as
    // "there are files, but not on this device". Phantoms of earlier builds
    // always send [] for a message without files, so normalize on arrival.
    attachments: attachments?.length ? attachments : null,
    relatedMessage: relatedMessage || null,
    timestamp,
    removeAfter: autoDeleteMessagesId === '0' ? 0 : timestamp + autoDeleteTSValue,
    status: syncedStatus,
    history: history || null,
    settings: { msgOwnersDeviceId: sourceDeviceId },
  });

  await db.addMessage(msg);
  emit.message.added(msg);

  await processOrphanedForTarget(db, emit, filesStore, chatMessageId, ownAddr, resync);
}

/**
 * Handles system message synchronization.
 *
 * System messages can be:
 * - Persistent (stored in the database): update:members, update:chatName, update:settings, etc.
 * - Transient (not stored): update:status, delete:message, update:body, etc.
 *
 * For transient events, an action must be applied to existing data.
 */
async function handleSystemSync({
  syncData,
  chatId,
  db,
  emit,
  sourceDeviceId,
  syncMsg,
  ownAddr,
  filesStore,
  resync,
}: {
  syncData: ChatSystemMsgV1;
  chatId: ChatIdObj;
  db: DB;
  emit: ChatSrvEmit;
  sourceDeviceId: string;
  syncMsg: ChatSyncMsgV1<ChatSystemMsgV1>;
  ownAddr: string;
  filesStore: FileStoreService;
  resync?: ResyncCtx;
}): Promise<void> {
  const { chatMessageId, chatSystemData } = syncData;
  const { event } = chatSystemData;

  const token: SyncToken = { ts: syncMsg.timestamp || Date.now(), deviceId: sourceDeviceId };
  const chatKey = chatEntityId(chatId);

  // 'resync:msg-record' is not buffered for a missing chat either: a device
  // that doesn't know the chat cannot answer the ask, and the ask must never
  // wait - other devices answer it or nobody can.
  //
  // 'restore:snapshot' spans many chats at once, so waiting for the ONE named
  // in its envelope would be plainly wrong: the envelope's chat is the chat of
  // the chunk's first record and means nothing to this branch (it is there for
  // the benefit of older builds - see RestoreSnapshotSysMsgData).
  const chatRequired = !['member-removed', 'resync:msg-record', 'restore:snapshot'].includes(event);

  if (chatRequired && !chatExists(db, chatId)) {
    // Waiting on the chat's existence, not on a specific message; see the matching
    // comment in handleRegularSync().
    await bufferOrphanedSync(db, chatId, undefined, syncMsg);
    return;
  }

  switch (event) {
    case 'update:chatName': {
      const { value } = chatSystemData as UpdatedChatNameSysMsgData;
      const chat = db.findChat(chatId);
      if (chat && chat.isGroupChat) {
        await applyIfNewer({ db, entityType: 'chat', entityId: chatKey, aspect: 'name', token }, async () => {
          const updatedChat = await db.updateGroupChatRecord(chatId.chatId, { name: value.name });
          if (updatedChat) {
            emit.chat.updated(updatedChat);
          }
        });
        await addVisibleSystemSyncMsg(db, emit, chatId, chatMessageId, chatSystemData, sourceDeviceId, syncMsg, token);
      }
      break;
    }

    case 'update:settings': {
      const { value } = chatSystemData as UpdatedChatSettingsSysMsgData;
      const chat = db.findChat(chatId);
      if (chat) {
        await applyIfNewer({ db, entityType: 'chat', entityId: chatKey, aspect: 'settings', token }, async () => {
          const updatedChat = chat.isGroupChat
            ? await db.updateGroupChatRecord(chatId.chatId, { settings: value.settings })
            : await db.updateOTOChatRecord(chatId.chatId, { settings: value.settings });
          if (updatedChat) {
            emit.chat.updated(updatedChat);
          }
        });
        await addVisibleSystemSyncMsg(db, emit, chatId, chatMessageId, chatSystemData, sourceDeviceId, syncMsg, token);
      }
      break;
    }

    case 'update:members': {
      const { value } = chatSystemData as UpdateMembersSysMsgData;
      const chat = db.findChat(chatId);
      if (chat && chat.isGroupChat) {
        await applyIfNewer({ db, entityType: 'chat', entityId: chatKey, aspect: 'members', token }, async () => {
          const updatedChat = await db.updateGroupChatRecord(chatId.chatId, {
            members: value.membersAfterUpdate,
          });
          if (updatedChat) {
            emit.chat.updated(updatedChat);
          }
        });
        await addVisibleSystemSyncMsg(db, emit, chatId, chatMessageId, chatSystemData, sourceDeviceId, syncMsg, token);
      }
      break;
    }

    case 'update:admins': {
      const { value } = chatSystemData as UpdateAdminsSysMsgData;
      const chat = db.findChat(chatId);
      if (chat && chat.isGroupChat) {
        await applyIfNewer({ db, entityType: 'chat', entityId: chatKey, aspect: 'admins', token }, async () => {
          const updatedChat = await db.updateGroupChatRecord(chatId.chatId, {
            admins: value.adminsAfterUpdate,
          });
          if (updatedChat) {
            emit.chat.updated(updatedChat);
          }
        });
        await addVisibleSystemSyncMsg(db, emit, chatId, chatMessageId, chatSystemData, sourceDeviceId, syncMsg, token);
      }
      break;
    }

    case 'delete:message': {
      const { value } = chatSystemData as DeleteMessageSysMsgData;

      // A tombstone is recorded whether or not the message is here yet, which is
      // why this branch needs no buffering: a phantom of the message itself
      // arriving later finds the tombstone and does not recreate it.
      //
      // Removal goes through removeMsgBytes/removeMsgDataNotInDB rather than
      // through db.deleteMessage alone: a deletion made on another device has to
      // clear the same three things a local one does - the row, the inbox
      // message an incoming record was built from, and the attachment bytes of
      // an outgoing one. Dropping only the row left both of the latter behind
      // forever, growing with every deletion made anywhere else.
      if (value.oneMessage) {
        await recordDeletion(db, 'msg', msgEntityId(chatId, value.oneMessage.chatMessageId), token);
        // A record that is not here is skipped silently: the tombstone above is
        // what this branch is built on, and it stands with or without a row.
        const msg = await db.getMessage(value.oneMessage);
        if (msg) {
          await removeMsgBytes(db, filesStore, value.oneMessage, msg);
        }
        emit.message.removed(value.oneMessage);
      } else if (value.multipleMessages) {
        for (const msgId of value.multipleMessages.chatMsgIds) {
          await recordDeletion(db, 'msg', msgEntityId(chatId, msgId.chatMessageId), token);
          const msg = await db.getMessage(msgId);
          if (msg) {
            await removeMsgBytes(db, filesStore, msgId, msg);
          }
        }
        emit.message.removedMultiple(value.multipleMessages.chatMsgIds);
      } else if (value.allInChat) {
        // History clearing wipes an open-ended set of messages, so a single
        // chat-wide marker stands in for per-message tombstones.
        await db.setSyncVersion('chat', chatKey, 'historyCleared', { ...token, tombstonedAt: Date.now() });
        const msgsDataToRm = await db.deleteMessagesInChat(value.allInChat);
        if (msgsDataToRm) {
          await removeMsgDataNotInDB(msgsDataToRm, filesStore);
        }
        emit.chat.allMsgsRemoved(value.allInChat);
      }
      break;
    }

    case 'update:body': {
      const { value } = chatSystemData as UpdatedMsgBodySysMsgData;
      const msg = await db.getMessage({ chatId, chatMessageId: value.chatMessageId });
      if (msg) {
        const entityId = msgEntityId(chatId, value.chatMessageId);
        await applyIfNewer({ db, entityType: 'msg', entityId, aspect: 'body', token }, async () => {
          const updatedMsg = await db.updateMessageRecord(
            { chatId, chatMessageId: value.chatMessageId },
            { body: value.body },
          );
          if (updatedMsg) {
            emit.message.updated(updatedMsg);
          }
        });
      } else {
        await bufferOrphanedSyncAwaitingRecord(db, chatId, value.chatMessageId, syncMsg, resync);
      }
      break;
    }

    case 'update:reactions': {
      const { value } = chatSystemData as UpdatedMsgReactionSysMsgData;
      const msg = await db.getMessage({ chatId, chatMessageId: value.chatMessageId });
      if (msg) {
        const entityId = msgEntityId(chatId, value.chatMessageId);
        await applyIfNewer({ db, entityType: 'msg', entityId, aspect: 'reactions', token }, async () => {
          const updatedMsg = await db.updateMessageRecord(
            { chatId, chatMessageId: value.chatMessageId },
            { reactions: value.reactions },
          );
          if (updatedMsg) {
            emit.message.updated(updatedMsg);
          }
        });
      } else {
        await bufferOrphanedSyncAwaitingRecord(db, chatId, value.chatMessageId, syncMsg, resync);
      }
      break;
    }

    case 'update:msg-record': {
      const { value } = chatSystemData as UpdatedMsgRecordSysMsgData;
      const msg = await db.getMessage({ chatId, chatMessageId: value.chatMessageId });

      if (!msg) {
        // Phantom of the message itself hasn't been processed yet.
        await bufferOrphanedSyncAwaitingRecord(db, chatId, value.chatMessageId, syncMsg, resync);
        break;
      }

      // Two terminal-status phantoms for the same message can be in flight at
      // once (e.g. cancelSendingMessage racing a delivery that just completed).
      // Ordering them is left entirely to the token: a "first terminal status
      // wins" rule would instead let devices settle on different statuses,
      // depending on which phantom each happened to receive first.
      const { status, history } = value.data || {};
      const entityId = msgEntityId(chatId, value.chatMessageId);
      await applyIfNewer({ db, entityType: 'msg', entityId, aspect: 'status', token }, async () => {
        const updatedMsg = await db.updateMessageRecord(
          { chatId, chatMessageId: value.chatMessageId },
          {
            ...(status && { status: statusForSyncedOutgoingMsg(status) }),
            ...(history && { history }),
          },
        );

        if (updatedMsg) {
          emit.message.updated(updatedMsg);
        }
      });
      break;
    }

    case 'update:status': {
      const { value } = chatSystemData as UpdatedMsgStatusSysMsgData;
      const msg = await db.getMessage({ chatId, chatMessageId: value.chatMessageId });
      if (msg) {
        const entityId = msgEntityId(chatId, value.chatMessageId);
        await applyIfNewer({ db, entityType: 'msg', entityId, aspect: 'status', token }, async () => {
          const updatedMsg = await db.updateMessageStatus(
            { chatId, chatMessageId: value.chatMessageId },
            value.status,
          );
          if (updatedMsg) {
            emit.message.updated(updatedMsg);
          }
        });
      } else {
        await bufferOrphanedSyncAwaitingRecord(db, chatId, value.chatMessageId, syncMsg, resync);
      }
      break;
    }

    case 'resync:msg-record': {
      // Another device of this user is missing the record and asks for its
      // phantom to be repeated. Answer only when the record is here; a missing
      // chat or record means some other device has to answer (or none can).
      const { value } = chatSystemData as ResyncMsgRecordSysMsgData;
      if (resync && chatExists(db, chatId)) {
        await respondToMsgRecordResync(resync, chatId, value.chatMessageId);
      }
      break;
    }

    case 'accept:invitation': {
      const { value } = chatSystemData as AcceptedMsgBodySysMsgData;
      const chat = db.findChat(chatId);
      if (chat) {
        await applyIfNewer({ db, entityType: 'chat', entityId: chatKey, aspect: 'status', token }, async () => {
          const updatedChat = chat.isGroupChat
            ? await db.updateGroupChatRecord(chatId.chatId, { status: value.status as GroupChatStatus })
            : await db.updateOTOChatRecord(chatId.chatId, { status: value.status as SingleChatStatus });
          if (updatedChat) {
            emit.chat.updated(updatedChat);
          }
        });
      }
      break;
    }

    case 'member-left': {
      const chat = db.findChat(chatId);
      if (!chat) {
        await bufferOrphanedSync(db, chatId, chatMessageId, syncMsg);
        return;
      }

      const { value } = chatSystemData as MemberLeftSysMsgData;
      const sender = value?.sender;

      if (chat.isGroupChat && sender) {
        await applyIfNewer({ db, entityType: 'chat', entityId: chatKey, aspect: 'members', token }, async () => {
          const updatedMembers = { ...chat.members };
          delete updatedMembers[sender];

          const isUserOnlyMember =
            Object.keys(updatedMembers).length === 1 && Object.keys(updatedMembers)[0] === ownAddr;

          const updatedChat = await db.updateGroupChatRecord(chatId.chatId, {
            members: updatedMembers,
            ...(isUserOnlyMember && { status: 'no-members' }),
          });

          if (updatedChat) {
            emit.chat.updated(updatedChat);
          }
        });
      }

      await w3n.log('info', `Processed sync for member-left event, sender: ${sender}`);
      break;
    }

    case 'member-removed': {
      const { chatDeleted } = chatSystemData as MemberRemovalSysMsgData;

      if (chatDeleted) {
        // Tombstoned, so that a phantom of a change predating the deletion
        // (a rename, say) cannot bring the chat back.
        await recordDeletion(db, 'chat', chatKey, token);
        const msgsDataToRm = await db.deleteChat(chatId);
        if (msgsDataToRm) {
          await removeMsgDataNotInDB(msgsDataToRm, filesStore);
        }
        emit.chat.removed(chatId);
        await w3n.log('info', `Deleted chat ${chatId.chatId} due to member-removed sync (chatDeleted: true)`);
      } else {
        const chat = db.findChat(chatId);
        if (chat) {
          await applyIfNewer({ db, entityType: 'chat', entityId: chatKey, aspect: 'members', token }, async () => {
            if (chat.isGroupChat) {
              const updatedMembers = { ...chat.members };
              delete updatedMembers[ownAddr];

              const updatedChat = await db.updateGroupChatRecord(chatId.chatId, {
                members: updatedMembers,
                status: 'no-members',
              });

              if (updatedChat) {
                emit.chat.updated(updatedChat);
              }
            } else {
              const updatedChat = await db.updateOTOChatRecord(chatId.chatId, {
                status: 'no-members',
              });

              if (updatedChat) {
                emit.chat.updated(updatedChat);
              }
            }
          });
        } else {
          await w3n.log('info', `Received member-removed sync but chat not found: ${chatId.chatId}`);
        }
      }
      break;
    }

    // Both carry a record of a call that only the sending device could know
    // about: 'call' is the call itself, 'webrtc-call' is a cancellation or a
    // decline. Neither is ever sent to peers, so this phantom is the only way
    // they reach the user's other devices.
    //
    // Only records of a decision taken on ONE device belong here. A record that
    // every device writes for itself off an incoming system message of a peer
    // must not be synchronized until its chatMessageId is derived from the event
    // rather than generated locally - otherwise each device's own copy and the
    // ones it receives add up to several lines about one cancellation.
    case 'call':
    case 'webrtc-call': {
      if (chatMessageId) {
        const existingMsg = await db.getMessage({ chatId, chatMessageId });
        if (existingMsg) {
          await w3n.log('info', `Received sync for existing call event ${chatMessageId}`);
          break;
        }

        if (isRecordDeletedLater(db, chatId, chatMessageId, token)) {
          await w3n.log('info', `Skipping call event ${chatMessageId} deleted after this phantom was made`);
          break;
        }

        const msg = makeMsgDbEntry('system', chatMessageId, {
          isIncomingMsg: false,
          groupChatId: chatId.isGroupChat ? chatId.chatId : null,
          otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
          body: JSON.stringify(chatSystemData),
          timestamp: syncMsg.timestamp || Date.now(),
          settings: { msgOwnersDeviceId: sourceDeviceId },
        });

        await db.addMessage(msg);
        emit.message.added(msg);
      }
      break;
    }

    case 'restore:snapshot': {
      const { value } = chatSystemData as RestoreSnapshotSysMsgData;
      // The same function the restoring device ran, with the same mode and the
      // same per-aspect tokens. That identity IS the guarantee that `merge`
      // here means what `merge` meant there.
      const applied = await applyRestoreSnapshot(
        {
          mode: value.mode,
          snapshotTs: value.snapshotTs,
          chats: value.chats ?? [],
          msgs: value.msgs ?? [],
          // Taken from the snapshot, never minted here: this is the token a
          // `replace` stamps a record it brings back over a clearing marker
          // with, and it has to be the same on every device (see
          // RestoreSnapshotSysMsgData.value.restoreToken). Absent from the
          // chunks of an older build, which then simply keeps its old rule -
          // its own restore of the same archive resurrects nothing.
          ...(value.restoreToken && { restoreToken: value.restoreToken }),
          ...(value.deleted && { deleted: value.deleted }),
        },
        {
          db,
          emit,
          filesStore,
          ownAddr,
          sourceDeviceId,
          // No bytes travel with a snapshot, ever.
          hasLocalAttachmentBytes: false,
          // The restoring device already listed the shared inbox, and the
          // answer is in the records it sent: an incomingMsgId that was found
          // dead there is simply absent. Listing again here would be asking the
          // same question twice and getting a worse answer.
          inboxMsgIds: new Set<string>(),
          inboxListingAvailable: false,
          drainOrphanedForChat: chatId2 =>
            processOrphanedForChatCreation(db, emit, filesStore, chatId2, ownAddr, resync),
        },
      );
      await w3n.log(
        'info',
        `Applied restore snapshot ${value.restoreId} part ${value.part}/${value.of} (${value.mode}): `
          + `chats +${applied.chatsCreated}/~${applied.chatsUpdated}, `
          + `messages +${applied.messagesCreated}/~${applied.messagesUpdated}, `
          + `${applied.skipped} skipped`,
      );
      break;
    }

    default: {
      await w3n.log('warning', `Unhandled system sync event: ${event}`);
    }
  }
}

/**
 * Handles invitation message synchronization.
 *
 * Logic:
 * 1. If the chat doesn't exist, create one based on inviteData
 * 2. Check if the invitation already exists
 * 3. If not, create a new one
 * 4. Check for orphaned entries for this invitation
 */
async function handleInvitationSync({
  syncData,
  chatId,
  db,
  emit,
  sourceDeviceId,
  syncMsg,
  ownAddr,
  filesStore,
  resync,
}: {
  syncData: ChatInvitationMsgV1;
  chatId: ChatIdObj;
  db: DB;
  emit: ChatSrvEmit;
  sourceDeviceId: string;
  syncMsg: ChatSyncMsgV1<ChatInvitationMsgV1>;
  ownAddr: string;
  filesStore: FileStoreService;
  resync?: ResyncCtx;
}): Promise<void> {
  const { chatMessageId, inviteData } = syncData;
  const token: SyncToken = { ts: syncMsg.timestamp || Date.now(), deviceId: sourceDeviceId };

  if (isDeletedLaterThan(db, 'chat', chatEntityId(chatId), token)) {
    await w3n.log('info', `Skipping invitation sync for chat deleted after this phantom was made`);
    return;
  }

  if (!chatExists(db, chatId)) {
    if (inviteData.type === 'group-chat-invite' || inviteData.type === 'oto-chat-invite') {
      await createChatFromInvitationSync(db, emit, chatId, inviteData);
      await processOrphanedForChatCreation(db, emit, filesStore, chatId, ownAddr, resync);
    } else {
      // Waiting on the chat's existence, not on a specific message; see the matching
      // comment in handleRegularSync().
      await bufferOrphanedSync(db, chatId, undefined, syncMsg);
      return;
    }
  }

  const existingMsg = await db.getMessage({ chatId, chatMessageId });

  if (existingMsg) {
    await w3n.log('info', `Received sync for existing invitation ${chatMessageId}`);
    return;
  }

  if (isRecordDeletedLater(db, chatId, chatMessageId, token)) {
    await w3n.log('info', `Skipping invitation ${chatMessageId} deleted after this phantom was made`);
    return;
  }

  const msg = makeMsgDbEntry('invitation', chatMessageId, {
    isIncomingMsg: false,
    groupChatId: chatId.isGroupChat ? chatId.chatId : null,
    otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
    body: JSON.stringify(inviteData),
    timestamp: syncMsg.timestamp || Date.now(),
    settings: { msgOwnersDeviceId: sourceDeviceId },
  });

  await db.addMessage(msg);
  emit.message.added(msg);

  await processOrphanedForTarget(db, emit, filesStore, chatMessageId, ownAddr, resync);
}

/**
 * Processes orphaned posts that reference the specified targetMessageId.
 * Called after a message is created to apply pending actions.
 */
export async function processOrphanedForTarget(
  db: DB,
  emit: ChatSrvEmit,
  filesStore: FileStoreService,
  targetMessageId: string,
  ownAddr: string,
  resync?: ResyncCtx,
): Promise<void> {
  const orphaned = orderedByChangeTime(db.getStuckMessagesForTargetMessageId(targetMessageId));

  if (orphaned.length === 0) {
    return;
  }

  await w3n.log('info', `Processing ${orphaned.length} orphaned sync message(s) for target ${targetMessageId}`);

  for (const entry of orphaned) {
    await db.deleteOrphanedMessage(entry.id);

    const syncMsg = entry.rawPayload as ChatSyncMsgV1<
      PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1
    >;

    await dispatchSync({ syncMsg, db, emit, ownAddr, filesStore, resync });
  }
}

/**
 * Processes orphaned posts that were buffered because the chat itself didn't
 * exist yet. Called right after the chat is created - whichever way it came to
 * exist: from an invitation sync of another own device (handleInvitationSync),
 * from a peer's real invitation, or made locally by the user (chat-creation.ts).
 */
export async function processOrphanedForChatCreation(
  db: DB,
  emit: ChatSrvEmit,
  filesStore: FileStoreService,
  chatId: ChatIdObj,
  ownAddr: string,
  resync?: ResyncCtx,
): Promise<void> {
  const orphaned = orderedByChangeTime(db.getStuckMessagesWithoutTarget(chatId));

  if (orphaned.length === 0) {
    return;
  }

  await w3n.log(
    'info',
    `Processing ${orphaned.length} orphaned sync message(s) buffered before chat ${chatId.chatId} existed`,
  );

  for (const entry of orphaned) {
    await db.deleteOrphanedMessage(entry.id);

    const syncMsg = entry.rawPayload as ChatSyncMsgV1<
      PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1
    >;

    await dispatchSync({ syncMsg, db, emit, ownAddr, filesStore, resync });
  }
}
