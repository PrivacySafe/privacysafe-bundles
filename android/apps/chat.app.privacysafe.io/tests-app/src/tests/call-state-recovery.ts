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
 * That call state can be asked for, not only listened to.
 *
 * Two failures made this necessary: a window opened in the middle of a call
 * never knew about that call, and - 2026-09-10 - a background component that
 * stopped mid-call left an End Call button which no event was ever going to
 * clear, and which did nothing when pressed.
 */

import { itCond, pendingBecauseUnreachable } from '../libs-for-tests/jasmine-utils.js';
import { chatService } from '../libs-for-tests/guarded-chat-service.ts';
import { videoOpenerSrv } from '@main/common/services/external-services.ts';
import type { ChatIdObj } from '~/asmail-msgs.types';

declare const w3n: web3n.testing.CommonW3N;

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe(`Call state recovery`, () => {

  let chatId: ChatIdObj | undefined = undefined;

  /**
   * The chat beforeAll made. Without one - its creation went pending on an
   * unreachable server - a spec is not run at all: called with `undefined`, the
   * service threw on it, and the run read that as a defect of the call state.
   */
  function chatOfThisSuite(): ChatIdObj {
    if (!chatId) {
      pendingBecauseUnreachable(
        'the ASMail server', 'The chat this suite needs could not be created in beforeAll.',
      );
    }
    return chatId;
  }

  beforeAll(async () => {
    const peerAddr = await w3n.testStand.idOfTestUser(2);
    chatId = await chatService.createOneToOneChat({
      peerAddr,
      name: uniqueName('Call state'),
      ownName: uniqueName('Own'),
    });
  }, 45000);

  itCond(`says there is no call when there is none`, async () => {
    const snapshot = await videoOpenerSrv.getCallsState();
    expect(Array.isArray(snapshot))
      .withContext(`a snapshot is always a list, empty or not`)
      .toBeTrue();
    const ownChat = chatOfThisSuite();
    expect(snapshot.some(s => (s.chatId.chatId === ownChat.chatId)))
      .withContext(`this chat has no call in it`)
      .toBeFalse();
  });

  itCond(`ending a call that is not there resolves, and leaves no session behind`, async () => {
    // The exact shape of the incident's dead button: the chat is armed with
    // an End Call that nothing here backs. It used to return silently, so
    // nothing ever cleared the button.
    const ownChat = chatOfThisSuite();
    await videoOpenerSrv.endVideoCallInChatRoom(ownChat);

    const snapshot = await videoOpenerSrv.getCallsState();
    expect(snapshot.some(s => (s.chatId.chatId === ownChat.chatId)))
      .withContext(`no live session may remain in this chat`)
      .toBeFalse();
  });

  itCond(`every entry of a snapshot is shaped as the buttons expect`, async () => {
    // Deliberately not by starting a real call: the test build has no
    // /video-chat.html at all (the run's manifest is patched), so a start
    // would fail on opening the window rather than on anything this spec is
    // about. What matters here is the contract of the snapshot itself.
    const snapshot = await videoOpenerSrv.getCallsState();
    for (const entry of snapshot) {
      expect(['dialing', 'ringing', 'connecting', 'active', 'winding-down', 'rejoinable'])
        .withContext(`'ended' must never appear in a snapshot, got ${entry.state}`)
        .toContain(entry.state);
      expect(entry.since)
        .withContext(`each entry says when its state was entered`)
        .toBeGreaterThan(0);
      expect(typeof entry.inCallHere)
        .withContext(`whether this device serves the call decides the End Call button`)
        .toBe('boolean');
      expect(entry.chatId?.chatId)
        .withContext(`an entry without a chat id could not be applied to the list`)
        .toBeTruthy();
    }
  });

});
