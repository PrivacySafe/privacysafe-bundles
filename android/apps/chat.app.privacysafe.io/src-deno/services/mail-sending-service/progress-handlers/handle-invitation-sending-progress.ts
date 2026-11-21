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
import { removeMsgFromDelivery } from '../../chat-service/utils/_msgs-related-methods.ts';

/**
 * Handles the progress of sending invitation messages.
 *
 * Sync phantoms for invitation-related events are sent explicitly at the
 * point of the local DB change (chat-creation.ts), not from here - this
 * handler only clears the delivery queue once sending is done.
 */
export async function handleInvitationSendingProgress({
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

  await removeMsgFromDelivery(id);
}
