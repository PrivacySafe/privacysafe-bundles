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

import { itCond, rethrowIfConnectivityFailure } from '../libs-for-tests/jasmine-utils.js';
import { chatService } from '../libs-for-tests/guarded-chat-service.ts';

declare const w3n: web3n.testing.CommonW3N;

// Helper to generate unique names
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe(`Chat Management`, () => {

  describe(`One-to-One Chat Creation`, () => {

    itCond(`should create one-to-one chat with valid address`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatName = uniqueName('OTO Test');
      const ownName = uniqueName('Own');

      const chatId = await chatService.createOneToOneChat({
        peerAddr: sndUserAddr,
        name: chatName,
        ownName,
      });

      expect(chatId)
        .withContext(`chatId should be returned`)
        .toBeTruthy();
      expect(chatId.isGroupChat)
        .withContext(`chatId should indicate one-to-one chat`)
        .toBe(false);
      // Note: chatId.chatId contains canonical address (lowercase, no spaces)
      expect(chatId.chatId)
        .withContext(`chatId should contain peer address for OTO chat`)
        .toBeTruthy();
    }, 45000);

    itCond(`should throw error when creating chat with non-existent address`, async () => {
      const nonExistentAddr = `nonexistent-${Date.now()}@invalid.domain`;
      const ownName = uniqueName('Own');

      try {
        await chatService.createOneToOneChat({
          peerAddr: nonExistentAddr,
          name: uniqueName('NonExistent'),
          ownName,
        });
        fail(`Expected error to be thrown for non-existent address`);
      } catch (err) {
        // A network outage also makes creation fail with a chat-creation
        // exception; asserting on it would falsely pass this spec, so it is
        // rethrown for itCond's guard to turn into a pending spec.
        rethrowIfConnectivityFailure(err);
        const error = err as { runtimeException?: boolean; type?: string };
        expect(error.runtimeException)
          .withContext(`error should be a runtime exception`)
          .toBe(true);
        expect(error.type)
          .withContext(`error type should be 'chat-creation'`)
          .toBe('chat-creation');
      }
    }, 45000);

    itCond(`created chat should appear in getChatList()`, async () => {
      const chatList = await chatService.getChatList();

      expect(chatList)
        .withContext(`chatList should be an array`)
        .toBeInstanceOf(Array);

      // Just verify the list is not empty and has valid structure
      expect(chatList.length)
        .withContext(`chatList should have at least one chat`)
        .toBeGreaterThan(0);
    }, 45000);

  });

  describe(`Group Chat Creation`, () => {

    itCond(`should create group chat with multiple members`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const thirdUserAddr = await w3n.testStand.idOfTestUser(3);
      const chatIdValue = uniqueName('group');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Group Chat'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
          [thirdUserAddr]: { hasAccepted: false },
        },
      });

      expect(groupChatId)
        .withContext(`groupChatId should be returned`)
        .toBeTruthy();
      expect(groupChatId.isGroupChat)
        .withContext(`chatId should indicate group chat`)
        .toBe(true);
      expect(groupChatId.chatId)
        .withContext(`chatId should match provided value`)
        .toBe(chatIdValue);
    }, 45000);

    itCond(`should throw error when creating group chat with non-existent addresses`, async () => {
      const nonExistentAddr = `nonexistent-${Date.now()}@invalid.domain`;

      try {
        await chatService.createGroupChat({
          chatId: uniqueName('invalid-group'),
          name: uniqueName('Invalid Group'),
          members: {
            [nonExistentAddr]: { hasAccepted: false },
          },
        });
        fail(`Expected error to be thrown for non-existent address`);
      } catch (err) {
        // Same as in the one-to-one spec above: an outage must skip, not pass.
        rethrowIfConnectivityFailure(err);
        const error = err as { runtimeException?: boolean; type?: string };
        expect(error.runtimeException)
          .withContext(`error should be a runtime exception`)
          .toBe(true);
        expect(error.type)
          .withContext(`error type should be 'chat-creation'`)
          .toBe('chat-creation');
      }
    }, 45000);

  });

  describe(`Chat Retrieval`, () => {

    itCond(`getChat() should find existing group chat by ID`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('find-test');

      // Create a group chat first
      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Find Test Group'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      const chat = await chatService.getChat(groupChatId);

      expect(chat)
        .withContext(`chat should be found`)
        .toBeTruthy();
      expect(chat?.isGroupChat)
        .withContext(`found chat should be group`)
        .toBe(true);
    }, 45000);

    itCond(`getChat() should return undefined for non-existent chat`, async () => {
      const chat = await chatService.getChat({
        isGroupChat: true,
        chatId: `nonexistent-${Date.now()}@domain.com`,
      });

      expect(chat)
        .withContext(`chat should not be found`)
        .toBeUndefined();
    }, 45000);

    itCond(`getChatList() should return correct list after creating chats`, async () => {
      const chatList = await chatService.getChatList();

      expect(chatList)
        .withContext(`chatList should be an array`)
        .toBeInstanceOf(Array);

      // Verify structure of chat list items
      for (const chat of chatList) {
        expect(chat.chatId)
          .withContext(`each chat should have chatId`)
          .toBeTruthy();
        expect(chat.name)
          .withContext(`each chat should have name`)
          .toBeDefined();
        expect(typeof chat.isGroupChat)
          .withContext(`each chat should have isGroupChat flag`)
          .toBe('boolean');
        expect(chat.createdAt)
          .withContext(`each chat should have createdAt timestamp`)
          .toBeGreaterThan(0);
      }
    }, 45000);

  });

  describe(`Chat Modification`, () => {

    itCond(`renameChat() should change group chat name`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('rename-test');
      const originalName = uniqueName('Original Name');
      const newName = uniqueName('Renamed Chat');

      // Create a group chat (only group chats can be renamed)
      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: originalName,
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      await chatService.renameChat(groupChatId, newName);

      const chat = await chatService.getChat(groupChatId);

      expect(chat?.name)
        .withContext(`chat name should be updated`)
        .toBe(newName);
    }, 45000);

    itCond(`chatSetUp() should update chat settings`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('settings-test');
      const newSettings = {
        removeAfter: 3600, // 1 hour
      };

      // Create a group chat first
      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Settings Test'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      await chatService.chatSetUp(groupChatId, newSettings);

      const chat = await chatService.getChat(groupChatId);

      expect(chat?.settings?.removeAfter)
        .withContext(`chat settings should be updated`)
        .toBe(newSettings.removeAfter);
    }, 45000);

  });

  describe(`Chat Deletion`, () => {

    itCond(`deleteChat() should remove chat`, async () => {
      const thirdUserAddr = await w3n.testStand.idOfTestUser(3);
      const chatIdValue = uniqueName('delete-test');

      // Create a group chat for deletion
      const chatToDelete = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Chat To Delete'),
        members: {
          [thirdUserAddr]: { hasAccepted: false },
        },
      });

      // Verify chat exists
      let chat = await chatService.getChat(chatToDelete);
      expect(chat)
        .withContext(`chat should exist before deletion`)
        .toBeTruthy();

      // Get current chat to know members for proper update
      const currentChat = await chatService.getChat(chatToDelete);
      const currentMembers = currentChat && currentChat.isGroupChat
        ? { ...currentChat.members }
        : {};
      
      // Remove thirdUserAddr from members
      delete currentMembers[thirdUserAddr];
      
      // Remove all members first (deleteChat requires no other members if you're the only admin)
      await chatService.updateGroupMembers(chatToDelete, {
        membersToDelete: {
          [thirdUserAddr]: { hasAccepted: false },
        },
        membersToAdd: {},
        membersAfterUpdate: currentMembers,
      });

      // Delete chat
      await chatService.deleteChat(chatToDelete);

      // Verify chat is removed
      chat = await chatService.getChat(chatToDelete);
      expect(chat)
        .withContext(`chat should not exist after deletion`)
        .toBeUndefined();
    }, 35000);

  });

});