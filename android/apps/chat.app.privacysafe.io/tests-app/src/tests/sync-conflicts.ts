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
 * The receiving side of multi-device synchronization (P2-8).
 *
 * Two kinds of specs here, and the split is deliberate:
 *
 * - **Test Suite 1** exercises the last-write-wins rules directly. They are
 *   plain functions over an ordering token, so nothing is stubbed beyond an
 *   in-memory version store - and that store implements `SyncVersionStore`
 *   honestly, without an `as unknown as` cast. That cast is what let the
 *   WebRTC mocks drift from their interface for three months (P4-2).
 * - **Test Suites 2 and 3** feed synthesized phantoms to the real background
 *   service through `handleIncomingMsg`. A device skips its own phantoms by
 *   `sourceDeviceId`, and the stand has no second device of the same user, so
 *   this is the only way to reach the receiving path at all.
 *
 * None of it touches the network: chats are created from invitation phantoms
 * rather than through `createGroupChat()`, which pre-flights peer addresses.
 * These specs are therefore expected to be green even when the server is not
 * reachable.
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { chatService } from '@main/common/services/external-services.ts';
import {
  applyIfNewer,
  isDeletedLaterThan,
  isNewerToken,
  recordDeletion,
  type SyncToken,
  type SyncVersionStore,
} from '@deno/services/chat-service/utils/sync-versions.ts';
import { chatMessageIdForCallEvent } from '../../../shared-libs/chat-ids.ts';
import type { SyncAspect, SyncEntityType, SyncVersionDbEntry } from '@deno/types/msgs-db.types.ts';
import type { ChatIdObj, ChatIncomingMessage } from '~/asmail-msgs.types';

declare const w3n: web3n.testing.CommonW3N;

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// In-memory sync version store
// =============================================================================

/**
 * Implements exactly the slice of the database that the last-write-wins rules
 * use. Typed as `SyncVersionStore`, so if that slice ever grows, this stops
 * compiling instead of failing at runtime.
 */
function makeVersionStore(): SyncVersionStore & { size(): number } {
  const rows = new Map<string, SyncVersionDbEntry>();
  const key = (entityType: SyncEntityType, entityId: string, aspect: SyncAspect) =>
    `${entityType}/${entityId}/${aspect}`;

  return {
    getSyncVersion(entityType, entityId, aspect) {
      return rows.get(key(entityType, entityId, aspect));
    },
    setSyncVersion(entityType, entityId, aspect, version) {
      rows.set(key(entityType, entityId, aspect), {
        ts: version.ts,
        deviceId: version.deviceId,
        tombstonedAt: version.tombstonedAt ?? null,
      });
      return Promise.resolve();
    },
    deleteSyncVersionsOf(entityType, entityId) {
      for (const [k, row] of [...rows.entries()]) {
        if (k.startsWith(`${entityType}/${entityId}/`) && row.tombstonedAt === null) {
          rows.delete(k);
        }
      }
      return Promise.resolve();
    },
    size: () => rows.size,
  };
}

// =============================================================================
// Phantom synthesis
// =============================================================================

/**
 * Wraps a phantom body into an inbox message, as the dispatcher would hand it
 * over. `msgId` is synthetic on purpose: the receiving path only ever passes it
 * to inbox removal, which ignores a message it cannot find.
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

function regularMsgValue(chatMessageId: string, groupChatId: string, text: string) {
  return {
    v: 1,
    chatMessageType: 'regular',
    chatMessageId,
    groupChatId,
    text,
    attachments: [],
    status: 'sent',
  };
}

function bodyUpdateValue(chatMessageId: string, groupChatId: string, body: string) {
  return {
    v: 1,
    chatMessageType: 'system',
    groupChatId,
    chatMessageId,
    chatSystemData: {
      event: 'update:body',
      value: { chatMessageId, body },
    },
  };
}

/**
 * A record of a call this device declined, as the declining device's phantom
 * carries it. Nothing about such a record ever goes to peers, so this phantom is
 * the only way it reaches the user's other devices.
 */
function webrtcCallCancelledValue(chatMessageId: string, groupChatId: string, peerAddr: string) {
  return {
    v: 1,
    chatMessageType: 'system',
    groupChatId,
    chatMessageId,
    chatSystemData: {
      event: 'webrtc-call',
      value: {
        subType: 'incoming-call-cancelled',
        sender: peerAddr,
        chatId: { isGroupChat: true, chatId: groupChatId },
      },
    },
  };
}

/**
 * A record of a call, as the phantom of a device that answered it carries it.
 * Its id is derived from the call session, so every device of the user that
 * answers writes this same record.
 */
function callRecordValue(
  chatMessageId: string, groupChatId: string, peerAddr: string, endTimestamp?: number,
) {
  return {
    v: 1,
    chatMessageType: 'system',
    groupChatId,
    chatMessageId,
    chatSystemData: {
      event: 'call',
      value: { sender: peerAddr, direction: 'incoming', endTimestamp },
    },
  };
}

function deleteMessageValue(chatMessageId: string, chatId: ChatIdObj) {
  return {
    v: 1,
    chatMessageType: 'system',
    groupChatId: chatId.isGroupChat ? chatId.chatId : undefined,
    chatSystemData: {
      event: 'delete:message',
      value: { oneMessage: { chatId, chatMessageId } },
    },
  };
}

function resyncAskValue(chatMessageId: string, groupChatId: string) {
  return {
    v: 1,
    chatMessageType: 'system',
    groupChatId,
    chatSystemData: {
      event: 'resync:msg-record',
      value: { chatMessageId },
    },
  };
}

/**
 * A real group invitation from a peer, as it would arrive over ASMail - not a
 * phantom. This is the path that creates a chat via handleGroupChatInvitation()
 * rather than via an invitation sync of the user's own other device.
 */
function peerGroupInvitationMsg(
  sender: string,
  ownAddr: string,
  groupChatId: string,
  name: string,
): ChatIncomingMessage {
  return {
    msgId: uniqueName('synthetic-invitation'),
    msgType: 'chat',
    deliveryTS: Date.now(),
    sender,
    establishedSenderKeyChain: true,
    jsonBody: {
      v: 1,
      chatMessageType: 'invitation',
      chatMessageId: uniqueName('inv'),
      inviteData: {
        type: 'group-chat-invite',
        groupChatId,
        name,
        members: {
          [sender]: { hasAccepted: true },
          [ownAddr]: { hasAccepted: false },
        },
        admins: [sender],
      },
    },
  } as ChatIncomingMessage;
}

describe(`Synchronization conflicts and buffering`, () => {

  // ===========================================================================
  describe(`Test Suite 1: last-write-wins rules`, () => {

    itCond(`an absent stored token lets anything through`, async () => {
      expect(isNewerToken({ ts: 1, deviceId: 'a' }, undefined))
        .withContext(`nothing has been applied yet, so anything is newer`)
        .toBeTrue();
    });

    itCond(`a greater stamp wins, a smaller one loses`, async () => {
      const stored: SyncToken = { ts: 1000, deviceId: 'desktop' };
      expect(isNewerToken({ ts: 1001, deviceId: 'desktop' }, stored)).toBeTrue();
      expect(isNewerToken({ ts: 999, deviceId: 'desktop' }, stored)).toBeFalse();
    });

    itCond(`equal stamps are decided by deviceId, and both devices agree`, async () => {
      const fromDesktop: SyncToken = { ts: 1000, deviceId: 'desktop-aaa' };
      const fromPhone: SyncToken = { ts: 1000, deviceId: 'phone-zzz' };

      // The same pair, judged from either side, must name the same winner -
      // without a total order the two devices would diverge for good.
      expect(isNewerToken(fromPhone, fromDesktop))
        .withContext(`on the desktop: the phone's change wins`)
        .toBeTrue();
      expect(isNewerToken(fromDesktop, fromPhone))
        .withContext(`on the phone: its own change stays`)
        .toBeFalse();
    });

    itCond(`an identical token loses, which is what makes a re-sent phantom harmless`, async () => {
      const token: SyncToken = { ts: 1000, deviceId: 'desktop' };
      expect(isNewerToken({ ...token }, token))
        .withContext(`already applied - the journal relies on this when it re-sends`)
        .toBeFalse();
    });

    itCond(`applyIfNewer applies and records a newer change`, async () => {
      const db = makeVersionStore();
      let applied = 0;

      const ok = await applyIfNewer(
        { db, entityType: 'msg', entityId: 'g/chat/msg-1', aspect: 'body', token: { ts: 100, deviceId: 'a' } },
        async () => {
          applied += 1;
        },
      );

      expect(ok).toBeTrue();
      expect(applied).toBe(1);
      expect(db.getSyncVersion('msg', 'g/chat/msg-1', 'body')?.ts).toBe(100);
    });

    itCond(`applyIfNewer neither applies nor re-stamps a stale change`, async () => {
      const db = makeVersionStore();
      await applyIfNewer(
        { db, entityType: 'msg', entityId: 'g/chat/msg-1', aspect: 'body', token: { ts: 200, deviceId: 'b' } },
        async () => {},
      );

      let applied = 0;
      const ok = await applyIfNewer(
        { db, entityType: 'msg', entityId: 'g/chat/msg-1', aspect: 'body', token: { ts: 100, deviceId: 'a' } },
        async () => {
          applied += 1;
        },
      );

      expect(ok).withContext(`stale change is refused`).toBeFalse();
      expect(applied).withContext(`its effect never runs`).toBe(0);
      expect(db.getSyncVersion('msg', 'g/chat/msg-1', 'body')?.ts)
        .withContext(`and the stored token is left as it was`)
        .toBe(200);
    });

    itCond(`versions are per aspect, so an unrelated change does not shadow one`, async () => {
      const db = makeVersionStore();
      await applyIfNewer(
        { db, entityType: 'chat', entityId: 'g/chat', aspect: 'members', token: { ts: 500, deviceId: 'a' } },
        async () => {},
      );

      const ok = await applyIfNewer(
        { db, entityType: 'chat', entityId: 'g/chat', aspect: 'name', token: { ts: 100, deviceId: 'a' } },
        async () => {},
      );

      expect(ok)
        .withContext(`an older rename is not made stale by a newer membership change`)
        .toBeTrue();
    });

    itCond(`a phantom older than a tombstone is refused, a newer one is not`, async () => {
      const db = makeVersionStore();
      await recordDeletion(db, 'msg', 'g/chat/msg-1', { ts: 200, deviceId: 'b' });

      expect(isDeletedLaterThan(db, 'msg', 'g/chat/msg-1', { ts: 100, deviceId: 'a' }))
        .withContext(`the change predates the deletion, so it must not resurrect it`)
        .toBeTrue();
      expect(isDeletedLaterThan(db, 'msg', 'g/chat/msg-1', { ts: 300, deviceId: 'a' }))
        .withContext(`a change made after the deletion is a different matter`)
        .toBeFalse();
    });

    itCond(`recordDeletion drops other aspects but keeps the tombstone`, async () => {
      const db = makeVersionStore();
      await applyIfNewer(
        { db, entityType: 'msg', entityId: 'g/chat/msg-1', aspect: 'body', token: { ts: 100, deviceId: 'a' } },
        async () => {},
      );
      await recordDeletion(db, 'msg', 'g/chat/msg-1', { ts: 200, deviceId: 'a' });

      expect(db.getSyncVersion('msg', 'g/chat/msg-1', 'body'))
        .withContext(`versions of a deleted entity are of no use`)
        .toBeUndefined();
      expect(db.getSyncVersion('msg', 'g/chat/msg-1', 'deleted')?.tombstonedAt)
        .withContext(`the tombstone outlives the entity, and is collected by age`)
        .toBeTruthy();
    });

  });

  // ===========================================================================
  describe(`Test Suite 2: buffering of phantoms that arrive early`, () => {

    itCond(`a phantom for an unknown chat waits, and is applied once the chat appears`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('buffer-chat');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');
      const text = `Message that arrived before its chat ${Date.now()}`;

      // The record phantom comes first, for a chat this device knows nothing
      // about.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1000, regularMsgValue(chatMessageId, groupChatId, text)),
      );

      expect(await chatService.getChat(chatId))
        .withContext(`a message phantom must not conjure a chat out of nothing`)
        .toBeUndefined();

      // Now the chat itself.
      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1100,
          groupInvitationValue(groupChatId, uniqueName('Buffered Chat'), ownAddr),
        ),
      );

      expect(await chatService.getChat(chatId))
        .withContext(`the invitation phantom creates it`)
        .toBeDefined();

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg)
        .withContext(`and the buffered message is drained into it`)
        .toBeDefined();
      expect(msg && msg.chatMessageType === 'regular' ? msg.body : undefined).toBe(text);
    }, 20000);

    itCond(`a change for an unknown message waits for the record`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('buffer-msg');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');
      const editedBody = `Edited before the record arrived ${Date.now()}`;

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Buffered Msg Chat'), ownAddr),
        ),
      );

      // The chat is there, the message is not.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1200, bodyUpdateValue(chatMessageId, groupChatId, editedBody)),
      );

      expect(await chatService.getMessage({ chatId, chatMessageId }))
        .withContext(`an edit must not create the message it edits`)
        .toBeUndefined();

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1100,
          regularMsgValue(chatMessageId, groupChatId, 'original text'),
        ),
      );

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg).withContext(`the record phantom creates it`).toBeDefined();
      expect(msg && msg.chatMessageType === 'regular' ? msg.body : undefined)
        .withContext(`with the buffered edit already applied on top`)
        .toBe(editedBody);
    }, 20000);

    itCond(`buffered changes are drained by change time, not by arrival order`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('drain-order');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');
      const newerBody = `Newer edit ${Date.now()}`;
      const olderBody = `Older edit ${Date.now()}`;

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Drain Order Chat'), ownAddr),
        ),
      );

      // Both edits arrive before the record, newest first - so applying them in
      // arrival order would leave the older text in place.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 3000, bodyUpdateValue(chatMessageId, groupChatId, newerBody)),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 2000, bodyUpdateValue(chatMessageId, groupChatId, olderBody)),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1100,
          regularMsgValue(chatMessageId, groupChatId, 'original text'),
        ),
      );

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg && msg.chatMessageType === 'regular' ? msg.body : undefined)
        .withContext(`the newer edit must win regardless of the order they were buffered in`)
        .toBe(newerBody);
    }, 20000);

  });

  // ===========================================================================
  describe(`Test Suite 3: redelivery of the same phantom`, () => {

    itCond(`the same record phantom twice leaves one message`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('redelivery');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Redelivery Chat'), ownAddr),
        ),
      );

      const recordPhantom = regularMsgValue(chatMessageId, groupChatId, 'delivered twice');
      await chatService.handleIncomingMsg(phantomMsg(ownAddr, chatId, otherDeviceId, 1100, recordPhantom));
      await chatService.handleIncomingMsg(phantomMsg(ownAddr, chatId, otherDeviceId, 1100, recordPhantom));

      const msgs = await chatService.getMessagesByChat(chatId);
      expect(msgs.filter(m => m.chatMessageId === chatMessageId).length)
        .withContext(`an inbox message can be delivered again within the 15-day window`)
        .toBe(1);
    }, 20000);

    itCond(`a stale edit arriving after a newer one is ignored`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('stale-edit');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');
      const newerBody = `Newer body ${Date.now()}`;

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Stale Edit Chat'), ownAddr),
        ),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1100,
          regularMsgValue(chatMessageId, groupChatId, 'original text'),
        ),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 3000, bodyUpdateValue(chatMessageId, groupChatId, newerBody)),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 2000, bodyUpdateValue(chatMessageId, groupChatId, 'stale body')),
      );

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg && msg.chatMessageType === 'regular' ? msg.body : undefined)
        .withContext(`the newer edit stands`)
        .toBe(newerBody);
    }, 20000);

  });

  // ===========================================================================
  describe(`Test Suite 4: a synchronized message without files`, () => {

    itCond(`carries no attachments, rather than an empty list`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('no-attachments');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('No Attachments Chat'), ownAddr),
        ),
      );

      // `regularMsgValue` sends `attachments: []` - the shape phantoms of
      // earlier builds have for a message with no files, and the reason this
      // spec exists. An empty array is truthy, so it survived all the way into
      // the record and read there as "there are files, but only on the device
      // that sent this" - a caption about files under a message that has none.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1100, regularMsgValue(chatMessageId, groupChatId, 'just text')),
      );

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg)
        .withContext(`the message itself is there`)
        .toBeDefined();
      expect(msg && msg.chatMessageType === 'regular' ? msg.attachments : 'not a regular message')
        .withContext(`no files means no attachments at all`)
        .toBeUndefined();
    }, 20000);

  });

  // ===========================================================================
  describe(`Test Suite 5: record resync asks (resync:msg-record)`, () => {

    itCond(`an ask about a record this device has changes nothing locally`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('resync-known');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Resync Known Chat'), ownAddr),
        ),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1100, regularMsgValue(chatMessageId, groupChatId, 'the record')),
      );

      const before = await chatService.getMessagesByChat(chatId);

      // Another device says it is missing this record. The answer goes out as
      // a phantom; locally the ask must leave no trace - no new records, no
      // changes of existing ones.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 2000, resyncAskValue(chatMessageId, groupChatId)),
      );

      const after = await chatService.getMessagesByChat(chatId);
      expect(after.length)
        .withContext(`an ask is not a message - it must not appear in history`)
        .toBe(before.length);
      const record = after.find(m => m.chatMessageId === chatMessageId);
      expect(record && record.chatMessageType === 'regular' ? record.body : undefined)
        .withContext(`the asked-for record stays as it was`)
        .toBe('the record');
    }, 20000);

    itCond(`an ask about an unknown record conjures nothing and breaks nothing`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('resync-unknown');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Resync Unknown Chat'), ownAddr),
        ),
      );

      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 2000, resyncAskValue(chatMessageId, groupChatId)),
      );

      expect(await chatService.getMessage({ chatId, chatMessageId }))
        .withContext(`a device that has no record stays silent; the ask must not create one`)
        .toBeUndefined();

      // The ask is also not buffered as an orphan: a record phantom arriving
      // later must not replay it into anything.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1100, regularMsgValue(chatMessageId, groupChatId, 'late record')),
      );
      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg && msg.chatMessageType === 'regular' ? msg.body : undefined).toBe('late record');
    }, 20000);

    itCond(`an ask about a chat this device does not know is dropped, not buffered`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('resync-no-chat');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };

      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 2000, resyncAskValue(uniqueName('msg'), groupChatId)),
      );

      expect(await chatService.getChat(chatId))
        .withContext(`an ask must not conjure a chat, and a device without the chat cannot answer`)
        .toBeUndefined();
    }, 20000);

    itCond(`a record phantom of an incoming message keeps its direction and sender`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('resync-incoming');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Resync Incoming Chat'), ownAddr),
        ),
      );

      // The shape a resync answer has for an incoming record: without the
      // isIncomingMsg/groupSender fields the restored message would read as
      // the user's own.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1100, {
          ...regularMsgValue(chatMessageId, groupChatId, 'peer said this'),
          status: 'read',
          isIncomingMsg: true,
          groupSender: sndUserAddr,
        }),
      );

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg).toBeDefined();
      expect(msg!.isIncomingMsg)
        .withContext(`the record is of an incoming message`)
        .toBeTrue();
      expect(msg!.sender)
        .withContext(`with its sender preserved, not replaced by the user`)
        .toBe(sndUserAddr);
    }, 20000);

  });

  // ===========================================================================
  describe(`Test Suite 6: chat created from a peer's invitation drains buffered phantoms`, () => {

    itCond(`a phantom buffered before the chat existed is applied when a peer's invitation creates it`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const sndUserAddr = await w3n.testStand.idOfTestUser(2);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('peer-invite-drain');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = uniqueName('msg');
      const text = `Buffered before the peer's invitation ${Date.now()}`;

      // A record phantom from the user's own other device arrives first - that
      // device already accepted the chat, this one hasn't even been invited yet.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1000, regularMsgValue(chatMessageId, groupChatId, text)),
      );
      expect(await chatService.getChat(chatId)).toBeUndefined();

      // Now the chat comes to exist from the *peer's* real invitation - the
      // path that used to leave buffered phantoms stuck: the chat existed, but
      // stayed empty.
      await chatService.handleIncomingMsg(
        peerGroupInvitationMsg(sndUserAddr, ownAddr, groupChatId, uniqueName('Peer Invite Chat')),
      );

      expect(await chatService.getChat(chatId))
        .withContext(`the peer's invitation creates the chat`)
        .toBeDefined();

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg)
        .withContext(`and draining applies the buffered record into it`)
        .toBeDefined();
      expect(msg && msg.chatMessageType === 'regular' ? msg.body : undefined).toBe(text);
    }, 20000);

  });

  // ===========================================================================
  describe(`Test Suite 7: records of a call ('webrtc-call')`, () => {

    async function chatWithDeclinedCall(prefix: string): Promise<{
      ownAddr: string;
      otherDeviceId: string;
      chatId: ChatIdObj;
      groupChatId: string;
      chatMessageId: string;
      peerAddr: string;
    }> {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const peerAddr = await w3n.testStand.idOfTestUser(2);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName(prefix);
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Declined Call Chat'), ownAddr),
        ),
      );

      return { ownAddr, otherDeviceId, chatId, groupChatId, chatMessageId: uniqueName('call-msg'), peerAddr };
    }

    itCond(`a cancelled-call record reaches a device that never rang`, async () => {
      const { ownAddr, otherDeviceId, chatId, groupChatId, chatMessageId, peerAddr } =
        await chatWithDeclinedCall('webrtc-call-sync');

      // Declining is a decision of one device; before this branch existed the
      // phantom fell through to "Unhandled system sync event" and the line was
      // missing everywhere except the device the button was pressed on.
      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1100,
          webrtcCallCancelledValue(chatMessageId, groupChatId, peerAddr),
        ),
      );

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      expect(msg)
        .withContext(`the phantom creates the record`)
        .toBeDefined();
      expect(msg?.chatMessageType)
        .withContext(`as a system record, the same as a locally made one`)
        .toBe('system');
      expect(msg?.isIncomingMsg)
        .withContext(`written by a device of ours, not received from the peer`)
        .toBeFalse();

      const systemData = msg?.chatMessageType === 'system' ? msg.systemData : undefined;
      expect(systemData?.event).toBe('webrtc-call');
      const value = systemData?.event === 'webrtc-call' ? systemData.value : undefined;
      expect(value?.subType)
        .withContext(`the subType is what makes the line read as a cancellation`)
        .toBe('incoming-call-cancelled');
      expect(value?.sender)
        .withContext(`and the sender names the peer whose call it was`)
        .toBe(peerAddr);
    }, 20000);

    itCond(`the same cancelled-call phantom twice leaves one record`, async () => {
      const { ownAddr, otherDeviceId, chatId, groupChatId, chatMessageId, peerAddr } =
        await chatWithDeclinedCall('webrtc-call-redelivery');

      const phantom = webrtcCallCancelledValue(chatMessageId, groupChatId, peerAddr);
      await chatService.handleIncomingMsg(phantomMsg(ownAddr, chatId, otherDeviceId, 1100, phantom));
      await chatService.handleIncomingMsg(phantomMsg(ownAddr, chatId, otherDeviceId, 1100, phantom));

      const msgs = await chatService.getMessagesByChat(chatId);
      expect(msgs.filter(m => m.chatMessageId === chatMessageId).length)
        .withContext(`a redelivered phantom must not add a second line about one call`)
        .toBe(1);
    }, 20000);

    itCond(`declines by two members of one call stay two records`, async () => {
      const { ownAddr, otherDeviceId, chatId, groupChatId } =
        await chatWithDeclinedCall('webrtc-call-two-declines');
      const callSessionId = `${await w3n.testStand.idOfTestUser(2)}#desktop-AAA-1`;
      const oneWhoDeclined = 'one@example.com';
      const otherWhoDeclined = 'two@example.com';
      // Ids as the declining devices derive them: the same session, told apart
      // by the address the record names. An id built out of the session alone
      // would have dropped the second decline as a record already there.
      const firstId = chatMessageIdForCallEvent('call-cancelled', callSessionId, oneWhoDeclined);
      const secondId = chatMessageIdForCallEvent('call-cancelled', callSessionId, otherWhoDeclined);

      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1100,
          webrtcCallCancelledValue(firstId, groupChatId, oneWhoDeclined)),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1200,
          webrtcCallCancelledValue(secondId, groupChatId, otherWhoDeclined)),
      );

      const msgs = await chatService.getMessagesByChat(chatId);
      expect(msgs.filter(m => (m.chatMessageId === firstId) || (m.chatMessageId === secondId)).length)
        .withContext(`each member's decline is a line of its own`)
        .toBe(2);
    }, 20000);

    itCond(`a record deleted after the phantom was made is not resurrected`, async () => {
      const { ownAddr, otherDeviceId, chatId, groupChatId, chatMessageId, peerAddr } =
        await chatWithDeclinedCall('webrtc-call-tombstone');

      // The deletion is newer than the record phantom that follows it, which is
      // exactly the order a redelivery produces.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 2000, deleteMessageValue(chatMessageId, chatId)),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1100,
          webrtcCallCancelledValue(chatMessageId, groupChatId, peerAddr),
        ),
      );

      expect(await chatService.getMessage({ chatId, chatMessageId }))
        .withContext(`the tombstone outranks a phantom made before it`)
        .toBeUndefined();
    }, 20000);

  });

  // ===========================================================================
  describe(`Test Suite 8: one record per call, whichever device answered`, () => {

    itCond(`two devices answering one call leave one record, not two`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const peerAddr = await w3n.testStand.idOfTestUser(2);
      const groupChatId = uniqueName('call-glare');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      // The id both devices derive from the call session; before it was derived,
      // each device generated its own and the user saw two identical lines.
      const chatMessageId = `call:${peerAddr}#7`;

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          `other-device-a-${Date.now()}`,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Call Glare Chat'), ownAddr),
        ),
      );

      // Two DIFFERENT devices of ours, each having answered the same call.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, 'other-device-answered-first', 1100,
          callRecordValue(chatMessageId, groupChatId, peerAddr)),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, 'other-device-answered-too', 1200,
          callRecordValue(chatMessageId, groupChatId, peerAddr)),
      );

      const msgs = await chatService.getMessagesByChat(chatId);
      expect(msgs.filter(m => m.chatMessageId === chatMessageId).length)
        .withContext(`one call, one line in history`)
        .toBe(1);
    }, 20000);

    itCond(`the duration lands on a call record that arrived as a phantom`, async () => {
      const ownAddr = await w3n.testStand.idOfTestUser(1);
      const peerAddr = await w3n.testStand.idOfTestUser(2);
      const otherDeviceId = `other-device-${Date.now()}`;
      const groupChatId = uniqueName('call-duration');
      const chatId: ChatIdObj = { isGroupChat: true, chatId: groupChatId };
      const chatMessageId = `call:${peerAddr}#8`;
      const endTimestamp = 1786810669495;

      await chatService.handleIncomingMsg(
        phantomMsg(
          ownAddr,
          chatId,
          otherDeviceId,
          1000,
          groupInvitationValue(groupChatId, uniqueName('Call Duration Chat'), ownAddr),
        ),
      );
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1100,
          callRecordValue(chatMessageId, groupChatId, peerAddr)),
      );

      // The device that stayed in the call stamps the duration and synchronizes
      // it as an update:body naming this id. With per-device ids that id existed
      // nowhere else, and the stamp sat in the orphan buffer for good - which is
      // why one of the two lines showed a duration and the other never did.
      await chatService.handleIncomingMsg(
        phantomMsg(ownAddr, chatId, otherDeviceId, 1300, bodyUpdateValue(
          chatMessageId,
          groupChatId,
          JSON.stringify(
            callRecordValue(chatMessageId, groupChatId, peerAddr, endTimestamp).chatSystemData,
          ),
        )),
      );

      const msg = await chatService.getMessage({ chatId, chatMessageId });
      const systemData = msg?.chatMessageType === 'system' ? msg.systemData : undefined;
      const value = systemData?.event === 'call' ? systemData.value : undefined;
      expect(value?.endTimestamp)
        .withContext(`the call record shows how long the call was`)
        .toBe(endTimestamp);
    }, 20000);

  });

});
