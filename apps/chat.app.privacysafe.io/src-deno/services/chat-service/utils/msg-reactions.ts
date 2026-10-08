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
import type { ChatIdObj } from '../../../../types/asmail-msgs.types.ts';
import type { ChatMessageHistory, ChatMessageReaction } from '../../../../types/chat.types.ts';
import type { ChatSrvEmit, DB } from '../../../types/index.ts';
import { makeSystemEventPhantom, queueSyncPhantom } from '../../mail-sending-service/index.ts';
import { msgEntityId } from './sync-versions.ts';

export async function msgReactions({
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
  }): Promise<{ history: ChatMessageHistory; reactions: Record<string, ChatMessageReaction> }> {
    const msg = await data.getMessage({ chatId, chatMessageId });
    if (!msg) {
      throw Error(`The message with id ${JSON.stringify({ chatId, chatMessageId })} is not found`);
    }

    let { history, reactions } = msg;
    if (!history) {
      history = {
        changes: [],
      };
    }

    if (!reactions) {
      reactions = {};
    }

    return { history, reactions };
  }

  async function getRecentReactions(quantity: number): Promise<string[]> {
    return data.getRecentReactions(quantity);
  }

  async function changeMessageReactions({
    chatId,
    chatMessageId,
    updatedReactions,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
    updatedReactions: Record<string, ChatMessageReaction>;
  }) {
    const { history, reactions } = await getNecessaryMsgData({ chatId, chatMessageId });
    history.changes!.push({
      timestamp: Date.now(),
      user: ownAddr,
      type: 'reaction',
      value: reactions,
    });

    const updatedMsg = await data.updateMessageRecord(
      { chatId, chatMessageId },
      { history, reactions: updatedReactions },
    );

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
          event: 'update:reactions',
          value: { chatMessageId, reactions: updatedReactions },
        },
      }),
      versions: [
        {
          entityType: 'msg',
          entityId: msgEntityId(chatId, chatMessageId),
          aspect: 'reactions',
          ts: syncStamp,
          deviceId: getAppDeviceId(),
        },
      ],
    });

    return updatedMsg;
  }

  async function handleChangeOfReactions({
    user,
    chatId,
    chatMessageId,
    timestamp,
    reactions,
  }: {
    user: string;
    chatId: ChatIdObj;
    chatMessageId: string;
    timestamp: number;
    reactions: Record<string, ChatMessageReaction>;
  }): Promise<void> {
    const { reactions: oldReactions, history } = await getNecessaryMsgData({ chatId, chatMessageId });
    if (JSON.stringify(oldReactions) === JSON.stringify(reactions)) {
      // Already applied - see the matching comment in handleUpdateOfMessageBody()
      // (msg-editing.ts).
      return;
    }

    history.changes!.push({
      timestamp,
      user,
      type: 'reaction',
      value: oldReactions,
    });

    const updatedMsg = await data.updateMessageRecord({ chatId, chatMessageId }, { history, reactions });

    // Peer-originated change - see the matching comment in
    // handleUpdateChatName() (chat-renaming.ts) on the token used here.
    await data.setSyncVersion('msg', msgEntityId(chatId, chatMessageId), 'reactions', {
      ts: timestamp,
      deviceId: user,
    });

    emit.message.updated(updatedMsg);
  }

  return {
    getRecentReactions,
    changeMessageReactions,
    handleChangeOfReactions,
  };
}
