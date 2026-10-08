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
import type { ChatMessageId } from '../../../../types/asmail-msgs.types.ts';
import type {
  ChatMessageHistoryChange,
  ChatMessageHistoryErrors,
  LocalMetadataInDelivery,
} from '../../../../types/chat.types.ts';
import type { ChatSrvEmit, DB } from '../../../types/index.ts';
import { makeMsgRecordPhantom, queueSyncPhantom } from '../sync-phantoms.ts';
import { removeMsgFromDelivery } from '../../chat-service/utils/_msgs-related-methods.ts';
import { msgEntityId } from '../../chat-service/utils/sync-versions.ts';
import { serializeDeliveryError } from '../../../utils/delivery-errors.ts';

export async function handleRegularSendingProgress({
  ownAddr,
  sourceDeviceId,
  data,
  db,
  emitEventsOutward,
  nextSyncStamp,
}: {
  ownAddr: string;
  sourceDeviceId: string;
  data: {
    id: string;
    progress: web3n.asmail.DeliveryProgress;
  };
  db: DB;
  emitEventsOutward: ChatSrvEmit;
  nextSyncStamp: () => Promise<number>;
}) {
  emitEventsOutward.common({
    updatedEntityType: 'message',
    event: 'sending-progress',
    data,
  });

  const { id, progress } = data;
  const localMeta = progress.localMeta as LocalMetadataInDelivery;
  const { chatId, chatMessageId: msgId } = localMeta;
  if (!msgId) {
    await removeMsgFromDelivery(id);
    return;
  }

  const chatMessageId: ChatMessageId = { chatId, chatMessageId: msgId };
  const msg = await db.getMessage(chatMessageId);
  if (!msg) {
    await removeMsgFromDelivery(id);
    return;
  }

  const { allDone, recipients } = progress;

  // Phantom of the message itself is sent when the record is placed into a
  // database (see sendRegularMessage in chat-service/utils/msg-sending.ts),
  // not here. This handler only synchronizes a terminal status, below.
  if (!allDone) {
    if (msg.status !== 'sending') {
      await db.updateMessageStatus(chatMessageId, 'sending');
    }
    return;
  }

  if (allDone) {
    const history = msg.history || { changes: [] };
    if (allDone === 'with-errors') {
      const errors = Object.keys(recipients).reduce((res, address) => {
        const { err } = recipients[address];
        if (err) {
          res[address] = serializeDeliveryError(err);
        }
        return res;
      }, {} as ChatMessageHistoryErrors);
      if (Object.keys(errors).length > 0) {
        if (!history.changes) {
          history.changes = [] as ChatMessageHistoryChange[];
        }

        history.changes.push({
          user: ownAddr,
          timestamp: Date.now(),
          type: 'error',
          value: errors,
        });
      }
    }

    const updatedMsg = await db.updateMessageRecord(chatMessageId, {
      status: allDone === 'all-ok' ? 'sent' : 'error',
      history,
    });

    emitEventsOutward.message.updated(updatedMsg);

    await removeMsgFromDelivery(id);

    if (updatedMsg) {
      const syncStamp = await nextSyncStamp();
      await queueSyncPhantom({
        db,
        ownAddr,
        phantom: makeMsgRecordPhantom({ chatId, sourceDeviceId, timestamp: syncStamp, msg: updatedMsg }),
        versions: [
          {
            entityType: 'msg',
            entityId: msgEntityId(chatId, msg.chatMessageId),
            aspect: 'status',
            ts: syncStamp,
            deviceId: sourceDeviceId,
          },
        ],
      });
    }
  }
}
