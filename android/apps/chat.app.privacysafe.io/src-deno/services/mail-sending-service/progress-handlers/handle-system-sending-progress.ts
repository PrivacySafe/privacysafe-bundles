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
import type { LocalMetadataInDelivery } from '../../../../types/chat.types.ts';
import { removeMsgFromDelivery } from '../../chat-service/utils/_msgs-related-methods.ts';

/**
 * Handles the progress of sending system messages to peers.
 *
 * Synchronization with the user's own devices is NOT done here. Every
 * state-changing event sends its phantom explicitly, from the point where the
 * change is applied locally (see sendSystemEventSyncMsg() and the other
 * send*SyncMsg() functions in sending-primitives.ts). Doing it from this hook
 * instead made a phantom depend on delivery to peers - nothing was sent when a
 * peer was unreachable or when there were no recipients at all - and stamped it
 * with the moment delivery finished rather than the moment of the change, which
 * breaks last-write-wins ordering outright: a slowly delivered old change would
 * outrank a newer one.
 */
export async function handleSystemSendingProgress({
  data,
}: {
  data: {
    id: string;
    progress: web3n.asmail.DeliveryProgress;
  };
}) {
  const { id, progress } = data;

  if (!progress.allDone) {
    return;
  }

  const localMeta = progress.localMeta as LocalMetadataInDelivery | undefined;
  const event = localMeta?.chatSystemData?.event;

  await w3n.log(
    'info',
    `System message sent: event=${event ?? 'N/A'}, allDone=${progress.allDone}, ` +
      `chatMessageId=${localMeta?.chatMessageId || 'N/A'}`,
  );

  await removeMsgFromDelivery(id);
}
