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
  ChatSyncMsgV1,
  ChatSystemMsgV1,
  PhantomSyncMsgDataBasedOnRegularMsgV1,
} from '../../../types/asmail-msgs.types.ts';
import type { ChatSrv } from '../../types/index.ts';
import { areAddressesEqual, includesAddress } from '../../../shared-libs/address-utils.ts';
import { areChatIdsEqual, chatIdToString } from '../../../shared-libs/chat-ids.ts';
import { INBOX_SCAN_FLOOR_MS } from '../../../shared-libs/constants/index.ts';
import {
  canReceiveRegularMessages,
  checkChatMessageJSON,
  removeMessageFromInbox,
} from './utils/_msgs-related-methods.ts';
import { handleIncomingSync } from './utils/handle-incoming-sync.ts';
import { makeIncomingSystemMsgs } from './incoming-system-msgs.ts';
import type { ChatSrvCtx } from './chat-srv-ctx.ts';

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

/**
 * Everything that comes into the chat service from the inbox: peers' messages,
 * invitations, and phantoms of the user's other devices - in the live flow and
 * in a refresh of one chat asked for by the user.
 */
export function makeIncomingMessages(ctx: ChatSrvCtx) {
  const {
    ownAddr,
    data,
    blacklistTracker,
    filesStore,
    syncActivity,
    resyncCtx,
    getAppDeviceId,
    localDataStore: localDataStoreSrv,
    emit: emitEventAfterAction,
    chatCreation,
    msgSending,
  } = ctx;

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

  const { handleSystemMsg } = makeIncomingSystemMsgs(ctx, callSysMsgHandlers);

  function canReceiveInChat(chatId: ChatIdObj | undefined): boolean {
    const chat = chatId && data.findChat(chatId);
    if (!chat) {
      return false;
    }
    try {
      return canReceiveRegularMessages(chat, ownAddr);
    } catch {
      // A group chat that does not list the user among its members.
      return false;
    }
  }

  const chatsBeingCaughtUp = new Set<string>();

  /**
   * Picks up the regular messages a chat skipped while it could not receive
   * them.
   *
   * An incoming regular message of a chat that is still 'invited' is not
   * handled (see handleIncomingMsg) and the inbox watermark moves past it, so
   * nothing ever came back for it once the chat got switched on - the peer's
   * messages stayed in the inbox and never reached the history. The pass is
   * forceRefreshChat(): it lists the inbox from the chat's latest incoming
   * record, which for such a chat is the invitation itself.
   *
   * Not awaited: it is started from inside the processing of an inbox message,
   * and forceRefreshChat() goes through handleIncomingMsg() itself - the same
   * overlap a refresh asked for by the user has always had with the inbox queue.
   */
  function catchUpChatOpenedForReceiving(chatId: ChatIdObj, reason: string): void {
    const key = chatIdToString(chatId);
    if (chatsBeingCaughtUp.has(key)) {
      return;
    }
    chatsBeingCaughtUp.add(key);
    (async () => {
      try {
        await w3n.log('info', `Chat ${chatId.chatId} can receive messages now (${reason}); catching up on the inbox`);
        const { listed, applied } = await forceRefreshChat(chatId);
        await w3n.log('info', `Catch-up of chat ${chatId.chatId}: ${listed} listed, ${applied} added`);
      } catch (err) {
        await w3n.log('error', `Catch-up of chat ${chatId.chatId} after it was switched on failed`, err);
      } finally {
        chatsBeingCaughtUp.delete(key);
      }
    })().catch(() => {});
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
      const couldReceive = canReceiveInChat(chatId);
      await chatCreation.handleChatInvitation(msg);
      if (!couldReceive && canReceiveInChat(chatId)) {
        catchUpChatOpenedForReceiving(chatId, `invitation ${msg.msgId}`);
      }
      return;
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

      const couldReceive = canReceiveInChat(syncMsg.chatId);
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

      if (!couldReceive && canReceiveInChat(syncMsg.chatId)) {
        catchUpChatOpenedForReceiving(syncMsg.chatId, `sync ${msg.msgId}`);
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

  return {
    handleIncomingMsg,
    forceRefreshChat,
    onIncomingCallSysMsg,
    canReceiveInChat,
    catchUpChatOpenedForReceiving,
  };
}

export type IncomingMessages = ReturnType<typeof makeIncomingMessages>;
