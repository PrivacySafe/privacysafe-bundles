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
import type { ChatSrv, DB, LocalDataStore, VideoChatSrv } from '../../types/index.ts';
import type { SyncActivityTracker } from '../../utils/sync-activity.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import { inboxDispatcher } from './inbox-dispatcher.ts';
import { deliveryMonitor } from './delivery-monitor.ts';
import { startDeliveryReconcile } from './delivery-reconcile.ts';
import { startupStage } from '../../utils/startup-progress.ts';

/**
 * Mail Service
 * 
 * Coordinator service that combines:
 * - Inbox Dispatcher: handles incoming messages
 * - Delivery Monitor: tracks outgoing message delivery progress
 */
export async function mailService({
  ownAddr,
  db,
  localDataStoreSrv,
  chatsSrv,
  videoChatSrv,
  syncActivity,
  blacklistTracker,
}: {
  ownAddr: string;
  db: DB;
  localDataStoreSrv: LocalDataStore;
  chatsSrv: ChatSrv;
  videoChatSrv: VideoChatSrv;
  syncActivity: SyncActivityTracker;
  blacklistTracker: BlacklistTracker;
}) {
  const appDeviceId = localDataStoreSrv.getAppDeviceId();

  // Each part named and timed separately. This whole service used to be one
  // stage taking anywhere from 15 to 88 seconds, and with a single pair of log
  // lines around all of it there was no way to say which of the three parts
  // the time belonged to (2026-09-11). `startDeliveryReconcile` below gets no
  // stage of its own: it arms a timer and returns, so any time unaccounted for
  // by these stages is between them, not in it.

  // Start inbox dispatcher for handling incoming messages
  const inbox = await startupStage(
    'mail/inbox-dispatcher',
    () => inboxDispatcher({
      ownAddr,
      chatsSrv,
      videoChatSrv,
      localDataStoreSrv,
      db,
      syncActivity,
      blacklistTracker,
    }),
    15000,
  );

  // Start delivery monitor for tracking outgoing message progress
  const delivery = await startupStage(
    'mail/delivery-monitor',
    () => deliveryMonitor({
      ownAddr,
      appDeviceId,
      db,
      chatsSrv,
      nextSyncStamp: () => localDataStoreSrv.nextSyncStamp(),
    }),
    15000,
  );

  // Start the reconcile sweep for deliveries the platform never finishes
  // (stuck 'sending' messages, blocked delivery queue) - see the module doc.
  const reconcile = startDeliveryReconcile({
    ownAddr,
    sourceDeviceId: appDeviceId,
    db,
    emitEventsOutward: chatsSrv.emitEventsOutward,
    nextSyncStamp: () => localDataStoreSrv.nextSyncStamp(),
    hasAnyCallInProgress: () => videoChatSrv.hasAnyCallInProgress(),
  });

  return {
    stopDeliveryService: () => {
      inbox.stop();
      delivery.stop();
      reconcile.stop();
      blacklistTracker.stop();
    },
  };
}