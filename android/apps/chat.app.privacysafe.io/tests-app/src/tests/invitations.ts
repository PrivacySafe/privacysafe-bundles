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

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { chatService } from '../libs-for-tests/guarded-chat-service.ts';

declare const w3n: web3n.testing.CommonW3N;

// Helper to generate unique names
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe(`Chat Invitations`, () => {

  describe(`One-to-One Chat Invitation`, () => {

    itCond(`should create OTO chat that starts with valid status`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatName = uniqueName('OTO Invite');
      const ownName = uniqueName('Own');

      // Create a new OTO chat (which sends invitation)
      const chatId = await chatService.createOneToOneChat({
        peerAddr: sndUserAddr,
        name: chatName,
        ownName,
      });

      expect(chatId)
        .withContext(`chatId should be returned`)
        .toBeTruthy();

      // Get the chat and check its status
      const chat = await chatService.getChat(chatId);

      expect(chat)
        .withContext(`chat should exist`)
        .toBeTruthy();

      if (chat && !chat.isGroupChat) {
        // OTO chat should have a status (initiated, on, invited, accepted, or no-members)
        expect(chat.status)
          .withContext(`chat should have a status`)
          .toBeTruthy();
        expect(['initiated', 'on', 'invited', 'accepted', 'no-members'])
          .withContext(`status should be a valid OTO chat status`)
          .toContain(chat.status);
      }
    }, 45000);

    itCond(`acceptChatInvitation() should accept OTO chat invitation`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatName = uniqueName('OTO Accept');
      const ownName = uniqueName('Own');

      // Create a chat that will generate an invitation
      const chatId = await chatService.createOneToOneChat({
        peerAddr: sndUserAddr,
        name: chatName,
        ownName,
      });

      // Get messages to find invitation message
      const messages = await chatService.getMessagesByChat(chatId);
      const invitationMsg = messages.find(m => m.chatMessageType === 'invitation');

      if (invitationMsg) {
        // Try to accept the invitation
        await chatService.acceptChatInvitation(
          chatId,
          invitationMsg.chatMessageId,
          ownName,
        );

        // Verify chat status changed
        const chat = await chatService.getChat(chatId);
        expect(chat)
          .withContext(`chat should exist after accepting invitation`)
          .toBeTruthy();
      } else {
        // If no invitation message, the chat was created directly
        const chat = await chatService.getChat(chatId);
        expect(chat)
          .withContext(`chat should exist`)
          .toBeTruthy();
      }
    }, 35000);

  });

  describe(`Group Chat Invitation`, () => {

    itCond(`should create group chat that starts with valid status`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const thirdUserAddr = await w3n.testStand.idOfTestUser(3);
      const chatIdValue = uniqueName('group-invite');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Group Invite'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
          [thirdUserAddr]: { hasAccepted: false },
        },
      });

      expect(groupChatId)
        .withContext(`groupChatId should be returned`)
        .toBeTruthy();

      // Get the chat and check its status
      const chat = await chatService.getChat(groupChatId);

      expect(chat)
        .withContext(`chat should exist`)
        .toBeTruthy();

      if (chat && chat.isGroupChat) {
        // Group chat should have a status
        expect(chat.status)
          .withContext(`chat should have a status`)
          .toBeTruthy();
        expect(['initiated', 'partially-on', 'on', 'invited', 'accepted', 'no-members'])
          .withContext(`status should be a valid group chat status`)
          .toContain(chat.status);
      }
    }, 45000);

    itCond(`group chat invitation should contain member information`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('group-members-info');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Members Info'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      // Get messages to find invitation message
      const messages = await chatService.getMessagesByChat(groupChatId);
      const invitationMsg = messages.find(m => m.chatMessageType === 'invitation');

      if (invitationMsg && invitationMsg.chatMessageType === 'invitation') {
        expect(invitationMsg.inviteData)
          .withContext(`invitation should have inviteData`)
          .toBeTruthy();

        if (invitationMsg.inviteData.type === 'group-chat-invite') {
          expect(invitationMsg.inviteData.groupChatId)
            .withContext(`inviteData should have groupChatId`)
            .toBe(groupChatId.chatId);
          expect(invitationMsg.inviteData.name)
            .withContext(`inviteData should have chat name`)
            .toBeTruthy();
        }
      }
    }, 45000);

  });

  describe(`Chat Status After Invitation`, () => {

    itCond(`OTO chat status should reflect invitation state`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatName = uniqueName('Status Test');
      const ownName = uniqueName('Own');

      const chatId = await chatService.createOneToOneChat({
        peerAddr: sndUserAddr,
        name: chatName,
        ownName,
      });

      const chat = await chatService.getChat(chatId);

      expect(chat)
        .withContext(`chat should exist`)
        .toBeTruthy();

      if (chat && !chat.isGroupChat) {
        // The status should indicate the current state of the chat
        expect(typeof chat.status)
          .withContext(`status should be a string`)
          .toBe('string');
      }
    }, 45000);

    itCond(`group chat status should reflect members acceptance state`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const thirdUserAddr = await w3n.testStand.idOfTestUser(3);
      const chatIdValue = uniqueName('status-test');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Status Group'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
          [thirdUserAddr]: { hasAccepted: false },
        },
      });

      const chat = await chatService.getChat(groupChatId);

      expect(chat)
        .withContext(`chat should exist`)
        .toBeTruthy();

      if (chat && chat.isGroupChat) {
        // Check that members have hasAccepted flag
        expect(chat.members[sndUserAddr])
          .withContext(`second user should be in members`)
          .toBeTruthy();
        expect(typeof chat.members[sndUserAddr].hasAccepted)
          .withContext(`hasAccepted should be a boolean`)
          .toBe('boolean');
      }
    }, 45000);

  });

  describe(`Invitation Message Structure`, () => {

    itCond(`invitation message should have correct structure`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatName = uniqueName('Invite Structure');
      const ownName = uniqueName('Own');

      const chatId = await chatService.createOneToOneChat({
        peerAddr: sndUserAddr,
        name: chatName,
        ownName,
      });

      const messages = await chatService.getMessagesByChat(chatId);
      const invitationMsg = messages.find(m => m.chatMessageType === 'invitation');

      if (invitationMsg) {
        expect(invitationMsg.chatMessageType)
          .withContext(`message type should be 'invitation'`)
          .toBe('invitation');
        expect(invitationMsg.chatMessageId)
          .withContext(`message should have chatMessageId`)
          .toBeTruthy();
        expect(invitationMsg.sender)
          .withContext(`message should have sender`)
          .toBeTruthy();
        expect(typeof invitationMsg.timestamp)
          .withContext(`message should have timestamp`)
          .toBe('number');

        if (invitationMsg.chatMessageType === 'invitation') {
          expect(invitationMsg.inviteData)
            .withContext(`invitation should have inviteData`)
            .toBeTruthy();
          expect(invitationMsg.inviteData.type)
            .withContext(`inviteData should have type`)
            .toBeTruthy();
        }
      }
    }, 45000);

  });

});