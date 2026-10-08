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
  ChatSrvEmit,
  DB,
  FileStoreService,
  GroupChatDbEntry,
  MsgDbEntry,
  OTOChatDbEntry,
} from '../../../types/index.ts';
import type {
  GroupChatStatus,
  GroupChatView,
  SingleChatStatus,
  SingleChatView,
} from '../../../../types/chat.types.ts';
import type {
  AcceptedInvitationReference,
  ChatIdObj,
  ChatIncomingMessage,
  ChatInvitationMsgV1,
  ChatMessageId,
  GroupChatParameters,
  OneToOneChatParameters,
  UpdatedMembersInvitationData,
} from '../../../../types/asmail-msgs.types.ts';
import type { OpenChatCmdArg } from '../../../../types/chat-commands.types.ts';
import { LOGO_ICON_AS_ARRAY } from '../../../../src-main/common/constants/files.ts';
import { AppSettings } from '../../../utils/app-settings.ts';
import {
  sendChatInvitation,
  makeInvitationPhantom,
  makeInvitationAcceptedPhantom,
  queueSyncPhantom,
} from '../../mail-sending-service/index.ts';
import { makeDbRecordException } from '../../../utils/exceptions.ts';
import { replaceSystemNotification } from '../../../utils/system-notifications.ts';
import { generateChatMessageId } from '../../../../shared-libs/chat-ids.ts';
import { includesAddress } from '../../../../shared-libs/address-utils.ts';
import { toCanonicalAddress } from '../../../../shared-libs/address-utils.ts';
import { inviteChatId, serializeInvitation } from './_common.ts';
import { chatIdOfGroupChat, chatIdOfOTOChat, excludeAddrFrom } from './_chats-related-methods.ts';
import { makeMsgDbEntry, removeMessageFromInbox } from './_msgs-related-methods.ts';
import { processOrphanedForChatCreation } from './handle-incoming-sync.ts';
import type { ResyncCtx } from './msg-resync.ts';
import { chatEntityId } from './sync-versions.ts';

export async function chatCreation({
  data,
  emit,
  appSettings,
  ownAddr,
  filesStore,
  getAppDeviceId,
  nextSyncStamp,
  resync,
}: {
  data: DB;
  emit: ChatSrvEmit;
  appSettings: AppSettings;
  ownAddr: string;
  filesStore: FileStoreService;
  getAppDeviceId: () => string;
  nextSyncStamp: () => Promise<number>;
  resync?: ResyncCtx;
}) {
  /**
   * Phantoms of this chat's content may have arrived before the chat itself
   * and sit in the orphan buffer. Draining used to happen only when the chat
   * was created from an *own-devices* invitation sync; a chat created from a
   * peer's real invitation (or made locally) left them stuck until the 15-day
   * garbage collection - the chat existed, but stayed empty.
   */
  async function drainOrphanedSyncsOf(chatId: ChatIdObj): Promise<void> {
    try {
      await processOrphanedForChatCreation(data, emit, filesStore, chatId, ownAddr, resync);
    } catch (err) {
      await w3n.log('error', `Failed to process orphaned syncs buffered before chat ${chatId.chatId} existed`, err);
    }
  }
  /**
   * An invitation phantom carries the chat record itself rather than a change
   * of one of its aspects, so there is no version to stamp - creation is
   * guarded by tombstones instead.
   */
  async function sendInvitationSync(
    chatId: ChatIdObj,
    chatMessageId: string,
    inviteData: ChatInvitationMsgV1['inviteData'],
  ): Promise<void> {
    const syncStamp = await nextSyncStamp();
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeInvitationPhantom({
        chatId,
        sourceDeviceId: getAppDeviceId(),
        timestamp: syncStamp,
        chatMessageId,
        inviteData,
      }),
      entity: { entityType: 'chat', entityId: chatEntityId(chatId), aspect: 'record' },
    });
  }

  async function sendInvitationAcceptedSync(
    chatId: ChatIdObj,
    status: GroupChatStatus | SingleChatStatus,
  ): Promise<void> {
    const syncStamp = await nextSyncStamp();
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeInvitationAcceptedPhantom({
        chatId,
        sourceDeviceId: getAppDeviceId(),
        timestamp: syncStamp,
        value: { sender: ownAddr, status },
      }),
      versions: [
        {
          entityType: 'chat',
          entityId: chatEntityId(chatId),
          aspect: 'status',
          ts: syncStamp,
          deviceId: getAppDeviceId(),
        },
      ],
    });
  }

  async function showSystemNotification(
    { sender, chatId, chatName }: { sender: string; chatId: ChatIdObj; chatName?: string },
  ) {
    const icon = Uint8Array.from(LOGO_ICON_AS_ARRAY);
    const notificationTitle = chatName
      ? await appSettings.t('app.notification.group_invite', { sender, chatName })
      : await appSettings.t('app.notification.invite', { sender });
    await replaceSystemNotification({
      icon,
      title: notificationTitle,
      cmd: {
        cmd: 'open-chat-with',
        params: [
          {
            chatId,
            peerAddress: sender,
          } as OpenChatCmdArg,
        ],
      },
    });
  }

  /**
   * Puts a peer's acceptance of an invitation into the chat history.
   *
   * `timestamp` is the message's `deliveryTS`, not the moment of processing, and
   * that is the whole point of passing it in: the history is ordered by
   * timestamp alone (ORDER BY timestamp in msgs-db.ts), while this record is
   * created by every one of the user's devices on its own from the same shared
   * inbox message - there is no phantom for it. A device that reads that message
   * an hour later used to stamp it with its own clock, which put the acceptance
   * of an invitation *after* every message that followed it (seen on a device
   * started 13 minutes into a chat, 2026-08-14). deliveryTS is stamped once by
   * the ASMail server, so all devices derive the same one - the same reasoning as
   * for a peer's system events, spelled out in chat-renaming.ts.
   */
  async function createDisplayableSystemMessage({
    chatId,
    sender,
    dedupeKey,
    timestamp,
  }: {
    chatId: ChatIdObj;
    sender: string;
    dedupeKey: string;
    timestamp: number;
  }) {
    const chatMessageId = `accept-invitation:${dedupeKey}`;
    const existingMsg = await data.getMessage({ chatId, chatMessageId });
    if (existingMsg) {
      // Already created - this is a redelivery within the deferred inbox
      // removal window (P1); re-creating would either violate the messages
      // table PK (deterministic id) or, with a fresh random id, silently
      // duplicate this notification in the chat history.
      //
      // A record left by an earlier build carries the processing time instead of
      // deliveryTS, and a redelivery is the one occasion on which that can be
      // repaired: the id is deterministic, so this is the same record, and the
      // message keeps being listed by catch-up scans for the fifteen days it
      // stays in the inbox.
      if (existingMsg.timestamp !== timestamp) {
        const fixed = await data.updateMessageRecord({ chatId, chatMessageId }, { timestamp });
        if (fixed) {
          emit.message.updated(fixed);
          await w3n.log(
            'info',
            `Restamped the 'invitation accepted' record ${chatMessageId} from ${existingMsg.timestamp} `
              + `to the message's deliveryTS ${timestamp}, so that it sits where it belongs in history.`,
          );
        }
      }
      return;
    }

    const msg: MsgDbEntry = {
      groupChatId: chatId.isGroupChat ? chatId.chatId : null,
      otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
      chatMessageId,
      isIncomingMsg: false,
      incomingMsgId: null,
      groupSender: chatId.isGroupChat ? sender : null,
      body: JSON.stringify({
        event: 'accept:invitation',
        value: { sender },
      }),
      attachments: null,
      chatMessageType: 'system',
      relatedMessage: null,
      status: null,
      timestamp,
      history: null,
      reactions: null,
      settings: null,
      removeAfter: 0,
    };

    await data.addMessage(msg);
    emit.message.added(msg);
  }

  async function createOneToOneChat({
    peerAddr,
    name,
    ownName,
  }: Pick<SingleChatView, 'peerAddr' | 'name'> & { ownName: string }): Promise<ChatIdObj> {
    const existingChat = data.findChat({ isGroupChat: false, chatId: toCanonicalAddress(peerAddr) });

    if (existingChat) {
      return chatIdOfOTOChat(existingChat as OTOChatDbEntry);
    }

    const chat = await data.addOneToOneChat({
      peerAddr,
      name,
      settings: {
        autoDeleteMessages: '1',
      },
      status: 'initiated',
    });
    emit.chat.added(chat);

    // send invitations, recoding it locally as well
    const { chatMessageId, timestamp } = generateChatMessageId();
    const inviteData: OneToOneChatParameters = {
      type: 'oto-chat-invite',
      name: ownName,
    };
    const msg = makeMsgDbEntry('invitation', chatMessageId, {
      otoPeerCAddr: chat.peerCAddr,
      body: JSON.stringify(inviteData),
      timestamp,
    });

    await data.addMessage(msg);
    emit.message.added(msg);

    const chatId = chatIdOfOTOChat(chat);

    // own other devices must learn about this chat regardless of whether the
    // invitation ever reaches the peer
    await sendInvitationSync(chatId, chatMessageId, {
      type: 'oto-chat-invite',
      name, // peer's real display name (chat record), not ownName sent to the peer below
      status: chat.status,
      settings: chat.settings ?? undefined,
    });

    await sendChatInvitation(chatId, [peerAddr], {
      chatMessageId,
      inviteData,
    });

    await drainOrphanedSyncsOf(chatId);

    return chatId;
  }

  async function createGroupChat({
    chatId: groupChatId,
    name,
    members,
    admins,
  }: Pick<GroupChatView, 'chatId' | 'members' | 'admins' | 'name'>): Promise<ChatIdObj> {
    // some checks
    if (!includesAddress(Object.keys(members), ownAddr) || !includesAddress(admins, ownAddr)) {
      throw new Error(`Own address is not among of both members and admins`);
    }

    const existingChat = data.findChat({ isGroupChat: true, chatId: groupChatId });

    if (existingChat) {
      return chatIdOfGroupChat(existingChat as GroupChatDbEntry);
    }

    // create chat db record
    const chat = await data.addGroupChat({
      chatId: groupChatId,
      name,
      members,
      admins,
      settings: {
        autoDeleteMessages: '1',
      },
      status: 'initiated',
    });
    emit.chat.added(chat);
    const chatId = chatIdOfGroupChat(chat);

    // send invitations, recoding it locally as well
    const recipients = excludeAddrFrom(Object.keys(chat.members), ownAddr);
    if (recipients.length > 0) {
      const { chatMessageId, timestamp } = generateChatMessageId();
      const inviteData: GroupChatParameters = {
        type: 'group-chat-invite',
        groupChatId,
        name,
        members,
        admins,
      };

      const msg = makeMsgDbEntry('invitation', chatMessageId, {
        groupChatId: chat.chatId,
        body: JSON.stringify(inviteData),
        timestamp,
      });
      await data.addMessage(msg);
      emit.message.added(msg);

      // own other devices must learn about this chat regardless of whether
      // the invitation ever reaches any peer
      await sendInvitationSync(chatId, chatMessageId, {
        ...inviteData,
        status: chat.status,
        settings: chat.settings ?? undefined,
      });

      await sendChatInvitation(chatId, recipients, { chatMessageId, inviteData });
    }

    await drainOrphanedSyncsOf(chatId);

    return chatId;
  }

  /* Creating a new one-to-one chat based on an invitation message */
  async function handleOTOChatInvitation(
    sender: string,
    chatMessageId: string,
    inviteParams: OneToOneChatParameters,
    incomingMsgId: string,
    deliveryTS: number,
    neverContactedInitiator: boolean,
  ): Promise<void> {
    // create chat db record
    const chat = await data.addOneToOneChat({
      peerAddr: sender,
      name: inviteParams.name,
      settings: {
        autoDeleteMessages: '1',
      },
      status: 'invited',
    });
    emit.chat.added(chat);

    // record locally invitation message
    const msg = makeMsgDbEntry('invitation', chatMessageId, {
      isIncomingMsg: true,
      incomingMsgId,
      otoPeerCAddr: chat.peerCAddr,
      body: serializeInvitation({
        ...inviteParams,
        neverContactedInitiator,
      }),
      status: 'unread',
      timestamp: deliveryTS,
      removeAfter: 0,
      settings: null,
    });

    await data.addMessage(msg);
    emit.message.added(msg);
    await showSystemNotification({ sender, chatId: { isGroupChat: false, chatId: chat.peerCAddr } });
    await drainOrphanedSyncsOf({ isGroupChat: false, chatId: chat.peerCAddr });
  }

  /* Creating a new group chat based on an invitation message */
  async function handleGroupChatInvitation(
    sender: string,
    chatMessageId: string,
    inviteParams: GroupChatParameters,
    incomingMsgId: string,
    deliveryTS: number,
    neverContactedInitiator: boolean,
  ): Promise<void> {
    // create chat db record
    const chat = await data.addGroupChat({
      chatId: inviteParams.groupChatId,
      name: inviteParams.name,
      members: inviteParams.members!,
      admins: inviteParams.admins!,
      settings: {
        autoDeleteMessages: '1',
      },
      status: 'invited',
    });
    emit.chat.added(chat);

    // record locally invitation message
    const msg = makeMsgDbEntry('invitation', chatMessageId, {
      isIncomingMsg: true,
      incomingMsgId,
      groupSender: sender,
      groupChatId: inviteParams.groupChatId,
      body: serializeInvitation({
        ...inviteParams,
        neverContactedInitiator,
      }),
      status: 'unread',
      timestamp: deliveryTS,
      removeAfter: 0,
      settings: null,
    });

    await data.addMessage(msg);
    emit.message.added(msg);
    await showSystemNotification({
      sender,
      chatId: { isGroupChat: true, chatId: chat.chatId },
      chatName: chat.name,
    });
    await drainOrphanedSyncsOf({ isGroupChat: true, chatId: chat.chatId });
  }

  async function handleMalformedInvitation(msgId: string): Promise<void> {
    return await removeMessageFromInbox(
      msgId,
      `Incoming chat invitation message ${msgId} is malformed. Removing it from inbox.`,
    );
  }

  async function handleOTOChatInvitationAcceptance(
    chat: OTOChatDbEntry,
    chatMessageId: string,
    chatParams: OneToOneChatParameters,
    msgId: string,
  ): Promise<void> {
    const chatId = chatIdOfOTOChat(chat);
    const id: ChatMessageId = { chatId, chatMessageId };

    // update chat db record
    if (chat.status !== 'on') {
      const updatedChat = await data.updateOTOChatRecord(chat.peerCAddr, {
        name: chatParams.name,
        status: 'on',
      });

      updatedChat && emit.chat.updated(updatedChat);
    }

    // update messages db record
    const msg = await data.getMessage(id);
    if (msg && msg.status !== 'read') {
      // XXX add in history of this message an update of name with acceptance?
      const updatedMsg = await data.updateMessageRecord(id, {
        status: 'read',
      });

      updatedMsg && emit.message.updated(updatedMsg);
    }

    await data.scheduleInboxMsgRemoval(msgId);
  }

  async function handleGroupChatInvitationAcceptance(
    chat: GroupChatDbEntry,
    chatMessageId: string,
    acceptedInvitation: AcceptedInvitationReference,
    incomingMessage: ChatIncomingMessage,
  ): Promise<void> {
    const chatId = chatIdOfGroupChat(chat);
    const id: ChatMessageId = { chatId, chatMessageId };

    const msg = await data.getMessage(id);

    if (msg && msg.status !== 'read') {
      const updatedMsg = await data.updateMessageRecord(id, {
        status: 'read',
      });

      updatedMsg && emit.message.updated(updatedMsg);
    }

    const chatInitiator = (
      (incomingMessage.jsonBody as ChatInvitationMsgV1).inviteData as AcceptedInvitationReference
    )?.initiator;

    const updatedChatMembers = { ...chat.members };
    msg && (updatedChatMembers[incomingMessage.sender] = { hasAccepted: true });

    const areAllMembersAccepted = !Object.values(updatedChatMembers).some(data => !data.hasAccepted);

    let status: GroupChatStatus | undefined;
    if (
      areAllMembersAccepted ||
      (!areAllMembersAccepted && chatInitiator !== ownAddr && updatedChatMembers[ownAddr].hasAccepted)
    ) {
      status = 'on';
    } else {
      status = chatInitiator === ownAddr ? 'partially-on' : chat.status;
    }

    const updatedChat = await data.updateGroupChatRecord(chat.chatId, {
      members: updatedChatMembers,
      status,
    });

    updatedChat && emit.chat.updated(updatedChat);

    await data.scheduleInboxMsgRemoval(incomingMessage.msgId);

    const updateMembersData: UpdatedMembersInvitationData = {
      type: 'updated-members-invitation-data',
      chatId,
      members: Object.keys(updatedChatMembers).reduce((res, addr) => {
        const { hasAccepted } = updatedChatMembers[addr];
        if (hasAccepted) {
          res.push(addr);
        }

        return res;
      }, [] as string[]),
    };

    await sendChatInvitation(
      chatId,
      Object.keys(updatedChatMembers).reduce((res, addr) => {
        if (addr !== ownAddr) {
          res.push(addr);
        }
        return res;
      }, [] as string[]),
      { chatMessageId, inviteData: updateMembersData },
    );
  }

  async function handleInvitationAcceptance(
    sender: string,
    acceptedInvitation: AcceptedInvitationReference,
    message: ChatIncomingMessage,
  ): Promise<void> {
    const { groupChat, oneToOneChat, chatMessageId } = acceptedInvitation;
    const chatId = inviteChatId(sender, acceptedInvitation);

    if (!chatId) {
      return await removeMessageFromInbox(
        message.msgId,
        `Incoming chat invitation acceptance message ${message.msgId} is malformed. Removing it from inbox.`,
      );
    }

    const chat = data.findChat(chatId);
    if (!chat) {
      await removeMessageFromInbox(
        message.msgId,
        `Incoming chat invitation acceptance message ${message.msgId} is for unknown chat. Removing it from inbox.`,
      );
      return;
    }

    if (oneToOneChat) {
      await handleOTOChatInvitationAcceptance(chat as OTOChatDbEntry, chatMessageId, oneToOneChat, message.msgId);
    } else if (groupChat) {
      await handleGroupChatInvitationAcceptance(
        chat as GroupChatDbEntry,
        chatMessageId,
        acceptedInvitation!,
        message,
      );
    }

    await createDisplayableSystemMessage({
      chatId,
      sender,
      dedupeKey: message.msgId,
      timestamp: message.deliveryTS,
    });
  }

  async function handleUpdateMembersInvitationData(
    sender: string,
    chatId: ChatIdObj,
    acceptedMembers: string[],
    incomingMessage: ChatIncomingMessage,
  ): Promise<void> {
    const chat = data.findChat(chatId);
    if (!chat) {
      await removeMessageFromInbox(
        incomingMessage.msgId,
        `Incoming chat invitation acceptance message ${incomingMessage.msgId} is for unknown chat. Removing it from inbox.`,
      );
      return;
    }

    const { members, admins } = chat as GroupChatDbEntry;
    if (!admins.includes(sender)) {
      return;
    }

    const newAcceptedMembers = Object.keys(members).reduce((res, addr) => {
      const { hasAccepted } = members[addr];
      if (!hasAccepted && acceptedMembers.includes(addr)) {
        res.push(addr);
      }
      return res;
    }, [] as string[]);

    if (newAcceptedMembers.length === 0) {
      return;
    }

    const updatedChatMembers = { ...members };

    for (const acceptedMember of newAcceptedMembers) {
      if (acceptedMember !== ownAddr) {
        await createDisplayableSystemMessage({
          chatId,
          sender: acceptedMember,
          dedupeKey: `${incomingMessage.msgId}:${acceptedMember}`,
          timestamp: incomingMessage.deliveryTS,
        });
      }

      updatedChatMembers[acceptedMember] = { hasAccepted: true };
    }

    const updatedChat = await data.updateGroupChatRecord(chatId.chatId, {
      members: updatedChatMembers,
      ...(acceptedMembers.includes(ownAddr) && { status: 'on' }),
    });

    updatedChat && emit.chat.updated(updatedChat);

    await data.scheduleInboxMsgRemoval(incomingMessage.msgId);
  }

  /* Creating a new chat based on an invitation message (entry point) */
  async function handleChatInvitation(msg: ChatIncomingMessage): Promise<void> {
    const { sender, jsonBody, deliveryTS, establishedSenderKeyChain } = msg;
    const neverContactedInitiator = !establishedSenderKeyChain;
    const { chatMessageId, inviteData } = jsonBody as ChatInvitationMsgV1;

    if (inviteData.type === 'invite-acceptance') {
      return await handleInvitationAcceptance(sender, inviteData, msg);
    }

    if (inviteData.type === 'updated-members-invitation-data') {
      return await handleUpdateMembersInvitationData(sender, inviteData.chatId, inviteData.members, msg);
    }

    const chatId = inviteChatId(sender, inviteData);

    if (!chatId) {
      return handleMalformedInvitation(msg.msgId);
    }

    if (data.findChat(chatId)) {
      return removeMessageFromInbox(
        msg.msgId,
        `Incoming chat invitation message ${msg.msgId} is for existing chat. Removing it from inbox.`,
      );
    }

    switch (inviteData.type) {
      case 'oto-chat-invite': {
        await handleOTOChatInvitation(
          sender,
          chatMessageId,
          inviteData,
          msg.msgId,
          deliveryTS,
          neverContactedInitiator,
        );
        return data.scheduleInboxMsgRemoval(msg.msgId);
      }

      case 'group-chat-invite': {
        const { members, admins } = inviteData;
        if (
          includesAddress(Object.keys(members!), ownAddr) &&
          includesAddress(Object.keys(members!), sender) &&
          includesAddress(admins!, sender)
        ) {
          await handleGroupChatInvitation(
            sender,
            chatMessageId,
            inviteData,
            msg.msgId,
            deliveryTS,
            neverContactedInitiator,
          );
          return data.scheduleInboxMsgRemoval(msg.msgId);
        }

        return handleMalformedInvitation(msg.msgId);
      }

      default:
        return handleMalformedInvitation(msg.msgId);
    }
  }

  async function acceptChatInvitation(chatId: ChatIdObj, chatMessageId: string, ownName: string): Promise<void> {
    const chat = data.findChat(chatId);
    const id: ChatMessageId = { chatId, chatMessageId };
    const msg = await data.getMessage(id);

    if (!chat) {
      throw makeDbRecordException({ chatNotFound: true });
    } else if (!msg) {
      throw makeDbRecordException({ invitationNotFound: true });
    } else if (chat.status !== 'invited') {
      return;
    }

    if (msg.status !== 'read') {
      const updatedMsg = await data.updateMessageRecord(id, {
        status: 'read',
      });

      emit.message.updated(updatedMsg);
    }

    // Whom the invitation came from: the address the acceptance goes back to,
    // and `initiator` of AcceptedInvitationReference, by which the receiving
    // side tells whether it is itself the chat's initiator (that decides the
    // status a group chat moves to, see handleGroupChatInvitationAcceptance()).
    // `groupSender` is filled only in group chats, so for a one-to-one chat the
    // initiator is the chat's peer - and it is indeed the side that sent the
    // invitation, since only an incoming invitation puts a chat into the
    // `invited` status checked above.
    const initiator = chatId.isGroupChat ? msg.groupSender : (chat as OTOChatDbEntry).peerAddr;
    if (!initiator) {
      throw makeDbRecordException({
        invalidChatInsertData: true,
        message: `Invitation ${chatMessageId} has no sender recorded, so there is nobody to accept it to`,
      });
    }

    if (chatId.isGroupChat) {
      const updatedChat = await data.updateGroupChatRecord(chatId.chatId, { status: 'accepted' });
      emit.chat.updated(updatedChat);

      if (updatedChat) {
        await sendInvitationAcceptedSync(chatId, updatedChat.status);
      }

      const inviteData: AcceptedInvitationReference = {
        type: 'invite-acceptance',
        chatMessageId,
        initiator,
        groupChat: {
          type: 'group-chat-invite',
          groupChatId: (chat as GroupChatDbEntry).chatId,
          addr: ownAddr,
          name: ownName,
        },
      };
      await sendChatInvitation(chatId, [initiator], { chatMessageId, inviteData });

      return;
    }

    const updatedChat = await data.updateOTOChatRecord(chatId.chatId, { status: 'on' });
    emit.chat.updated(updatedChat);

    if (updatedChat) {
      await sendInvitationAcceptedSync(chatId, updatedChat.status);
    }

    const inviteData: AcceptedInvitationReference = {
      type: 'invite-acceptance',
      chatMessageId,
      initiator,
      oneToOneChat: {
        type: 'oto-chat-invite',
        name: ownName,
      },
    };
    await sendChatInvitation(chatId, [initiator], { chatMessageId, inviteData });
  }

  return {
    createOneToOneChat,
    createGroupChat,
    handleChatInvitation,
    handleInvitationAcceptance,
    handleUpdateMembersInvitationData,
    acceptChatInvitation,
  };
}
