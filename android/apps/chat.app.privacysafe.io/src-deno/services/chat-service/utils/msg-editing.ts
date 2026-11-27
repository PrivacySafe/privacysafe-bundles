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
import { ChatIdObj } from '../../../../types/asmail-msgs.types.ts';
import { ChatMessageHistory } from '../../../../types/chat.types.ts';
import type { ChatSrvEmit, DB, MsgDbEntry } from '../../../types/index.ts';
import { makeSystemEventPhantom, queueSyncPhantom } from '../../mail-sending-service/index.ts';
import { msgEntityId } from './sync-versions.ts';
import { capHistory, MAX_MSG_BODY_LENGTH } from './peer-input-checks.ts';
import { areAddressesEqual } from '../../../../shared-libs/address-utils.ts';

/**
 * Whether a peer's edit may touch a record: an incoming regular message, and in
 * a group chat one this very member sent.
 */
function isEditableBy(msg: MsgDbEntry, chatId: ChatIdObj, sender: string): boolean {
  if ((msg.chatMessageType !== 'regular') || !msg.isIncomingMsg) {
    return false;
  }
  return chatId.isGroupChat ? (!!msg.groupSender && areAddressesEqual(msg.groupSender, sender)) : true;
}

export async function msgEditing({
  data,
  emit,
  ownAddr,
  getAppDeviceId,
  nextSyncStamp,
}: {
  data: DB;
  emit: ChatSrvEmit;
  ownAddr: string;
  getAppDeviceId: () => string;
  nextSyncStamp: () => Promise<number>;
}) {
  async function getNecessaryMsgData({
    chatId,
    chatMessageId,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
  }): Promise<{ body: string | null; history: ChatMessageHistory }> {
    const msg = await data.getMessage({ chatId, chatMessageId });
    if (!msg) {
      throw Error(`The message with id ${JSON.stringify({ chatId, chatMessageId })} is not found`);
    }

    let { history } = msg;
    if (!history) {
      history = {
        changes: [],
      };
    }

    return { body: msg.body, history };
  }

  async function editMessage({
    chatId,
    chatMessageId,
    updatedBody,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
    updatedBody: string;
  }) {
    const { body, history } = await getNecessaryMsgData({ chatId, chatMessageId });
    history.changes!.push({
      timestamp: Date.now(),
      user: ownAddr,
      type: 'body',
      value: body || '',
    });

    const updatedMsg = await data.updateMessageRecord({ chatId, chatMessageId }, { body: updatedBody, history });

    // Stamped and synced right where the change is applied - see the matching
    // comment in renameChat() (chat-renaming.ts).
    const syncStamp = await nextSyncStamp();
    await queueSyncPhantom({
      db: data,
      ownAddr,
      phantom: makeSystemEventPhantom({
        chatId,
        sourceDeviceId: getAppDeviceId(),
        timestamp: syncStamp,
        chatMessageId,
        chatSystemData: {
          event: 'update:body',
          value: { chatMessageId, body: updatedBody },
        },
      }),
      versions: [
        {
          entityType: 'msg',
          entityId: msgEntityId(chatId, chatMessageId),
          aspect: 'body',
          ts: syncStamp,
          deviceId: getAppDeviceId(),
        },
      ],
    });

    return updatedMsg;
  }

  async function handleUpdateOfMessageBody({
    user,
    chatId,
    chatMessageId,
    timestamp,
    body,
  }: {
    user: string;
    chatId: ChatIdObj;
    chatMessageId: string;
    timestamp: number;
    body: unknown;
  }): Promise<void> {
    // Only the author edits a message. Without this any peer rewrote whatever it
    // named in the chat: the user's own sent messages, other members' ones, even
    // system and invitation records, whose body the GUI parses.
    const msg = await data.getMessage({ chatId, chatMessageId });
    if (msg && !isEditableBy(msg, chatId, user)) {
      await w3n.log('warning', `Edit of ${chatMessageId} by ${user}, who is not its author; ignoring it`);
      return;
    }
    if ((typeof body !== 'string') || (body.length > MAX_MSG_BODY_LENGTH)) {
      await w3n.log('warning', `Edit of ${chatMessageId} by ${user} has no valid body; ignoring it`);
      return;
    }
    const { body: oldBody, history } = await getNecessaryMsgData({ chatId, chatMessageId });
    if (oldBody === body) {
      // Already applied - this is a redelivery within the deferred inbox
      // removal window (P1). getNecessaryMsgData() reads the CURRENT state, so
      // re-applying here would push a bogus "old value" (the already-applied
      // new one) into history.
      return;
    }

    history.changes!.push({
      timestamp,
      user,
      type: 'body',
      value: oldBody || '',
    });

    const updatedMsg = await data.updateMessageRecord(
      { chatId, chatMessageId },
      { body, history: capHistory(history) },
    );

    // Peer-originated change - see the matching comment in
    // handleUpdateChatName() (chat-renaming.ts) on the token used here.
    await data.setSyncVersion('msg', msgEntityId(chatId, chatMessageId), 'body', {
      ts: timestamp,
      deviceId: user,
    });

    emit.message.updated(updatedMsg);
  }

  return {
    editMessage,
    handleUpdateOfMessageBody,
  };
}
