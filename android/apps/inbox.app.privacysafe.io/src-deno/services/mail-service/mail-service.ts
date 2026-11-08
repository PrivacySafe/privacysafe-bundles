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
import {
  CATCH_UP_FETCH_WINDOW,
  CATCH_UP_REWIND_MS,
  INBOX_SCAN_FLOOR_MS,
} from '../../../shared/constants/sync.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';
import { NamedProcs } from '../../../shared/utils/processes/named-procs.ts';
import { SingleProc } from '../../../shared/utils/processes/single.ts';
import type { DBProvider } from '../../dataset/index.ts';
import { MAIL_SYNC_MSG_TYPE } from '../../types/mail-sync.types.ts';
import type { InboxEmit } from '../inbox-service/events.ts';
import { handleDeliveryProgress, isMailSyncDelivery } from '../inbox-service/utils/send.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import type { SyncActivityTracker } from '../sync/sync-activity.ts';
import type { SyncOutbox } from '../sync/sync-outbox.ts';
import { routeIncomingMsg, type IncomingRouterCtx } from './route-incoming.ts';
import { makeFailureFloor, makeWatermarkCommitter } from './watermark.ts';

const log = makeLogger('InboxMail');

export interface MailServiceDeps {
  db: DBProvider;
  emit: InboxEmit;
  /** Where a phantom's delivery outcome goes. */
  sync: SyncOutbox;
  /** Stores an ordinary mail message; also drains phantoms buffered for it. */
  persistMail: IncomingRouterCtx['persistMail'];
  /** The receiving tract of synchronization. */
  handleSync: IncomingRouterCtx['handleSync'];
  /** This user's own address, to tell their own phantoms from other senders. */
  ownAddr: string;
  /** Who the user has blocked; mail from them is dropped, never stored. */
  blacklist: BlacklistTracker;
  activity?: SyncActivityTracker;
}

export interface MailService {
  /** Detaches the subscriptions and puts out the outbox's retry timer. */
  stop(): void;
  /**
   * Replays what the inbox holds since the watermark.
   *
   * Callable, and not only run at startup, because a restore resets the
   * watermark to 0 and marks the messages it saw during the restore as
   * unhandled: without a pass right after it, the mailbox would only come back
   * in full at the next start of the component.
   */
  catchUp(): Promise<void>;
}

export async function mailService({
  db,
  emit,
  sync,
  persistMail,
  handleSync,
  ownAddr,
  blacklist,
  activity,
}: MailServiceDeps): Promise<MailService> {
  const process = new NamedProcs();
  /**
   * One catch-up pass at a time.
   *
   * A pass used to happen once, at startup, so nothing could overlap it. It is
   * callable now - a restore asks for one - and two passes over the same inbox
   * would race each other over every message in it.
   */
  const catchUpProc = new SingleProc();
  const failureFloor = makeFailureFloor();
  const watermark = makeWatermarkCommitter(db, emit, failureFloor);

  /**
   * Guards against handling one inbox message twice - which a message arriving
   * around the start can be, being seen both by the live subscription and by the
   * catch-up scan.
   *
   * Idempotency is not the whole of it: observeSyncStamp must not observe one
   * stamp twice, and scheduleInboxMsgRemoval must not be handed a second
   * scheduling (it is INSERT OR IGNORE, but relying on that in two places is not
   * a reason to have two).
   */
  const seenMsgIds = new Set<string>();

  /**
   * Takes mail from a blocked sender off the server.
   *
   * Immediate, not deferred, and that is this app's own rule rather than a
   * decision made here: an ordinary message leaves the server at once, only
   * phantoms wait (see doc/multi-device-sync.md). Nothing is lost for the user's
   * other devices - they read the same blacklist and would drop it too.
   */
  async function dropFromInbox(msgId: string): Promise<void> {
    try {
      await w3n.mail!.inbox.removeMsg(msgId);
    } catch (err) {
      const exc = err as web3n.asmail.InboxException | undefined;
      if (exc?.msgNotFound) {
        return;
      }
      // The server could not be reached. Due at once, so the next maintenance
      // pass and the next start take it on - the same net that ordinary removal
      // failures already fall into.
      log.warn(`Could not remove blocked message ${msgId}; scheduling a retry.`, err);
      await db.scheduleInboxMsgRemoval(msgId, false, 0);
    }
  }

  const routerCtx = (notify: boolean): IncomingRouterCtx => ({
    persistMail,
    handleSync,
    notify,
    ownAddr,
    isBlockedSender: addr => blacklist.isBlacklisted(addr),
    isAlreadyStored: msgId => !!db.getMessageById(msgId),
    dropFromInbox,
  });

  async function handleOne(
    msg: web3n.asmail.IncomingMessage,
    opts: { notify: boolean },
  ): Promise<void> {
    // A restore rewrites what receiving mail writes, so instead of a lock of its
    // own it uses the mechanism that is already here: the message counts as NOT
    // handled, the watermark therefore does not advance, and the id is not marked
    // as seen - so the catch-up pass that follows the restore takes it on again.
    if (db.isRestoreInProgress()) {
      failureFloor.recordFailure(msg.deliveryTS);
      log.debug(
        `Leaving incoming message ${msg.msgId} to the pass after the restore that is running.`,
      );
      return;
    }

    if (seenMsgIds.has(msg.msgId)) {
      return;
    }
    seenMsgIds.add(msg.msgId);

    try {
      const handled = await routeIncomingMsg(msg, routerCtx(opts.notify));
      if (handled) {
        watermark.recordProcessed(msg.deliveryTS);
      } else {
        failureFloor.recordFailure(msg.deliveryTS);
      }
    } catch (err) {
      // The watermark must not go past a message that threw, or the next scan
      // will never list it again.
      failureFloor.recordFailure(msg.deliveryTS);
      // Handled once means handled: leaving it in `seenMsgIds` keeps a live
      // message and the scan from both taking a failing message on.
      log.error(`Handling incoming message ${msg.msgId} threw`, err);
    }

    if (watermark.isBatchFull()) {
      await watermark.commit().catch(err => log.warn(`Batch commit of the watermark failed`, err));
    }
  }

  // The subscription goes on BEFORE the catch-up scan. The other way round, a
  // message that arrives while the scan is running is lost until the next start.
  const unsubInbox = w3n.mail?.inbox.subscribe('message', {
    next: msg => {
      process
        .startOrChain(msg.msgId, () => handleOne(msg, { notify: true }))
        .then(() => watermark.commit())
        .catch(err => log.error(`Failed to handle incoming ${msg.msgId}`, err));
    },
    error: (err: unknown) => {
      log.error('Error in the operation of the receiving service.', err);
    },
    complete: () => {
      log.info('The receiving service has finished.');
    },
  });

  /**
   * Replays what the inbox holds since the watermark.
   *
   * The listing starts CATCH_UP_REWIND_MS before it, because the commit is per
   * batch and takes the GREATEST processed deliveryTS: a message with a smaller
   * one that was not processed - for any reason - would otherwise be jumped
   * over.
   */
  async function catchUp(): Promise<void> {
    activity?.beginCatchUpScan();
    try {
      const watermarkTs = db.getAppState().lastReceivingTimestamp || 0;
      // Floored, not clamped at zero: a zero fromTS is what makes the platform's
      // inbox index throw instead of listing. See INBOX_SCAN_FLOOR_MS.
      const scanFrom = Math.max(watermarkTs - CATCH_UP_REWIND_MS, INBOX_SCAN_FLOOR_MS);
      const listed = await w3n.mail?.inbox.listMsgs(scanFrom).catch(err => {
        const exc = err as web3n.files.FileException;
        if ((exc?.type === 'file') && exc.notFound) {
          log.error(
            `The platform's inbox index is broken: it looks for a shard file `
              + `${exc.path} that does not exist. Only live messages will be handled until `
              + `the platform is updated.`,
            err,
          );
        } else {
          log.error(`Failed to list the inbox from ${scanFrom}`, err);
        }
        return undefined;
      });

      if (!listed) {
        log.info(
          `Catch-up got no listing (watermark ${watermarkTs}); only live messages will `
            + `be handled.`,
        );
        return;
      }

      const thisDeviceId = db.getAppDeviceId();
      let mail = 0;
      let phantoms = 0;
      let ownPhantoms = 0;
      let alreadySeen = 0;
      let failed = 0;

      const toFetch: web3n.asmail.MsgInfo[] = [];
      for (const item of listed) {
        if (item.msgType === 'mail') {
          mail += 1;
        } else if (item.msgType === MAIL_SYNC_MSG_TYPE) {
          phantoms += 1;
        } else {
          // Another app's traffic: not fetched, and its body not read.
          continue;
        }

        // Skipped BEFORE the fetch, and this is not only about saving a network
        // call. A pass can now run while the live subscription is working - the
        // one after a restore does (see MailService.catchUp) - and two concurrent
        // getMsg calls for one message make the platform's own inbox cache throw
        // EEXIST over the file it is writing. handleOne() would have skipped the
        // message anyway.
        if (seenMsgIds.has(item.msgId)) {
          alreadySeen += 1;
          continue;
        }

        toFetch.push(item);
      }

      // Fetched a window at a time, applied one at a time. The round trip to the
      // server is what a scan over a backlog spends its time on, so the fetches
      // overlap; the ORDER of application stays the order of the listing, which
      // is what the sync tract resolves competing phantoms by. See
      // CATCH_UP_FETCH_WINDOW.
      const fetched: Promise<{ msg?: web3n.asmail.IncomingMessage; err?: unknown }>[] = [];
      const startFetch = (index: number): void => {
        if (index >= toFetch.length) {
          return;
        }
        const { msgId } = toFetch[index];
        // Still INSIDE the per-message proc: the live subscription hands its
        // messages to the same one, so this message is not being fetched twice at
        // once. Different messages are free to be in flight together.
        // The rejection is turned into a value here rather than awaited later:
        // a fetch that fails while its turn is still a window away would
        // otherwise go unhandled.
        fetched.push(
          process
            .startOrChain(msgId, async () => w3n.mail?.inbox.getMsg(msgId))
            .then(
              msg => ({ msg: msg ?? undefined }),
              err => ({ err: err ?? new Error(`getMsg(${msgId}) failed`) }),
            ),
        );
      };

      for (let i = 0; i < Math.min(CATCH_UP_FETCH_WINDOW, toFetch.length); i += 1) {
        startFetch(i);
      }

      // Where a long scan's time actually goes, told apart rather than guessed
      // at: waiting for a fetch that the window did not cover in time, against
      // applying what came back.
      let fetchWaitMs = 0;
      let applyMs = 0;

      for (let i = 0; i < toFetch.length; i += 1) {
        const item = toFetch[i];
        const waitedFrom = Date.now();
        const { msg, err } = await fetched[i];
        fetchWaitMs += Date.now() - waitedFrom;
        // Kept full while this one is applied.
        startFetch(i + CATCH_UP_FETCH_WINDOW);

        if (err) {
          failed += 1;
          failureFloor.recordFailure(item.deliveryTS);
          log.error(`Failed to catch up message ${item.msgId}`, err);
          continue;
        }
        if (!msg) {
          // An unavailable message has to be seen by the next scan too, so the
          // watermark is not allowed past it.
          failed += 1;
          failureFloor.recordFailure(item.deliveryTS);
          log.error(`getMsg(${item.msgId}) returned nothing (deliveryTS ${item.deliveryTS})`);
          continue;
        }
        if (
          (item.msgType === MAIL_SYNC_MSG_TYPE)
          && ((msg as { jsonBody?: { sourceDeviceId?: string } }).jsonBody?.sourceDeviceId
            === thisDeviceId)
        ) {
          ownPhantoms += 1;
        }

        const appliedFrom = Date.now();
        try {
          await process.startOrChain(item.msgId, () => handleOne(msg, { notify: false }));
        } catch (err) {
          failed += 1;
          failureFloor.recordFailure(item.deliveryTS);
          log.error(`Failed to catch up message ${item.msgId}`, err);
        }
        applyMs += Date.now() - appliedFrom;
      }

      await watermark.commit().catch(err => log.error(`Final watermark commit failed`, err));

      // "N sync (N of them from this device)" on TWO devices at once is the only
      // outward sign that both copies are reading one data folder - which looks
      // exactly like broken synchronization and nothing else in the logs
      // contradicts it.
      log.info(
        `Catch-up: watermark ${watermarkTs}, listed ${listed.length} since ${scanFrom}, `
          + `${mail} mail, ${phantoms} sync (${ownPhantoms} of them from this device `
          + `${thisDeviceId}), ${alreadySeen} handled earlier this session, ${failed} failed; `
          + `waited ${fetchWaitMs}ms on fetches, spent ${applyMs}ms applying`,
      );
    } finally {
      activity?.endCatchUpScan();
    }
  }

  await catchUp();

  const routeDelivery = (id: string, progress: web3n.asmail.DeliveryProgress) =>
    (isMailSyncDelivery(progress)
      ? sync.noteDeliveryOutcome(id, progress).then(() => {})
      : handleDeliveryProgress(db, emit, id, progress, sync));

  const sendingList = await w3n.mail?.delivery.listMsgs();
  for (const item of sendingList || []) {
    if (!item.info?.localMeta?.chatId) {
      await routeDelivery(item.id, item.info);
    }
  }

  const unsubDelivery = w3n.mail?.delivery.observeAllDeliveries({
    next: ({ id, progress }) => {
      process
        .startOrChain(id, () => routeDelivery(id, progress))
        .catch(err => log.error(`Failed to handle delivery ${id}`, err));
    },
    error: (err: unknown) => {
      log.error('Error while the message send.', err);
    },
  });

  log.info('mail service started');

  return {
    stop: () => {
      unsubInbox?.();
      unsubDelivery?.();
      sync.stop();
    },
    // Serialized, and the set of ids handled this session is deliberately NOT
    // cleared. A restore rolls the watermark back to 0 so that the pass covers
    // the WHOLE inbox, but a message this session already handled needs nothing
    // done to it: its record is in the database, and neither mode of a restore
    // rewrites the content of an incoming record that is there. Clearing the set
    // would make the pass re-fetch every message of the mailbox - minutes of
    // network for no change - and put a second getMsg beside whatever the live
    // subscription happens to be fetching.
    catchUp: () => catchUpProc.startOrChain(() => catchUp()),
  };
}
