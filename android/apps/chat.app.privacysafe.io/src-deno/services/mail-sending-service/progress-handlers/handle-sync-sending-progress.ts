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
import { notePhantomDeliveryOutcome } from '../sync-phantoms.ts';
import type { DB } from '../../../types/index.ts';

/**
 * Terminal outcome of a sync phantom's delivery.
 *
 * A phantom is a change of this device announced to the user's other devices, and
 * this is the only place where it becomes known whether the announcement actually
 * went out. Until it did that, the outcome was thrown away: the handler removed
 * the delivery record on ANY terminal `allDone` - 'with-errors' included - without
 * reading a single per-recipient error and without logging anything, while the
 * journal row had already been cleared at handover. A change lost to a server 500
 * was therefore lost for good and left no trace at all (2026-08-14).
 *
 * Now the row is settled here: cleared when the phantom got through, kept and
 * re-armed when it did not (see notePhantomDeliveryOutcome).
 */
export async function handleSyncSendingProgress({
  data,
  db,
  ownAddr,
}: {
  data: {
    id: string;
    progress: web3n.asmail.DeliveryProgress;
  };
  db: DB;
  ownAddr: string;
}) {
  const { id, progress } = data;

  if (!progress.allDone) {
    return;
  }

  // The delivery record goes regardless of what settling decides - a failure to
  // update the journal must not leak delivery records.
  try {
    await notePhantomDeliveryOutcome({ db, ownAddr, deliveryId: id, progress });
  } finally {
    await removeMsgFromDelivery(id);
  }
}