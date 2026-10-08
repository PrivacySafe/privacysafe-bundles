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
 * Reconciliation sweep for deliveries the platform never finishes.
 *
 * The platform's delivery worker can stall for good: a hung HTTP request has
 * no timeout, so a delivery stays at `allDone` never set and `bytesSent=0`
 * forever (see plans/asmail-load-diagnostic-report-2026-08-10.md and
 * plans/core-platform-recommendations-2026-08-10.md). Two user-visible
 * consequences, both of which this sweep repairs:
 *
 * 1. A chat message whose delivery record never reports `allDone` spins in
 *    'sending' forever (handle-regular-sending-progress.ts only acts on
 *    terminal progress), even though the recipient typically HAS the message
 *    - the platform's fire-and-forget path works while its progress
 *    reporting does not.
 *
 * 2. A stalled `sendImmediately` delivery blocks the platform's ordered
 *    queue of larger messages (attachments) indefinitely: the platform only
 *    releases its `immediateDelivery` slot when the delivery reports done.
 *    `rmMsg(id, true)` (cancelSending) is the one call an app can make that
 *    forces the record into a terminal state and frees the queue.
 *
 * The sweep stays out of live calls' way, like the resync pass does: while a
 * call is in progress, signalling competes for delivery and a burst of
 * cancellations would only add noise.
 */

import type { LocalMetadataInDelivery, ChatMessageHistoryChange } from '../../../types/chat.types.ts';
import type { ChatMessageId } from '../../../types/asmail-msgs.types.ts';
import type { ChatSrvEmit, DB } from '../../types/index.ts';
import {
  makeMsgRecordPhantom,
  notePhantomDeliveryOutcome,
  queueSyncPhantom,
} from '../mail-sending-service/sync-phantoms.ts';
import { msgEntityId } from '../chat-service/utils/sync-versions.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';

const log = makeLogger('DeliveryReconcile');

const SWEEP_INTERVAL_MS = 60_000;

/**
 * A signalling delivery is disposable: its content is stale within seconds,
 * so a couple of minutes without terminal progress means the record is only
 * occupying a queue slot.
 */
const STUCK_WEBRTC_MS = 2 * 60_000;

/**
 * A chat message gets much longer: a genuinely slow delivery (large
 * attachment, bad link) must not be cut off, and the cost of waiting is only
 * a spinner. Applies to every non-webrtc localMeta kind.
 */
const STUCK_MSG_MS = 5 * 60_000;

/**
 * Both webrtc-signal and chat-message delivery ids embed their creation
 * `Date.now()` (see generateSignalDeliveryId and generateOutgoingMsgId), so a
 * record's age survives service restarts. Ids of unknown shape fall back to
 * first-seen tracking within this process.
 */
function creationTsFromDeliveryId(id: string): number | undefined {
  const match = /(?:^|[-_])(\d{13})(?=[-_])/.exec(id);
  if (!match) {
    return undefined;
  }
  const ts = Number(match[1]);
  return Number.isNaN(ts) ? undefined : ts;
}

export function startDeliveryReconcile({
  ownAddr,
  sourceDeviceId,
  db,
  emitEventsOutward,
  nextSyncStamp,
  hasAnyCallInProgress,
}: {
  ownAddr: string;
  sourceDeviceId: string;
  db: DB;
  emitEventsOutward: ChatSrvEmit;
  nextSyncStamp: () => Promise<number>;
  hasAnyCallInProgress: () => boolean;
}): { stop: () => void } {
  const firstSeen = new Map<string, number>();

  async function cancelStuckDelivery(id: string, why: string): Promise<boolean> {
    try {
      // cancelSending=true: without it, rmMsg refuses an incomplete delivery
      // ("sending is not complete") and the record - and the platform's
      // immediate-delivery slot it occupies - stays forever.
      await w3n.mail!.delivery.rmMsg(id, true);
      log.warn(`Cancelled stuck delivery ${id}: ${why}`);
      return true;
    } catch (err) {
      log.error(`Failed to cancel stuck delivery ${id}`, err);
      return false;
    }
  }

  /**
   * The message most likely reached its recipient - fire-and-forget delivery
   * demonstrably works on stands where progress reporting is dead - so the
   * record is marked 'sent', not 'error': an 'error' would prompt the user to
   * re-send and produce duplicates on the receiving side. The unverifiable
   * part is recorded in the message's history instead.
   */
  async function settleStuckChatMessage(
    deliveryId: string, meta: LocalMetadataInDelivery,
  ): Promise<void> {
    const chatMessageId: ChatMessageId = {
      chatId: meta.chatId,
      chatMessageId: meta.chatMessageId!,
    };
    const msg = await db.getMessage(chatMessageId);
    if (!msg || (msg.status !== 'sending')) {
      return;
    }
    const history = msg.history || { changes: [] };
    if (!history.changes) {
      history.changes = [];
    }
    history.changes.push({
      user: ownAddr,
      timestamp: Date.now(),
      type: 'unconfirmed-delivery',
      value: `Delivery ${deliveryId} never reported completion and was cancelled; `
        + `the message was accepted for sending and most likely delivered.`,
    } satisfies ChatMessageHistoryChange);
    const updatedMsg = await db.updateMessageRecord(chatMessageId, {
      status: 'sent',
      history,
    });
    emitEventsOutward.message.updated(updatedMsg);
    if (updatedMsg) {
      // Same status-sync shape as handle-regular-sending-progress.ts: the
      // user's other devices must see this message leave 'sending' too.
      const syncStamp = await nextSyncStamp();
      await queueSyncPhantom({
        db,
        ownAddr,
        phantom: makeMsgRecordPhantom({
          chatId: meta.chatId, sourceDeviceId, timestamp: syncStamp, msg: updatedMsg,
        }),
        versions: [
          {
            entityType: 'msg',
            entityId: msgEntityId(meta.chatId, msg.chatMessageId),
            aspect: 'status',
            ts: syncStamp,
            deviceId: sourceDeviceId,
          },
        ],
      });
    }
  }

  /**
   * Compensation for a sync phantom whose delivery the platform never finished.
   *
   * The counterpart of settleStuckChatMessage, and deliberately different: a chat
   * message has a record the user is looking at, so it is settled optimistically
   * as 'sent'; a phantom has no UI at all, and what matters is that the change it
   * announces reaches the user's other devices. So the journal row is returned to
   * the pool rather than dropped - the same reasoning as everywhere else in this
   * mechanism: a duplicate phantom is free (an equal ordering token loses
   * isNewerToken()), a lost one is permanent.
   */
  async function settleStuckSyncPhantom(deliveryId: string, why: string): Promise<void> {
    const outcome = await notePhantomDeliveryOutcome({
      db,
      ownAddr,
      deliveryId,
      // The cancelled delivery reported nothing, and "nothing" is a failure here:
      // this is what re-arms the row instead of clearing it.
      progress: { allDone: 'with-errors', recipients: {} } as web3n.asmail.DeliveryProgress,
    });
    if (outcome === 'not-ours') {
      // A record left by a previous process: its row, if any, was already released
      // again by the start-up pass, so there is nothing to compensate here.
      log.warn(
        `Stuck sync delivery ${deliveryId} (${why}) belongs to no journal row of this `
          + `process (a restart); cancelled only.`,
      );
      return;
    }
    log.warn(
      `Sync phantom of delivery ${deliveryId} was never confirmed (${why}); `
        + `its journal row is released for another attempt.`,
    );
  }

  async function sweep(): Promise<void> {
    if (hasAnyCallInProgress()) {
      return;
    }
    const now = Date.now();
    const listed = await w3n.mail!.delivery.listMsgs();
    const listedIds = new Set(listed.map(({ id }) => id));
    for (const seenId of firstSeen.keys()) {
      if (!listedIds.has(seenId)) {
        firstSeen.delete(seenId);
      }
    }
    for (const { id, info } of listed) {
      const meta = info.localMeta as LocalMetadataInDelivery | undefined;
      if (info.allDone) {
        // Terminal progress is normally the delivery monitor's business (rmMsg
        // 20s after the allDone event) — but that relies on the monitor
        // RECEIVING the event. A completed webrtc record still listed well past
        // the stuck threshold means the event was missed (service restart,
        // lost IPC event), and nothing else would ever remove it.
        if (meta?.chatMessageType === 'webrtc-call') {
          const bornAt = creationTsFromDeliveryId(id) ?? firstSeen.get(id) ?? now;
          if (!creationTsFromDeliveryId(id) && !firstSeen.has(id)) {
            firstSeen.set(id, now);
          }
          if ((now - bornAt) > STUCK_WEBRTC_MS) {
            try {
              // No cancelSending: the delivery is complete, plain removal.
              await w3n.mail!.delivery.rmMsg(id);
              log.warn(`Removed completed but never cleaned up signal delivery ${id} (allDone=${info.allDone})`);
            } catch (err) {
              log.error(`Failed to remove completed signal delivery ${id}`, err);
            }
          }
        } else if (meta?.chatMessageType === 'synchronization') {
          // A phantom's journal row is cleared by the terminal event, so a
          // completed record still listed here means the monitor never saw that
          // event (a restart, a lost IPC event) - and the row would otherwise stay
          // in flight forever. No age gate: taking the flight makes a race with
          // the monitor a no-op for whoever loses, and unlike a signal record
          // there is no late subscriber to protect.
          const settled = await notePhantomDeliveryOutcome({
            db, ownAddr, deliveryId: id, progress: info,
          });
          if (settled !== 'not-ours') {
            log.warn(
              `Settled sync delivery ${id} from the sweep (allDone=${info.allDone}, `
                + `outcome ${settled}); its terminal event never reached the delivery monitor.`,
            );
          }
          try {
            // No cancelSending: the delivery is complete, plain removal.
            await w3n.mail!.delivery.rmMsg(id);
          } catch (err) {
            log.error(`Failed to remove completed sync delivery ${id}`, err);
          }
        }
        continue;
      }
      let bornAt = creationTsFromDeliveryId(id) ?? firstSeen.get(id);
      if (bornAt === undefined) {
        firstSeen.set(id, now);
        bornAt = now;
      }
      const age = now - bornAt;
      if (meta?.chatMessageType === 'webrtc-call') {
        if (age > STUCK_WEBRTC_MS) {
          await cancelStuckDelivery(id, `webrtc signal without progress for ${Math.round(age / 1000)}s`);
        }
        continue;
      }
      if (age <= STUCK_MSG_MS) {
        continue;
      }
      const cancelled = await cancelStuckDelivery(
        id,
        `'${meta?.chatMessageType ?? 'unknown'}' message without progress for ${Math.round(age / 1000)}s`,
      );
      if (cancelled && (meta?.chatMessageType === 'regular') && meta.chatMessageId) {
        await settleStuckChatMessage(id, meta).catch(err => {
          log.error(`Failed to settle stuck message of delivery ${id}`, err);
        });
      } else if (cancelled && (meta?.chatMessageType === 'synchronization')) {
        // The compensation a phantom needs is the opposite of a chat message's:
        // nothing to show the user, but the change must not be lost, so its
        // journal row goes back into the pool. Re-sending is harmless by
        // construction (an equal ordering token loses isNewerToken() on the
        // receiving device); dropping the row would lose the change for the
        // user's other devices for good.
        await settleStuckSyncPhantom(id, `without progress for ${Math.round(age / 1000)}s`)
          .catch(err => log.error(`Failed to settle stuck sync phantom of delivery ${id}`, err));
      }
    }
  }

  const timer = setInterval(() => {
    sweep().catch(err => log.error(`Delivery reconcile sweep failed`, err));
  }, SWEEP_INTERVAL_MS);

  return {
    stop: () => clearInterval(timer),
  };
}
