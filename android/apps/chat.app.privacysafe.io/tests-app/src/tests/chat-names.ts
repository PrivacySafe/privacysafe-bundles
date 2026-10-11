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

/**
 * Chat names are not unique (P2-6).
 *
 * Two group chats may carry the same name - even with the same members - and two
 * contacts may share a display name, while a one-to-one chat is identified by
 * the peer's address rather than by the name it is shown under. The schema used
 * to enforce uniqueness of `name` in both tables, which made an invitation with
 * an already taken name fail on the recipient's side: the chat was not created
 * at all.
 *
 * Chats here are created from invitation phantoms handed to `handleIncomingMsg`
 * and not through `createOneToOneChat()`/`createGroupChat()`: those pre-flight
 * peer addresses over the network, whereas the subject here is what the database
 * accepts. So, as in sync-conflicts.ts, these specs are expected to be green
 * even with no server reachable.
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { chatService } from '@main/common/services/external-services.ts';
import { toCanonicalAddress } from '@shared/address-utils';
import type { ChatIdObj, ChatIncomingMessage } from '~/asmail-msgs.types';

declare const w3n: web3n.testing.CommonW3N;

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Wraps a phantom body into an inbox message, as the dispatcher would hand it
 * over - see the matching helper in sync-conflicts.ts.
 */
function phantomMsg(
  ownAddr: string,
  chatId: ChatIdObj,
  sourceDeviceId: string,
  timestamp: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
): ChatIncomingMessage {
  return {
    msgId: uniqueName('synthetic-phantom'),
    msgType: 'chat',
    deliveryTS: Date.now(),
    sender: ownAddr,
    establishedSenderKeyChain: true,
    jsonBody: {
      v: 1,
      chatMessageType: 'synchronization',
      sourceDeviceId,
      chatId,
      timestamp,
      value,
    },
  } as ChatIncomingMessage;
}

function groupInvitationValue(chatId: string, name: string, ownAddr: string) {
  return {
    v: 1,
    chatMessageType: 'invitation',
    chatMessageId: uniqueName('inv'),
    inviteData: {
      type: 'group-chat-invite',
      groupChatId: chatId,
      name,
      members: { [ownAddr]: { hasAccepted: true } },
      admins: [ownAddr],
      status: 'on',
    },
  };
}

function otoInvitationValue(name: string) {
  return {
    v: 1,
    chatMessageType: 'invitation',
    chatMessageId: uniqueName('inv'),
    inviteData: {
      type: 'oto-chat-invite',
      name,
      status: 'on',
    },
  };
}

function chatNameUpdateValue(name: string) {
  return {
    v: 1,
    chatMessageType: 'system',
    chatMessageId: uniqueName('rename'),
    chatSystemData: {
      event: 'update:chatName',
      value: { name },
    },
  };
}

describe(`Chat names are not unique`, () => {

  itCond(`two invitations with one and the same chat name create two chats`, async () => {
    const ownAddr = await w3n.testStand.idOfTestUser(1);
    const otherDeviceId = `other-device-${Date.now()}`;
    const sharedName = uniqueName('Same Name Group');
    const firstChatId: ChatIdObj = { isGroupChat: true, chatId: uniqueName('dup-name-1') };
    const secondChatId: ChatIdObj = { isGroupChat: true, chatId: uniqueName('dup-name-2') };

    await chatService.handleIncomingMsg(
      phantomMsg(
        ownAddr,
        firstChatId,
        otherDeviceId,
        1000,
        groupInvitationValue(firstChatId.chatId, sharedName, ownAddr),
      ),
    );
    await chatService.handleIncomingMsg(
      phantomMsg(
        ownAddr,
        secondChatId,
        otherDeviceId,
        1100,
        groupInvitationValue(secondChatId.chatId, sharedName, ownAddr),
      ),
    );

    const first = await chatService.getChat(firstChatId);
    const second = await chatService.getChat(secondChatId);

    expect(first)
      .withContext(`the first invitation creates its chat`)
      .toBeDefined();
    expect(second)
      .withContext(`and the second one is not refused because the name is taken`)
      .toBeDefined();
    expect(first?.name)
      .withContext(`both keep the name they were invited under`)
      .toBe(sharedName);
    expect(second?.name).toBe(sharedName);
  }, 20000);

  itCond(`a group chat and a one-to-one chat may share a name`, async () => {
    const ownAddr = await w3n.testStand.idOfTestUser(1);
    // The third test user, not the second: a one-to-one chat is keyed by the
    // peer, so there is exactly one of them per peer for the whole run, and
    // `Chat Management` has already made the one with the second user. An
    // invitation for a chat that exists does not rename it, so this spec would
    // be reading that chat's name instead of the one it set. The third user is
    // only ever a group member elsewhere.
    const peerAddr = await w3n.testStand.idOfTestUser(3);
    const otherDeviceId = `other-device-${Date.now()}`;
    const sharedName = uniqueName('Same Name Mixed');
    const groupChatId: ChatIdObj = { isGroupChat: true, chatId: uniqueName('mixed-name') };
    // Keyed by the peer's *canonical* address, which is what a real phantom
    // carries (inviteChatId() canonicalizes the sender) and what the record's
    // primary key is. Test stand addresses have a name part with spaces in
    // them, so the raw string is not that key.
    const otoChatId: ChatIdObj = { isGroupChat: false, chatId: toCanonicalAddress(peerAddr) };

    await chatService.handleIncomingMsg(
      phantomMsg(
        ownAddr,
        groupChatId,
        otherDeviceId,
        1000,
        groupInvitationValue(groupChatId.chatId, sharedName, ownAddr),
      ),
    );
    await chatService.handleIncomingMsg(
      phantomMsg(ownAddr, otoChatId, otherDeviceId, 1100, otoInvitationValue(sharedName)),
    );

    const group = await chatService.getChat(groupChatId);
    const oto = await chatService.getChat(otoChatId);

    expect(group?.name)
      .withContext(`the group chat is there under the shared name`)
      .toBe(sharedName);
    expect(oto?.name)
      .withContext(`and so is the one-to-one chat with the peer`)
      .toBe(sharedName);
  }, 20000);

  itCond(`renaming a group chat to a name another chat already carries goes through`, async () => {
    const ownAddr = await w3n.testStand.idOfTestUser(1);
    const otherDeviceId = `other-device-${Date.now()}`;
    const takenName = uniqueName('Taken Name');
    const keeperChatId: ChatIdObj = { isGroupChat: true, chatId: uniqueName('name-keeper') };
    const renamedChatId: ChatIdObj = { isGroupChat: true, chatId: uniqueName('to-be-renamed') };

    await chatService.handleIncomingMsg(
      phantomMsg(
        ownAddr,
        keeperChatId,
        otherDeviceId,
        1000,
        groupInvitationValue(keeperChatId.chatId, takenName, ownAddr),
      ),
    );
    await chatService.handleIncomingMsg(
      phantomMsg(
        ownAddr,
        renamedChatId,
        otherDeviceId,
        1100,
        groupInvitationValue(renamedChatId.chatId, uniqueName('Own Name'), ownAddr),
      ),
    );

    await chatService.handleIncomingMsg(
      phantomMsg(ownAddr, renamedChatId, otherDeviceId, 1200, chatNameUpdateValue(takenName)),
    );

    expect((await chatService.getChat(renamedChatId))?.name)
      .withContext(`the rename is applied`)
      .toBe(takenName);
    expect((await chatService.getChat(keeperChatId))?.name)
      .withContext(`and the chat that already had the name keeps it`)
      .toBe(takenName);
  }, 20000);

});
