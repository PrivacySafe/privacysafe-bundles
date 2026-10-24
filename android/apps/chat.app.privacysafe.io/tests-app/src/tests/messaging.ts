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
import { generateChatMessageId } from '../../../shared-libs/chat-ids.ts';
import type { ChatIdObj } from '~/asmail-msgs.types';
import type { ChatMessageView, MessageStatus } from '~/chat.types';

declare const w3n: web3n.testing.CommonW3N;

// Helper to generate unique names
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Statuses a delivery ends in, whichever way it went. */
const TERMINAL_STATUSES: MessageStatus[] = ['sent', 'error'];

/** How long a spec waits for the test-stand's real ASMail delivery to finish. */
const DELIVERY_WAIT_MILLIS = 20000;

function reachedTerminalStatus(msg: ChatMessageView | undefined): boolean {
  return !!msg?.status && TERMINAL_STATUSES.includes(msg.status);
}

// Polls getMessage() until it reaches one of the given terminal statuses, or
// the timeout elapses (real ASMail delivery in the test-stand is async).
async function waitForMessageStatus(
  chatId: ChatIdObj,
  chatMessageId: string,
  terminalStatuses: MessageStatus[],
  timeoutMs = DELIVERY_WAIT_MILLIS,
): Promise<ChatMessageView | undefined> {
  const start = Date.now();
  let msg: ChatMessageView | undefined;
  do {
    msg = await chatService.getMessage({ chatId, chatMessageId });
    if (msg?.status && terminalStatuses.includes(msg.status)) {
      return msg;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  } while ((Date.now() - start) < timeoutMs);
  return msg;
}

describe(`Messaging`, () => {

  describe(`Sending Messages`, () => {

    itCond(`should send text message to group chat`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('msg-test');

      // Create group chat for messaging
      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Msg Test Group'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      const { chatMessageId } = generateChatMessageId();
      const text = `Test message ${Date.now()}`;

      await chatService.sendRegularMessage({
        chatId: groupChatId,
        chatMessageId,
        text,
        files: undefined,
        relatedMessage: undefined,
      });

      // Verify message was saved by getting it directly by id
      const msg = await chatService.getMessage({
        chatId: groupChatId,
        chatMessageId,
      });

      expect(msg)
        .withContext(`message should be saved`)
        .toBeTruthy();
      expect(msg?.chatMessageType)
        .withContext(`message type should be 'regular'`)
        .toBe('regular');

      if (msg && msg.chatMessageType === 'regular') {
        expect(msg.body)
          .withContext(`message body should match sent text`)
          .toBe(text);
      }
    }, 35000);

    itCond(`should send message with relatedMessage (reply)`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('reply-test');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Reply Test Group'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      // First, send a message to reply to
      const { chatMessageId: originalMsgId } = generateChatMessageId();
      const originalText = `Original message ${Date.now()}`;

      await chatService.sendRegularMessage({
        chatId: groupChatId,
        chatMessageId: originalMsgId,
        text: originalText,
        files: undefined,
        relatedMessage: undefined,
      });

      // Now send a reply
      const { chatMessageId: replyMsgId } = generateChatMessageId();
      const replyText = `Reply message ${Date.now()}`;

      await chatService.sendRegularMessage({
        chatId: groupChatId,
        chatMessageId: replyMsgId,
        text: replyText,
        files: undefined,
        relatedMessage: {
          replyTo: {
            chatMessageId: originalMsgId,
            displayedText: originalText,
          },
        },
      });

      // Verify reply was saved with relatedMessage
      const replyMsg = await chatService.getMessage({
        chatId: groupChatId,
        chatMessageId: replyMsgId,
      });

      expect(replyMsg)
        .withContext(`reply message should be saved`)
        .toBeTruthy();

      if (replyMsg && replyMsg.chatMessageType === 'regular') {
        expect(replyMsg.relatedMessage)
          .withContext(`reply should have relatedMessage`)
          .toBeTruthy();
        expect(replyMsg.relatedMessage?.replyTo?.chatMessageId)
          .withContext(`replyTo should reference original message`)
          .toBe(originalMsgId);
      }
    }, 40000);

    itCond(`same chatMessageId reused across two chats resolves delivery status independently`, async () => {
      // Regression test for P0-3: the messages table PRIMARY KEY is
      // (chatMessageId, groupChatId, otoPeerCAddr), so the same chatMessageId
      // legally exists in two different chats at once. The delivery-progress
      // handler used to look a message up by chatMessageId alone
      // (getMessageByMsgId), which could apply one chat's delivery outcome to
      // the other chat's record.
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);

      const chatIdA = await chatService.createGroupChat({
        chatId: uniqueName('dup-id-a'),
        name: uniqueName('Dup Id Group A'),
        members: { [sndUserAddr]: { hasAccepted: false } },
      });
      const chatIdB = await chatService.createGroupChat({
        chatId: uniqueName('dup-id-b'),
        name: uniqueName('Dup Id Group B'),
        members: { [sndUserAddr]: { hasAccepted: false } },
      });

      const { chatMessageId } = generateChatMessageId();

      await chatService.sendRegularMessage({
        chatId: chatIdA,
        chatMessageId,
        text: `Message A ${Date.now()}`,
        files: undefined,
        relatedMessage: undefined,
      });
      await chatService.sendRegularMessage({
        chatId: chatIdB,
        chatMessageId,
        text: `Message B ${Date.now()}`,
        files: undefined,
        relatedMessage: undefined,
      });

      const [msgA, msgB] = await Promise.all([
        waitForMessageStatus(chatIdA, chatMessageId, TERMINAL_STATUSES),
        waitForMessageStatus(chatIdB, chatMessageId, TERMINAL_STATUSES),
      ]);

      // Neither message got a terminal status - not even 'error'. Then the
      // delivery never finished at all, and this spec has nothing to judge:
      // whether the two chats resolve their statuses *independently* only shows
      // once at least one of them resolves. In the test-stand that means ASMail
      // delivery could not complete, in practice because its server is
      // unreachable (`connect ETIMEDOUT` against 3nweb.net fills the run log).
      //
      // Reported as pending, with the reason, rather than as a failure: a failed
      // spec here reads like a regression in delivery-status handling, and that
      // sent a previous investigation down the wrong path entirely.
      if (!reachedTerminalStatus(msgA) && !reachedTerminalStatus(msgB)) {
        const reason = `ASMail delivery never finished: after ${DELIVERY_WAIT_MILLIS}ms both `
          + `messages are still '${msgA?.status ?? 'absent'}' / '${msgB?.status ?? 'absent'}', `
          + `so neither 'sent' nor 'error' was ever applied. This is the delivery itself not `
          + `completing, not the status being applied to the wrong chat - look for `
          + `'Cannot connect' / 'ETIMEDOUT' in the run log to confirm the server was unreachable.`;
        // Three channels, because they reach different places: console is only
        // visible in the window's devtools, testStand.log goes to the run's log
        // files, and pending() is what puts the spec into the run's report as
        // pending (see the 'spec-pending' branch of the reporter in
        // public/jasmine/boot1.js) instead of leaving it silently green.
        console.log(`\n>>> SKIPPED (delivery unavailable): ${reason}`);
        w3n.testStand.log('info', `Spec skipped, ASMail delivery unavailable: ${reason}`);
        pending(reason);
        return;
      }

      expect(msgA?.status)
        .withContext(`message in chat A should reach a terminal status independently of chat B`)
        .toBe('sent');
      expect(msgB?.status)
        .withContext(`message in chat B should reach a terminal status independently of chat A`)
        .toBe('sent');
    }, 45000);

  });

  describe(`Retrieving Messages`, () => {

    itCond(`getMessage() should find existing message`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('get-msg-test');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Get Msg Test'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      const { chatMessageId } = generateChatMessageId();
      const text = `Message to find ${Date.now()}`;

      await chatService.sendRegularMessage({
        chatId: groupChatId,
        chatMessageId,
        text,
        files: undefined,
        relatedMessage: undefined,
      });

      const msg = await chatService.getMessage({
        chatId: groupChatId,
        chatMessageId,
      });

      expect(msg)
        .withContext(`message should be found`)
        .toBeTruthy();
      expect(msg?.chatMessageId)
        .withContext(`found message should have correct chatMessageId`)
        .toBe(chatMessageId);
    }, 35000);

    itCond(`getMessage() should return undefined for non-existent message`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('no-msg-test');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('No Msg Test'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      const msg = await chatService.getMessage({
        chatId: groupChatId,
        chatMessageId: `nonexistent-${Date.now()}`,
      });

      expect(msg)
        .withContext(`message should not be found`)
        .toBeUndefined();
    }, 45000);

    itCond(`getMessagesByChat() should return messages in chat`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('msgs-list-test');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Msgs List Test'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      // Send a regular message so there's at least one regular msg alongside invitation
      const { chatMessageId } = generateChatMessageId();
      await chatService.sendRegularMessage({
        chatId: groupChatId,
        chatMessageId,
        text: `List test message ${Date.now()}`,
        files: undefined,
        relatedMessage: undefined,
      });

      const messages = await chatService.getMessagesByChat(groupChatId);

      expect(messages)
        .withContext(`messages should be an array`)
        .toBeInstanceOf(Array);
      expect(messages.length)
        .withContext(`chat should have at least invitation + regular message`)
        .toBeGreaterThanOrEqual(2);

      // Verify structure of messages
      for (const msg of messages) {
        expect(msg.chatId)
          .withContext(`each message should have chatId`)
          .toBeTruthy();
        expect(msg.chatMessageId)
          .withContext(`each message should have chatMessageId`)
          .toBeTruthy();
        expect(msg.sender)
          .withContext(`each message should have sender`)
          .toBeTruthy();
        expect(typeof msg.timestamp)
          .withContext(`each message should have timestamp`)
          .toBe('number');
      }
    }, 35000);

    itCond(`getMessagesPageByChat() should page through history without gaps`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const ownAddr = await w3n.testStand.idOfTestUser(1);

      const groupChatId = await chatService.createGroupChat({
        chatId: uniqueName('paging-test'),
        name: uniqueName('Paging Test'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      // Written straight to the database: sendRegularMessage() also attempts
      // delivery, which this test has no use for
      const expectedIds: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const { chatMessageId, timestamp } = generateChatMessageId();
        await chatService.makeAndSaveMsgToDb(ownAddr, {
          chatMessageType: 'regular',
          groupChatId: groupChatId.chatId,
          chatMessageId,
          timestamp: timestamp + i,
          body: `Paging message ${i}`,
        });
        expectedIds.push(chatMessageId);
      }

      const collected: string[] = [];
      let before: { timestamp: number; chatMessageId: string } | undefined = undefined;
      let hasMore = true;
      let pages = 0;

      while (hasMore && pages < 10) {
        const page = await chatService.getMessagesPageByChat(groupChatId, { limit: 3, before });
        pages += 1;

        expect(page.msgs.length)
          .withContext(`page should not exceed the requested limit`)
          .toBeLessThanOrEqual(3);

        for (let i = 1; i < page.msgs.length; i += 1) {
          expect(page.msgs[i].timestamp >= page.msgs[i - 1].timestamp)
            .withContext(`page should come in ascending order`)
            .toBeTrue();
        }

        collected.unshift(...page.msgs.map(m => m.chatMessageId));
        hasMore = page.hasMoreOlder;
        const oldest = page.msgs[0];
        before = oldest ? { timestamp: oldest.timestamp, chatMessageId: oldest.chatMessageId } : undefined;
      }

      expect(hasMore)
        .withContext(`paging should reach the start of the history`)
        .toBeFalse();
      expect(new Set(collected).size)
        .withContext(`pages should not repeat messages`)
        .toBe(collected.length);

      for (const id of expectedIds) {
        expect(collected.includes(id))
          .withContext(`message ${id} should be present in the paged history`)
          .toBeTrue();
      }

      const whole = await chatService.getMessagesByChat(groupChatId);
      expect(collected)
        .withContext(`paging should yield the same order as reading the whole history`)
        .toEqual(whole.map(m => m.chatMessageId));
    }, 45000);

    itCond(`getMessagesPageByChat() should not drop messages sharing a timestamp`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const ownAddr = await w3n.testStand.idOfTestUser(1);

      const groupChatId = await chatService.createGroupChat({
        chatId: uniqueName('paging-ties-test'),
        name: uniqueName('Paging Ties Test'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      // Timestamps come from Date.now() and do repeat. A cursor comparing the
      // timestamp alone would step over the twin left on a page boundary, so
      // three messages share one here and the page size splits them apart
      const sharedTimestamp = Date.now();
      const twinIds: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const { chatMessageId } = generateChatMessageId();
        await chatService.makeAndSaveMsgToDb(ownAddr, {
          chatMessageType: 'regular',
          groupChatId: groupChatId.chatId,
          chatMessageId,
          timestamp: sharedTimestamp,
          body: `Same timestamp message ${i}`,
        });
        twinIds.push(chatMessageId);
      }

      const collected: string[] = [];
      let before: { timestamp: number; chatMessageId: string } | undefined = undefined;
      let hasMore = true;
      let pages = 0;

      while (hasMore && pages < 10) {
        const page = await chatService.getMessagesPageByChat(groupChatId, { limit: 2, before });
        pages += 1;
        collected.unshift(...page.msgs.map(m => m.chatMessageId));
        hasMore = page.hasMoreOlder;
        const oldest = page.msgs[0];
        before = oldest ? { timestamp: oldest.timestamp, chatMessageId: oldest.chatMessageId } : undefined;
      }

      for (const id of twinIds) {
        expect(collected.includes(id))
          .withContext(`message ${id} with a shared timestamp should survive paging`)
          .toBeTrue();
      }
      expect(new Set(collected).size)
        .withContext(`messages with a shared timestamp should not repeat across pages`)
        .toBe(collected.length);
    }, 45000);

  });

  describe(`Message Fields Validation`, () => {

    itCond(`message should have all required fields`, async () => {
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const chatIdValue = uniqueName('fields-test');

      const groupChatId = await chatService.createGroupChat({
        chatId: chatIdValue,
        name: uniqueName('Fields Test'),
        members: {
          [sndUserAddr]: { hasAccepted: false },
        },
      });

      const { chatMessageId } = generateChatMessageId();
      const text = `Fields validation message ${Date.now()}`;

      await chatService.sendRegularMessage({
        chatId: groupChatId,
        chatMessageId,
        text,
        files: undefined,
        relatedMessage: undefined,
      });

      const msg = await chatService.getMessage({
        chatId: groupChatId,
        chatMessageId,
      });

      expect(msg)
        .withContext(`message should be found`)
        .toBeTruthy();

      if (msg) {
        expect(msg.chatId)
          .withContext(`message should have chatId`)
          .toBeTruthy();
        expect(msg.chatMessageId)
          .withContext(`message should have chatMessageId`)
          .toBe(chatMessageId);
        expect(msg.sender)
          .withContext(`message should have sender`)
          .toBeTruthy();
        expect(typeof msg.timestamp)
          .withContext(`message should have timestamp`)
          .toBe('number');
        expect(typeof msg.isIncomingMsg)
          .withContext(`message should have isIncomingMsg flag`)
          .toBe('boolean');
      }

      if (msg && msg.chatMessageType === 'regular') {
        expect(msg.body)
          .withContext(`regular message should have body`)
          .toBe(text);
      }
    }, 35000);

  });

});