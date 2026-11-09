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
import type { ChatIdObj, ChatSystemMessageData } from '../../../types/asmail-msgs.types.ts';
import type { ChatMessageView, RegularMsgView } from '../../../types/chat.types.ts';
import type { MsgDbEntry } from '../../types/index.ts';
import { makeSystemEventPhantom, queueSyncPhantom } from '../mail-sending-service/index.ts';
import { msgViewFromDbEntry } from './utils/_msgs-related-methods.ts';
import { msgEntityId } from './utils/sync-versions.ts';
import type { ChatSrvCtx } from './chat-srv-ctx.ts';
import type { ChatQueries } from './chat-queries.ts';

/**
 * Records this device writes on its own (call records and the like), and their
 * phantoms for the user's other devices.
 */
export function makeLocalSystemEvents(ctx: ChatSrvCtx, { getMessage }: Pick<ChatQueries, 'getMessage'>) {
  const { data, ownAddr, getAppDeviceId, nextSyncStamp } = ctx;

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

  return { makeAndSaveMsgToDb, syncLocallyMadeSystemEvent, saveAndSyncLocalSystemMsg };
}
