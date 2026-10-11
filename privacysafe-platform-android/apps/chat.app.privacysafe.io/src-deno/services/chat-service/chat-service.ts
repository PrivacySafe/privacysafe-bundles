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
  ChatIdObj,
  ChatIncomingMessage,
  ChatInvitationMsgV1,
  ChatMessageId,
  ChatSyncMsgV1,
  ChatSystemMessageData,
  ChatSystemMsgV1,
  PhantomSyncMsgDataBasedOnRegularMsgV1,
  RelatedMessage,
  UpdatedMsgBodySysMsgData,
  UpdatedMsgReactionSysMsgData,
} from '../../../types/asmail-msgs.types.ts';
import type {
  ChatListItemView,
  ChatMessageReaction,
  ChatMessageView,
  GroupChatView,
  MsgPageCursor,
  OutgoingAttachment,
  RegularMsgView,
  SingleChatView,
} from '../../../types/chat.types.ts';
import type {
  ChatDbEntry,
  ChatSrv,
  DB,
  LocalDataStore,
  MsgDbEntry,
} from '../../types/index.ts';
import { createChatEvents } from './events.ts';
import type { GuiLogLine } from '../../../shared-libs/log-relay.ts';
import { areAddressesEqual, includesAddress } from '../../../shared-libs/address-utils.ts';
import { areChatIdsEqual } from '../../../shared-libs/chat-ids.ts';
import { INBOX_SCAN_FLOOR_MS } from '../../../shared-libs/constants/index.ts';
import { fileStoreService } from '../file-store-service/file-store-service.ts';
import { AppSettings } from '../../utils/app-settings.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import { contactBlockingRecords } from './utils/contact-blocking-records.ts';
import { makeDbRecordException } from '../../utils/exceptions.ts';
import { checkAddressExistenceForASMail, ensureAllAddressesExist } from '../../utils/address-checks.ts';
import {
  countPhantomsAwaitingRelease,
  countSyncPhantomsInDelivery,
  makeMsgRecordPhantom,
  makeSystemEventPhantom,
  queueSyncPhantom,
  setSyncDeliveryOutcomeSink,
  setSyncPassOutcomeSink,
  releasePendingSyncPhantoms,
  sendSystemDeletableMessage as _sendSystemDeletableMessage,
} from '../mail-sending-service/index.ts';
import {
  canReceiveRegularMessages,
  getIncomingMessage,
  msgViewFromDbEntry,
  removeMessageFromInbox,
  saveThumbnailWithinLimit,
} from './utils/_msgs-related-methods.ts';
import {
  chatViewForGroupChat,
  chatViewForOTOChat,
  chatViewFromChatDbEntry,
} from './utils/_chats-related-methods.ts';
import { chatCreation as _chatCreation } from './utils/chat-creation.ts';
import { chatRenaming as _chatRenaming } from './utils/chat-renaming.ts';
import { chatSettingUp as _chatSettingUp } from './utils/chat-setting-up.ts';
import { chatDeletion as _chatDeletion } from './utils/chat-deletion.ts';
import { chatMemberRemoval as _chatMemberRemoval } from './utils/chat-member-removal.ts';
import { chatMembersUpdating as _chatMembersUpdating } from './utils/chat-members-updating.ts';
import { webRTCCallReaction as _webRTCCallReaction } from './utils/webrtc-call-reaction.ts';
import { msgSending as _msgSending } from './utils/msg-sending.ts';
import { msgDeletion as _msgDeletion } from './utils/msg-deletion.ts';
import { msgStatusUpdating as _msgStatusUpdating } from './utils/msg-status-updating.ts';
import { msgReactions as _msgReactions } from './utils/msg-reactions.ts';
import { msgEditing as _msgEditing } from './utils/msg-editing.ts';
import { checkChatMessageJSON } from './utils/_msgs-related-methods.ts';
import { handleIncomingSync, processOrphanedForChatCreation } from './utils/handle-incoming-sync.ts';
import { chatBackupSrv } from '../backup-service/chat-backup-srv.ts';
import { makeResyncCtx, requestResyncForStuckOrphans } from './utils/msg-resync.ts';
import { msgEntityId } from './utils/sync-versions.ts';
import { makeSyncActivityTracker, type SyncActivityTracker } from '../../utils/sync-activity.ts';


/**
 * Names a phantom in a log line: its kind, and for a system event the event
 * itself. "Applied a sync message" without this says nothing about what got
 * synchronized, which is the only thing worth reading afterwards.
 */
function describeSyncPhantom(
  syncMsg: ChatSyncMsgV1<PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1>,
): string {
  const { value } = syncMsg;
  const kind = (value as { chatMessageType?: string }).chatMessageType ?? 'unknown';
  const event = (value as ChatSystemMsgV1).chatSystemData?.event;
  return event ? `${kind}/${event}` : kind;
}


export async function chatService(
  ownAddr: string,
  localDataStoreSrv: LocalDataStore,
  data: DB,
  blacklistTracker?: BlacklistTracker,
): Promise<{ chatsSrv: ChatSrv; syncActivity: SyncActivityTracker }> {
  const filesStore = await fileStoreService();
  const appSettings = new AppSettings();

  const { emit: emitEventAfterAction, watch, beginBulkReplay, endBulkReplay } =
    createChatEvents(ownAddr, data);

  /**
   * Tracker of synchronization work, for the indicator in the GUI. It is made
   * here, where both the event sink and the database are already at hand, and
   * handed out to the inbox dispatcher through startup wiring.
   */
  const syncActivity = makeSyncActivityTracker({
    // Rows awaiting release, not every journal row: a row inside a delivery is
    // waiting for a confirmation, which is not work the user can be told about -
    // counting it would keep the indicator lit for as long as the platform takes
    // to report an outcome (tens of seconds, sometimes never).
    countOutboundPending: () => countPhantomsAwaitingRelease(data),
    // Nothing is reported until this user is known to have a second device.
    // Their own phantoms come back to their own inbox, so a single-device user
    // was told about "synchronization" that consisted entirely of this device
    // cleaning up after itself (2026-08-14).
    isReportable: () => localDataStoreSrv.hasSeenOtherDevice(),
  });
  syncActivity.onChange(state => emitEventAfterAction.common({
    updatedEntityType: 'sync-state',
    event: 'changed',
    state,
  }));

  // Wired here, at the construction of the service, because the first pass over
  // the journal runs at start-up (index.ts) - and because most passes are
  // started from inside the sending service itself, where this service is not
  // in reach. Reporting the outcome only from the IPC method below left every
  // pass of a running app unreported: a journal held back by a call looked to
  // the indicator exactly like work in progress, so it showed "Synchronizing…"
  // for the whole length of every call (2026-08-14).
  setSyncPassOutcomeSink(outcome => syncActivity.noteOutboundPass(outcome));
  setSyncDeliveryOutcomeSink(outcome => syncActivity.noteOutboundDeliveryOutcome(outcome));

  /**
   * Shared context of the record-resync mechanism (see msg-resync.ts): its
   * per-session dedup of asks must be one for all the places that can notice
   * a missing record - incoming sync handling and the start-up pass alike.
   */
  const resyncCtx = makeResyncCtx({ db: data, ownAddr, getAppDeviceId, nextSyncStamp });

  const chatCreation = await _chatCreation({
    ownAddr,
    data,
    appSettings,
    emit: emitEventAfterAction,
    filesStore,
    getAppDeviceId,
    nextSyncStamp,
    resync: resyncCtx,
  });
  const chatRenaming = await _chatRenaming({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const chatSettingUp = await _chatSettingUp({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const chatDeletion = await _chatDeletion({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    filesStore,
    getAppDeviceId,
    nextSyncStamp,
  });
  const chatMemberRemoval = await _chatMemberRemoval({ ownAddr, data, emit: emitEventAfterAction });
  const chatMembersUpdating = await _chatMembersUpdating({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const webRTCCallReaction = await _webRTCCallReaction(emitEventAfterAction);
  const msgSending = await _msgSending({
    ownAddr,
    data,
    appSettings,
    emit: emitEventAfterAction,
    filesStore,
    getAppDeviceId,
    nextSyncStamp,
  });
  const msgDeletion = await _msgDeletion({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    filesStore,
    getAppDeviceId,
    nextSyncStamp,
  });
  const msgStatusUpdating = await _msgStatusUpdating({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const msgReactions = await _msgReactions({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const msgEditing = await _msgEditing({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });

  /**
   * Backup and restore. Constructed after everything it leans on: the events
   * (for progress and the bulk-replay window), the file store, and the drain of
   * phantoms buffered before a chat existed - a restored chat can unblock them.
   */
  const backupSrv = chatBackupSrv({
    db: data,
    emit: emitEventAfterAction,
    filesStore,
    ownAddr,
    getAppDeviceId,
    nextSyncStamp,
    beginBulkReplay,
    endBulkReplay,
    drainOrphanedForChat: chatId =>
      processOrphanedForChatCreation(data, emitEventAfterAction, filesStore, chatId, ownAddr, resyncCtx),
  });

  function getAppDeviceId() {
    return localDataStoreSrv.getAppDeviceId();
  }

  /**
   * The main window's log lines, printed through this component so that the
   * whole run reads as one story (see ChatSrv.logFromGui).
   *
   * `w3n.log` directly rather than a scoped logger: the line arrives with its
   * own time, user address and scope already in it, and stamping it again with
   * this component's clock would put the moment of delivery where the moment of
   * the event should be.
   */
  async function logFromGui(lines: GuiLogLine[]): Promise<void> {
    for (const { level, line, details } of lines) {
      await w3n.log(level, `[GUI:main] ${line}`, details).catch(() => {});
    }
  }

  function nextSyncStamp() {
    return localDataStoreSrv.nextSyncStamp();
  }

  /**
   * In-process listeners of incoming call system messages - the video chat
   * service, which needs them as its fallback for a lost 'call-declined' signal.
   * See ChatSrv.onIncomingCallSysMsg for why this is not a watch() subscription.
   */
  const callSysMsgHandlers = new Set<Parameters<ChatSrv['onIncomingCallSysMsg']>[0]>();

  function onIncomingCallSysMsg(
    handler: Parameters<ChatSrv['onIncomingCallSysMsg']>[0],
  ): () => void {
    callSysMsgHandlers.add(handler);
    return () => callSysMsgHandlers.delete(handler);
  }

  async function handleIncomingMsg(msg: ChatIncomingMessage): Promise<void> {
    // Orphaned messages handling is implemented in handle-incoming-sync.ts
    // and in individual message handlers (handleRegularMsg, handleSystemMsg, etc.)

    const checkMsgBody = checkChatMessageJSON(msg);
    if (!checkMsgBody) {
      return await removeMessageFromInbox(
        msg.msgId,
        `Incoming chat message ${msg.msgId} failed body check. Removing it from inbox.`,
      );
    }

    if (blacklistTracker && !areAddressesEqual(msg.sender, ownAddr) && blacklistTracker.isBlacklisted(msg.sender)) {
      // A message the history still holds was received before the blocking, and
      // only the user deletes what they have received. For one with attachments
      // the inbox message is also the only carrier of the file bytes, so taking
      // it off the server would leave the entry pointing at nothing.
      if (data.isMsgKeptForInboxMsg(msg.msgId)) {
        await w3n.log(
          'info',
          `Incoming chat message ${msg.msgId} is from blacklisted sender ${msg.sender}, but it was received before the blocking; leaving it alone.`,
        );
        return;
      }
      return await removeMessageFromInbox(
        msg.msgId,
        `Incoming chat message ${msg.msgId} is from blacklisted sender ${msg.sender}. Removing it from inbox.`,
      );
    }

    const { chatId, chatMsgBody } = checkMsgBody;

    if (chatMsgBody.chatMessageType === 'invitation') {
      return await chatCreation.handleChatInvitation(msg);
    }

    if (chatMsgBody.chatMessageType === 'synchronization') {
      const currentDeviceId = getAppDeviceId();
      const syncMsg = chatMsgBody as ChatSyncMsgV1<
        PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1
      >;
      const { sourceDeviceId } = syncMsg;

      if (currentDeviceId === sourceDeviceId) {
        // Inbox is shared across all of the user's own devices, so this device
        // must not remove it immediately - that would rob every other device of
        // ever seeing it. It is only scheduled for deferred removal (P0-3).
        //
        // The device id is printed, and not just implied by this branch, for a
        // reason that cost a whole debugging session: two app instances started
        // on the same data folder share this file, hence this id, and then every
        // phantom looks like this device's own on both of them - synchronization
        // is dead and no other line says so.
        await w3n.log(
          'info',
          `Sync message ${msg.msgId} is from this device (${currentDeviceId}). Scheduling deferred removal.`,
        );
        return await data.scheduleInboxMsgRemoval(msg.msgId);
      }

      // Noted on receipt rather than on a successful apply: seeing a phantom
      // from another device is by itself the proof that this user has one, and
      // that is what the indicator waits for before saying anything at all.
      await localDataStoreSrv.noteOtherDeviceSeen(sourceDeviceId);

      syncActivity.beginApplyingInbound();
      try {
        await handleIncomingSync({
          syncMsg,
          db: data,
          emit: emitEventAfterAction,
          ownAddr,
          filesStore,
          observeSyncStamp: ts => localDataStoreSrv.observeSyncStamp(ts),
          resync: resyncCtx,
        });
      } finally {
        syncActivity.endApplyingInbound();
      }

      // Same reasoning: don't remove the phantom right after processing it here -
      // other devices (possibly offline right now) still need to see it.
      await w3n.log(
        'info',
        `Applied sync ${msg.msgId} from device ${sourceDeviceId} `
          + `(${describeSyncPhantom(syncMsg)}, ts ${syncMsg.timestamp}). Scheduling deferred removal.`,
      );
      return await data.scheduleInboxMsgRemoval(msg.msgId);
    }

    const chat = data.findChat(chatId);

    if (!chat) {
      return await removeMessageFromInbox(
        msg.msgId,
        `Incoming chat message ${msg.msgId}, type ${chatMsgBody.chatMessageType} has no known chat. Removing it from inbox.`,
      );
    }

    if (chat.isGroupChat && !includesAddress(Object.keys(chat.members), msg.sender)) {
      return await removeMessageFromInbox(
        msg.msgId,
        `Sender ${msg.msgId} is not a member of group chat ${chat.chatId}. Removing it from inbox.`,
      );
    }

    if (chatMsgBody.chatMessageType === 'system') {
      return await handleSystemMsg(msg, chat, chatMsgBody);
    }

    if (chatMsgBody.chatMessageType === 'regular') {
      return canReceiveRegularMessages(chat, ownAddr)
        ? await msgSending.handleRegularMsg(msg, chat, chatMsgBody)
        : void 0;
    }

    return await removeMessageFromInbox(
      msg.msgId,
      `Incoming chat message ${msg.msgId} has unrecognized type. Removing it from inbox.`,
    );
  }

  /**
   * Pulls messages still sitting in the shared inbox for one chat, without the
   * live inbox subscription.
   *
   * The subscription can go quiet (a platform defect seen on 2026-08-16), and
   * then the user receives nothing at all. This method is the way out: the
   * listing starts at the chat's last incoming message - incoming records keep
   * the delivery timestamp, which is exactly what inbox.listMsgs() reads - and
   * every listed message that belongs to this chat goes through the ordinary
   * handleIncomingMsg(), so the database writes, events and notifications are
   * the same as for a message that arrived by itself.
   *
   * Webrtc-call messages are left alone: they belong to VideoChatSrv, and
   * handleIncomingMsg() would not recognize them (it removes an unrecognized
   * message from the inbox). The global inbox watermark is deliberately not
   * touched - the catch-up scan keeps owning it, and reprocessing here is
   * idempotent.
   */
  async function forceRefreshChat(chatId: ChatIdObj): Promise<{ listed: number; applied: number }> {
    // The chat's last incoming message is the listing floor, so a pass does not
    // walk the whole shared inbox. It is not the measure of "new" though: the
    // listing can turn up system updates and phantoms of this device too, so
    // newness is gauged by the chat's own row count, which only a message that
    // actually adds a record moves.
    const fromTS = data.getLatestIncomingMsgTimestampInChat(chatId) ?? INBOX_SCAN_FLOOR_MS;
    const messagesBefore = data.countMessagesInChat(chatId);
    const listed = await w3n.mail!.inbox.listMsgs(fromTS);

    for (const { msgId, msgType } of listed) {
      if (msgType !== 'chat') { continue; }

      const msg = await w3n.mail!.inbox.getMsg(msgId).catch(err => {
        w3n.log('error', `Force-refresh: fail to get inbox message ${msgId}`, err).catch(() => {});
        return undefined;
      });
      if (!msg) { continue; }

      const incoming = msg as ChatIncomingMessage;
      const body = incoming.jsonBody;
      if (body?.chatMessageType === 'webrtc-call') { continue; }

      let msgChatId: ChatIdObj | undefined;
      if (body?.chatMessageType === 'synchronization') {
        const syncMsg = body as ChatSyncMsgV1<
          PhantomSyncMsgDataBasedOnRegularMsgV1 | ChatSystemMsgV1 | ChatInvitationMsgV1
        >;
        // A phantom of this very device is the echo of a message sent here, not
        // a new message for the chat.
        if (syncMsg.sourceDeviceId === getAppDeviceId()) { continue; }
        msgChatId = syncMsg.chatId;
      } else {
        msgChatId = checkChatMessageJSON(incoming)?.chatId;
      }

      if (!msgChatId || !areChatIdsEqual(msgChatId, chatId)) { continue; }

      await handleIncomingMsg(incoming);
    }

    const applied = Math.max(0, data.countMessagesInChat(chatId) - messagesBefore);
    return { listed: listed.length, applied };
  }

  async function handleSystemMsg(
    msg: ChatIncomingMessage,
    chat: ChatDbEntry,
    chatMsgBody: ChatSystemMsgV1,
  ): Promise<void> {
    const { chatSystemData: sysData, chatMessageId } = chatMsgBody;

    switch (sysData.event) {
      case 'update:status':
        await msgStatusUpdating.handleUpdateMessageStatus(msg.sender, chat, sysData.value, msg.deliveryTS);
        break;

      case 'delete:message':
        await msgDeletion.handleDeleteChatMessage(chat, sysData.value);
        break;

      case 'update:members':
        await chatMembersUpdating.handleUpdateChatMembers(
          msg.sender,
          chat,
          chatMessageId!,
          msg.deliveryTS,
          sysData.value,
        );
        break;

      case 'update:admins':
        await chatMembersUpdating.handleUpdateChatAdmins(
          msg.sender,
          chat,
          chatMessageId!,
          msg.deliveryTS,
          sysData.value,
        );
        break;

      case 'update:chatName':
        await chatRenaming.handleUpdateChatName(msg.sender, chat, chatMessageId!, msg.deliveryTS, sysData);
        break;

      case 'update:settings':
        await chatSettingUp.handleUpdateSettings(msg.sender, chat, chatMessageId!, msg.deliveryTS, sysData);
        break;

      case 'member-removed':
        await chatMemberRemoval.handleMemberRemovedChat(
          msg.sender,
          chat,
          chatMessageId!,
          msg.deliveryTS,
          sysData.chatDeleted,
        );
        break;

      case 'webrtc-call': {
        // Our own view of the chat, not the `chatId` the sender put in the body:
        // for a one-to-one chat that is the sender's projection of it, i.e. this
        // very user's address.
        const callChatId: ChatIdObj = {
          isGroupChat: chat.isGroupChat,
          chatId: chat.isGroupChat ? chat.chatId : chat.peerCAddr,
        };
        await webRTCCallReaction.handleReactionToWebRTCCall(msg, {
          ...sysData.value,
          chatId: callChatId,
        });
        // Reported to the rest of this process as well, so that acting on a
        // cancelled call does not depend on a window being open. Each handler is
        // guarded: this function's caller only takes the message out of the inbox
        // once it returns, so a throwing listener would leave it there for good.
        for (const handler of callSysMsgHandlers) {
          try {
            handler({
              chatId: callChatId,
              sender: msg.sender,
              subType: sysData.value.subType,
              callSessionId: sysData.value.callSessionId,
              deliveryTS: msg.deliveryTS,
            });
          } catch (err) {
            await w3n.log('error', `Handler of an incoming call system message threw`, err);
          }
        }
        break;
      }

      case 'update:body':
        await msgEditing.handleUpdateOfMessageBody({
          user: msg.sender,
          chatId: chat.isGroupChat
            ? { isGroupChat: true, chatId: chat.chatId }
            : { isGroupChat: false, chatId: chat.peerCAddr },
          chatMessageId: (sysData as UpdatedMsgBodySysMsgData).value.chatMessageId,
          timestamp: msg.deliveryTS,
          body: (sysData as UpdatedMsgBodySysMsgData).value.body,
        });
        break;

      case 'update:reactions':
        await msgReactions.handleChangeOfReactions({
          user: msg.sender,
          chatId: chat.isGroupChat
            ? { isGroupChat: true, chatId: chat.chatId }
            : { isGroupChat: false, chatId: chat.peerCAddr },
          chatMessageId: (sysData as UpdatedMsgReactionSysMsgData).value.chatMessageId,
          timestamp: msg.deliveryTS,
          reactions: (sysData as UpdatedMsgReactionSysMsgData).value.reactions,
        });
        break;

      default:
        await w3n.log(
          'info',
          `No handler found to handle chat system event ${(sysData as ChatSystemMessageData).event}`,
        );
        break;
    }

    // Schedule deferred removal only once the event is durably applied - if a
    // handler above threw, the message stays in the inbox and gets a chance to
    // be reprocessed on the next start-up instead of being silently lost.
    await data.scheduleInboxMsgRemoval(msg.msgId);
  }

  async function createOneToOneChat(
    params: Pick<SingleChatView, 'peerAddr' | 'name'> & { ownName?: string },
  ): Promise<ChatIdObj> {
    const res = await ensureAllAddressesExist({ [params.peerAddr]: { hasAccepted: false } });

    if (res.status === 'error') {
      throw {
        runtimeException: true,
        type: 'chat-creation',
        failedAddresses: res.errorData,
      };
    }

    let ownName = params.ownName;
    if (!ownName) {
      const user = await w3n.mail?.getUserId();
      ownName = user!.substring(0, user!.indexOf('@'));
    }

    return chatCreation.createOneToOneChat({
      ...params,
      ownName,
    });
  }

  async function acceptChatInvitation(chatId: ChatIdObj, chatMessageId: string, ownName: string): Promise<void> {
    return chatCreation.acceptChatInvitation(chatId, chatMessageId, ownName);
  }

  async function createGroupChat(params: Pick<GroupChatView, 'chatId' | 'members' | 'name'>): Promise<ChatIdObj> {
    const res = await ensureAllAddressesExist(params.members);
    if (res.status === 'error') {
      throw {
        runtimeException: true,
        type: 'chat-creation',
        failedAddresses: res.errorData,
      };
    }

    const user = await w3n.mail?.getUserId();
    let groupMembers = { ...params.members };
    if (!includesAddress(Object.keys(groupMembers), user!)) {
      groupMembers = {
        ...groupMembers,
        [user!]: { hasAccepted: true },
      };
    }

    return chatCreation.createGroupChat({
      ...params,
      members: groupMembers,
      admins: [user!],
    });
  }

  async function getChatList(): Promise<ChatListItemView[]> {
    return data.getChatList().map(chat => {
      if (chat.isGroupChat) {
        return chatViewForGroupChat(chat);
      } else {
        return chatViewForOTOChat(chat);
      }
    });
  }

  async function getChat(chatId: ChatIdObj): Promise<ChatListItemView | undefined> {
    const chat = data.findChat(chatId);
    return chat ? chatViewFromChatDbEntry(chat) : undefined;
  }

  function findChatEntry(chatId: ChatIdObj, throwIfMissing = false): ChatDbEntry | undefined {
    const chat = data.findChat(chatId);

    if (chat) {
      return chat;
    }

    if (throwIfMissing) {
      throw makeDbRecordException({ chatNotFound: true });
    }
  }

  async function getMessage(id: ChatMessageId): Promise<ChatMessageView | undefined> {
    const found = await data.getMessage(id);
    if (found) {
      return msgViewFromDbEntry(found, found.relatedMessage ?? undefined, ownAddr);
    }
  }

  async function getMessagesByChat(chatId: ChatIdObj): Promise<ChatMessageView[]> {
    const msgViews: ChatMessageView[] = [];

    for (const msg of await data.getMessagesByChat(chatId)) {
      msgViews.push(msgViewFromDbEntry(msg, msg.relatedMessage ?? undefined, ownAddr));
    }

    return msgViews;
  }

  async function getMessagesPageByChat(
    chatId: ChatIdObj,
    { limit, before }: { limit: number; before?: MsgPageCursor },
  ): Promise<{ msgs: ChatMessageView[]; hasMoreOlder: boolean }> {
    // One record over the asked-for page tells whether anything precedes it,
    // sparing a second COUNT(*) query
    const entries = data.getMessagesPageInChat(chatId, limit + 1, before);
    const hasMoreOlder = entries.length > limit;
    const page = hasMoreOlder ? entries.slice(entries.length - limit) : entries;
    const msgs: ChatMessageView[] = [];

    for (const msg of page) {
      msgs.push(msgViewFromDbEntry(msg, msg.relatedMessage ?? undefined, ownAddr));
    }

    return { msgs, hasMoreOlder };
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
    return msgSending.sendRegularMessage({ chatId, chatMessageId, text, files, relatedMessage });
  }

  async function cancelSendingMessage(deliveryId: string, chatMsgId: ChatMessageId): Promise<void> {
    await msgSending.cancelSendingMessage(deliveryId);
    await msgStatusUpdating.updateMessageStatus(chatMsgId, 'canceled');

    // Cancelling removes the delivery, hence no progress event will ever report
    // this terminal status. Other devices, which show the message as
    // 'syncing_self', have to be told about it explicitly.
    const msg = await data.getMessage(chatMsgId);
    if (msg) {
      await queueSyncPhantom({
        db: data,
        ownAddr,
        phantom: makeMsgRecordPhantom({
          chatId: chatMsgId.chatId,
          sourceDeviceId: getAppDeviceId(),
          timestamp: await nextSyncStamp(),
          msg,
        }),
        entity: {
          entityType: 'msg',
          entityId: msgEntityId(chatMsgId.chatId, chatMsgId.chatMessageId),
          aspect: 'record',
        },
      });
    }
  }

  async function sendSystemDeletableMessage({
    chatId,
    recipients,
    chatMessageId,
    chatSystemData,
  }: { chatId: ChatIdObj; recipients: string[] } & Pick<
    ChatSystemMsgV1,
    'chatMessageId' | 'chatSystemData'
  >): Promise<void> {
    return _sendSystemDeletableMessage({
      chatId,
      recipients,
      chatMessageId,
      chatSystemData,
    });
  }

  async function updateEarlySentMessage({
    chatId,
    chatMessageId,
    updatedBody,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
    updatedBody: string;
  }): Promise<ChatMessageView | undefined> {
    const updatedMessage = await msgEditing.editMessage({ chatId, chatMessageId, updatedBody });
    if (!updatedMessage) {
      return undefined;
    }

    const chat = await getChat(chatId);
    const recipients = chat!.isGroupChat
      ? Object.keys(chat!.members).filter(addr => addr !== ownAddr)
      : [chat!.peerAddr];

    sendSystemDeletableMessage({
      chatId,
      recipients,
      chatMessageId,
      chatSystemData: {
        event: 'update:body',
        value: {
          chatMessageId,
          body: updatedBody,
        },
      } as UpdatedMsgBodySysMsgData,
    });

    return msgViewFromDbEntry(
      updatedMessage,
      updatedMessage.relatedMessage as RegularMsgView['relatedMessage'],
      ownAddr,
    );
  }

  async function changeMessageReaction({
    chatId,
    chatMessageId,
    updatedReactions,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
    updatedReactions: Record<string, ChatMessageReaction>;
  }): Promise<ChatMessageView | undefined> {
    const updatedMessage = await msgReactions.changeMessageReactions({
      chatId,
      chatMessageId,
      updatedReactions,
    });
    if (!updatedMessage) {
      return undefined;
    }

    const chat = await getChat(chatId);
    const recipients = chat!.isGroupChat
      ? Object.keys(chat!.members).filter(addr => addr !== ownAddr)
      : [chat!.peerAddr];

    sendSystemDeletableMessage({
      chatId,
      recipients,
      chatMessageId,
      chatSystemData: {
        event: 'update:reactions',
        value: {
          chatMessageId,
          reactions: updatedReactions,
        },
      } as UpdatedMsgReactionSysMsgData,
    });

    return msgViewFromDbEntry(
      updatedMessage,
      updatedMessage.relatedMessage as RegularMsgView['relatedMessage'],
      ownAddr,
    );
  }

  async function makeAndSaveMsgToDb(ownAddr: string, msgData: Partial<MsgDbEntry>): Promise<ChatMessageView> {
    const { chatMessageId } = msgData;
    if (!chatMessageId) {
      throw Error('There is no chatMessageId in the message being created.');
    }

    const chatMessageType = msgData.chatMessageType || 'regular';
    const msgDbEntry: MsgDbEntry = {
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
      status: chatMessageType === 'regular' ? (msgData.isIncomingMsg ? 'unread' : 'ready_to_send') : null,
      timestamp: 0,
      removeAfter: 0,
      settings: null,
      ...msgData,
      chatMessageType,
      chatMessageId,
    };
    await data.addMessage(msgDbEntry);

    return msgViewFromDbEntry(msgDbEntry, msgDbEntry.relatedMessage as RegularMsgView['relatedMessage'], ownAddr);
  }

  /**
   * Stamps and synchronizes a system event whose record is created purely
   * locally, with nothing ever sent to peers - a call record, say. Such events
   * had no way to reach the user's other devices at all while synchronization
   * hung off delivery progress to peers.
   */
  async function syncLocallyMadeSystemEvent(
    chatId: ChatIdObj,
    chatMessageId: string,
    chatSystemData: ChatSystemMessageData,
  ): Promise<void> {
    const syncStamp = await nextSyncStamp();

    // Creation of a record needs no version of its own - it is guarded by
    // tombstones instead; an update of one does.
    const isBodyUpdate = chatSystemData.event === 'update:body';
    const entityId = msgEntityId(chatId, chatMessageId);

    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeSystemEventPhantom({
        chatId,
        sourceDeviceId: getAppDeviceId(),
        timestamp: syncStamp,
        chatMessageId,
        chatSystemData,
      }),
      versions: isBodyUpdate
        ? [
            {
              entityType: 'msg',
              entityId,
              aspect: 'body',
              ts: syncStamp,
              deviceId: getAppDeviceId(),
            },
          ]
        : undefined,
      entity: isBodyUpdate ? undefined : { entityType: 'msg', entityId, aspect: 'record' },
    });
  }

  /**
   * Writes a system record of a decision this device took on its own, and puts
   * its phantom on the way - in one call, because the two must not be separable.
   *
   * A record written straight into the db with makeAndSaveMsgToDb is invisible
   * to the user's other devices forever: nothing about it goes on the wire, so
   * there is nothing for them to reconstruct it from. That is how the "call was
   * cancelled" line came to exist only on the device where Decline was pressed.
   *
   * The body is serialized here rather than by the caller: it and the phantom
   * describe the same event, and callers that build them apart let them drift.
   *
   * Records like these carry ids derived from the event they are about (see
   * chatMessageIdForCallEvent), so the id may already be taken - by a device of
   * ours whose phantom arrived first, or by a repeat of the action. addMessage
   * is a bare INSERT, so that has to be checked here rather than left to each
   * caller.
   */
  async function saveAndSyncLocalSystemMsg(
    ownAddr: string,
    chatId: ChatIdObj,
    chatSystemData: ChatSystemMessageData,
    msgData: Partial<MsgDbEntry>,
  ): Promise<ChatMessageView> {
    const { chatMessageId } = msgData;
    if (chatMessageId) {
      const existing = await getMessage({ chatId, chatMessageId });
      if (existing) {
        return existing;
      }
    }

    const msgView = await makeAndSaveMsgToDb(ownAddr, {
      ...msgData,
      chatMessageType: 'system',
      body: JSON.stringify(chatSystemData),
    });
    await syncLocallyMadeSystemEvent(chatId, msgView.chatMessageId, chatSystemData);
    return msgView;
  }

  const methods: ChatSrv = {
    emitEventsOutward: emitEventAfterAction,
    getAppDeviceId,
    logFromGui,
    handleIncomingMsg,
    forceRefreshChat,
    createOneToOneChat,
    acceptChatInvitation,
    createGroupChat,
    getChatList,
    renameChat: chatRenaming.renameChat,
    chatSetUp: chatSettingUp.setUp,
    deleteChat: chatDeletion.deleteChat,
    updateGroupMembers: chatMembersUpdating.updateGroupMembers,
    updateGroupAdmins: chatMembersUpdating.updateGroupAdmins,
    getChat,
    findChatEntry,
    deleteMessagesInChat: msgDeletion.deleteMessagesInChat,
    deleteMessage: msgDeletion.deleteMessage,
    deleteMessages: msgDeletion.deleteMessages,
    deleteExpiredMessages: msgDeletion.deleteExpiredMessages,
    collectGarbageInAuxiliaryDB: data.collectGarbageInAuxiliaryDB,
    removeExpiredInboxMessages: msgDeletion.removeExpiredInboxMessages,
    resolveStuckSyncingSelfMessages: msgStatusUpdating.resolveStuckSyncingSelfMessages,
    collectGarbageInSyncVersions: data.collectGarbageInSyncVersions,
    // The outcome is reported by the pass itself, through the sink wired above:
    // this method is one caller of many, and the ones it is not are the ones
    // that run while the user is doing something.
    releasePendingSyncPhantoms: () => releasePendingSyncPhantoms(data, ownAddr),
    countPendingSyncPhantoms: async () => countPhantomsAwaitingRelease(data),
    countSyncPhantomsInDelivery: async () => countSyncPhantomsInDelivery(),
    getSyncActivityState: async () => syncActivity.snapshot(),
    requestResyncForStuckOrphans: () => requestResyncForStuckOrphans(resyncCtx),
    setResyncBusyCheck: isBusy => {
      resyncCtx.isBusy = isBusy;
    },
    syncLocallyMadeSystemEvent,
    getBlacklistedAddresses: async () => blacklistTracker?.getBlacklist() ?? [],
    getLatestIncomingMsgTimestamp: data.getLatestIncomingMsgTimestamp,
    getMessage,
    getMessagesByChat,
    getMessagesPageByChat,
    getIncomingMessage,
    getRecentReactions: data.getRecentReactions,
    getThumbnails: async id => data.getThumbnails(id),
    saveThumbnail: (id, fileName, dataUrl) => saveThumbnailWithinLimit(data, id, fileName, dataUrl),
    sendRegularMessage,
    cancelSendingMessage,
    markMessageAsReadNotifyingSender: msgStatusUpdating.markMessageAsReadNotifyingSender,
    checkAddressExistenceForASMail: checkAddressExistenceForASMail,
    sendSystemDeletableMessage,
    updateEarlySentMessage,
    changeMessageReaction,
    makeAndSaveMsgToDb,
    saveAndSyncLocalSystemMsg,
    createBackupPlan: backupSrv.createBackupPlan,
    cancelBackupPlan: backupSrv.cancelBackupPlan,
    previewRestore: backupSrv.previewRestore,
    restoreBackupArchive: backupSrv.restoreBackupArchive,
    watch,
    onIncomingCallSysMsg,
  };

  // A change of the blacklist leaves its mark in the chats of the contact it
  // is about. Registered here, before the tracker is started in index.ts: a
  // change arriving with no handler in place is not replayed.
  if (blacklistTracker) {
    const { handleBlacklistChanges } = contactBlockingRecords({
      data,
      emit: emitEventAfterAction,
      ownAddr,
    });
    blacklistTracker.setChangeHandler(changes => {
      handleBlacklistChanges(changes).catch(err =>
        w3n.log('error', `Fail to write contact blocking records`, err),
      );
    });
  }

  // IPC exposure is NOT done here: it must happen at the very start of the
  // component (see index.ts), long before this service can be constructed.

  return {
    chatsSrv: methods,
    syncActivity,
  };
}
