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

describe(`Group Members Management`, () => {

  describe(`Adding Members`, () => {

    itCond(`updateGroupMembers() should add new member to group`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const thirdUserAddr = await w3n.testStand.idOfTestUser(3);
      const chatIdValue = uniqueName('add-member');

      // Create group chat
      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Add Member Group'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      // Get current members
      let chat = await chatService.getChat(groupChatId);
      expect(chat)
        .withContext(`chat should exist`)
        .toBeTruthy();

      const initialMembers = chat && chat.isGroupChat
        ? { ...chat.members }
        : {};
      const initialMemberCount = Object.keys(initialMembers).length;

      // Prepare members after update
      const membersAfterUpdate = {
        ...initialMembers,
        [thirdUserAddr]: { hasAccepted: false },
      };

      // Add third user as new member
      await chatService.updateGroupMembers(groupChatId, {
        membersToDelete: {},
        membersToAdd: {
          [thirdUserAddr]: { hasAccepted: false },
        },
        membersAfterUpdate,
      });

      // Verify member was added
      chat = await chatService.getChat(groupChatId);
      expect(chat)
        .withContext(`chat should still exist`)
        .toBeTruthy();

      if (chat && chat.isGroupChat) {
        expect(Object.keys(chat.members).length)
          .withContext(`member count should increase`)
          .toBe(initialMemberCount + 1);
        expect(chat.members[thirdUserAddr])
          .withContext(`third user should be in members`)
          .toBeTruthy();
      }
    }, 40000);

  });

  describe(`Removing Members`, () => {

    itCond(`updateGroupMembers() should remove member from group`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const thirdUserAddr = await w3n.testStand.idOfTestUser(3);
      const chatIdValue = uniqueName('remove-member');

      // Create group chat with two members
      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Remove Member Group'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
          [thirdUserAddr]: { hasAccepted: false },
        },
      });

      // Get current members
      let chat = await chatService.getChat(groupChatId);
      expect(chat)
        .withContext(`chat should exist`)
        .toBeTruthy();

      const initialMembers = chat && chat.isGroupChat
        ? { ...chat.members }
        : {};
      const initialMemberCount = Object.keys(initialMembers).length;

      // Prepare members after update (without third user)
      const membersAfterUpdate = { ...initialMembers };
      delete membersAfterUpdate[thirdUserAddr];

      // Remove third user
      await chatService.updateGroupMembers(groupChatId, {
        membersToDelete: {
          [thirdUserAddr]: { hasAccepted: false },
        },
        membersToAdd: {},
        membersAfterUpdate,
      });

      // Verify member was removed
      chat = await chatService.getChat(groupChatId);
      expect(chat)
        .withContext(`chat should still exist`)
        .toBeTruthy();

      if (chat && chat.isGroupChat) {
        expect(Object.keys(chat.members).length)
          .withContext(`member count should decrease`)
          .toBe(initialMemberCount - 1);
        expect(chat.members[thirdUserAddr])
          .withContext(`third user should not be in members`)
          .toBeUndefined();
      }
    }, 40000);

  });

  describe(`Admin Management`, () => {

    itCond(`updateGroupAdmins() should add admin to group`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('add-admin');

      // Create group chat
      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Add Admin Group'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      // Get current admins
      let chat = await chatService.getChat(groupChatId);
      expect(chat)
        .withContext(`chat should exist`)
        .toBeTruthy();

      const initialAdmins = chat && chat.isGroupChat
        ? [...chat.admins]
        : [];
      const initialAdminCount = initialAdmins.length;

      // Add second user as admin
      await chatService.updateGroupAdmins(groupChatId, {
        adminsToDelete: [],
        adminsToAdd: [sndUserAddr],
        adminsAfterUpdate: [...initialAdmins, sndUserAddr],
      });

      // Verify admin was added
      chat = await chatService.getChat(groupChatId);
      expect(chat)
        .withContext(`chat should still exist`)
        .toBeTruthy();

      if (chat && chat.isGroupChat) {
        expect(chat.admins.length)
          .withContext(`admin count should increase`)
          .toBe(initialAdminCount + 1);
        expect(chat.admins)
          .withContext(`second user should be in admins`)
          .toContain(sndUserAddr);
      }
    }, 40000);

    itCond(`updateGroupAdmins() should remove admin from group`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('remove-admin');

      // Create group chat with admin
      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Remove Admin Group'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      // First add second user as admin
      let chat = await chatService.getChat(groupChatId);
      const initialAdmins = chat && chat.isGroupChat ? [...chat.admins] : [];

      await chatService.updateGroupAdmins(groupChatId, {
        adminsToDelete: [],
        adminsToAdd: [sndUserAddr],
        adminsAfterUpdate: [...initialAdmins, sndUserAddr],
      });

      // Get updated admins
      chat = await chatService.getChat(groupChatId);
      const currentAdmins = chat && chat.isGroupChat ? [...chat.admins] : [];
      const currentAdminCount = currentAdmins.length;

      // Remove second user from admins
      const adminsAfterUpdate = currentAdmins.filter(a => a !== sndUserAddr);

      await chatService.updateGroupAdmins(groupChatId, {
        adminsToDelete: [sndUserAddr],
        adminsToAdd: [],
        adminsAfterUpdate,
      });

      // Verify admin was removed
      chat = await chatService.getChat(groupChatId);
      expect(chat)
        .withContext(`chat should still exist`)
        .toBeTruthy();

      if (chat && chat.isGroupChat) {
        expect(chat.admins.length)
          .withContext(`admin count should decrease`)
          .toBe(currentAdminCount - 1);
        expect(chat.admins)
          .withContext(`second user should not be in admins`)
          .not.toContain(sndUserAddr);
      }
    }, 45000);

  });

});