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
 * The outgoing half of synchronization: phantoms this device sends to itself so
 * that the user's other devices learn about a change made here.
 *
 * Sending one is two steps, deliberately apart:
 *
 *  - a phantom is *announced* - written into the journal together with the
 *    ordering tokens of the change it announces, in one database operation;
 *  - it is *released* to delivery by a pass over the journal, which clears a row
 *    only once the delivery has actually finished.
 *
 * The reason for the journal is that a change's ordering token is spent the
 * moment the change is applied: if the phantom is then lost - the component is
 * closed, delivery is unavailable, the server refuses - nothing ever re-sends
 * it, and the other devices never learn about the change, because the token is
 * already taken. With the journal, an unreleased phantom is picked up by the
 * next pass, including the one at startup.
 *
 * A factory rather than module-level state, unlike chat.app: everything in this
 * app is already built by factories, a spec then runs without resetting module
 * state between cases, and stop() puts out the retry timer when the mail service
 * detaches - otherwise the process holds a setTimeout for ten minutes after the
 * component is closed.
 */

import {
  PHANTOM_FLIGHT_GRACE_MS,
  PHANTOM_SEND_SPACING_MS,
  RELEASE_RETRY_DELAYS_MS,
} from '../../../shared/constants/sync.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';
import { SingleProc } from '../../../shared/utils/processes/single.ts';
import { sleep } from '../../../shared/utils/processes/sleep.ts';
import { randomIdStr } from '../../../shared/utils/random-id.ts';
import type { DBProvider } from '../../dataset/index.ts';
import {
  MAIL_SYNC_MSG_TYPE,
  type MailSyncEvent,
  type MailSyncEventV2,
  type MailSyncLocalMeta,
  type MailSyncMsg,
  type MailSyncMsgV1,
  type MailSyncMsgV2,
} from '../../types/mail-sync.types.ts';
import type { PendingSyncMsgDbEntry, SyncToken, SyncVersionWrite } from '../../types/sync-types.ts';
import {
  describeDeliveryErrors,
  describeJournalRow,
  flightsToForget,
  isTerminalDeliveryFailure,
  makeFlightRegistry,
  partitionByFlight,
  planJournalRelease,
} from './phantom-flight.ts';
import { syncPassOutcome, type SyncPassOutcome } from './sync-activity.ts';

const log = makeLogger('SyncOutbox');

export interface SyncPhantomReleaseResult {
  /** Phantoms handed to delivery in this pass. */
  handed: number;
  /** Journal rows dropped as superseded by a newer change of the same aspect. */
  superseded: number;
  /** Rows still awaiting release when the pass ended (those in flight excluded). */
  left: number;
  /** Rows inside a delivery, waiting for its outcome. */
  inFlight: number;
  /** The pass stopped because delivery refused a phantom. */
  failed: boolean;
}

export interface SyncOutboxOutcomeSinks {
  /**
   * Where the outcome of a pass over the journal goes - the synchronization
   * indicator, in practice.
   *
   * Reported by the pass itself rather than by whoever started it: passes come
   * from announce(), from the start, and from the retry timer, and a report from
   * only one of those points would leave the indicator frozen on the reading of
   * somebody else's pass.
   */
  pass?: (outcome: SyncPassOutcome) => void;
  /**
   * Where the outcome of one phantom's *delivery* goes. Separate from the pass
   * outcome: the two answer different questions about the same journal.
   */
  delivery?: (outcome: 'delivered' | 'failed') => void;
}

export interface SyncOutbox {
  /**
   * Writes a phantom into the journal together with the versions of the change
   * it announces, and tries to release it right away.
   *
   * The journal row and the versions go in with one database operation, so no
   * file write can catch a spent ordering token without the phantom that is
   * supposed to spend it. Releasing right away keeps the usual case unchanged -
   * the phantom goes out immediately; what changes is the unusual one, where the
   * row simply stays until the next pass.
   */
  announce(args: {
    event: MailSyncEvent;
    /**
     * Versions this change writes. The FIRST one describes the journal row.
     */
    aspects: Array<Omit<SyncVersionWrite, 'ts' | 'deviceId'>>;
    /**
     * How many entities the phantom covers; 1 unless it is a bulk action. Set
     * at the point of announcing rather than inferred from the aspect: the
     * temptation to read "deleted is always bulk" breaks on the first single
     * deletion.
     */
    entityCount?: number;
    /**
     * A ready token - for a change that has already been applied with one (a
     * deletion, see deleteMessagesWithGc). Otherwise a fresh one is taken here.
     *
     * Tokens are taken only inside this method, or handed to it: a stamp taken
     * and not spent is harmless, the clock being monotonic, but such code has to
     * be caught in review.
     */
    token?: SyncToken;
  }): Promise<void>;
  /**
   * Journals one chunk of a restore snapshot.
   *
   * Unlike announce() it writes NO versions: the per-aspect tokens a snapshot
   * carries are the archived ones, and the restore that produced the chunk has
   * already written them.
   *
   * The journal is what a snapshot needs most: a chunk that could not go out
   * because the server was unreachable is picked up by the next pass, including
   * the one after a restart. Without it, the restoring device would be the only
   * one that knows about the restore, and nothing would ever say so again.
   */
  announceSnapshotChunk(args: {
    event: MailSyncEventV2;
    /**
     * A fresh token, taken once for the whole restore: it stamps the phantom's
     * envelope, and the receiver's clock observes it.
     */
    token: SyncToken;
  }): Promise<void>;
  releasePending(): Promise<SyncPhantomReleaseResult>;
  noteDeliveryOutcome(
    deliveryId: string,
    progress: web3n.asmail.DeliveryProgress,
  ): Promise<'delivered' | 'failed' | 'not-ours'>;
  /**
   * Changes recorded on this device that are not on their way yet: journal rows
   * minus the flights still within their grace. The raw count would keep the
   * indicator lit for as long as the platform takes to report an outcome.
   */
  countAwaitingRelease(): number;
  /** Rows inside a delivery right now - diagnostics and specs. */
  countInDelivery(): number;
  setOutcomeSinks(sinks: SyncOutboxOutcomeSinks): void;
  /** Puts out the retry timer; called from the mail service's detach. */
  stop(): void;
}

/**
 * Id of a phantom's delivery.
 *
 * The `sync_` prefix separates the namespace from that of ordinary mail, where
 * sendOutgoingMessage uses the msgId itself as the delivery id. The alphabet is
 * safe for the folder name the platform makes out of a delivery id.
 */
function newPhantomDeliveryId(): string {
  return `sync_${Date.now()}_${randomIdStr(16)}`;
}

export async function makeSyncOutbox(db: DBProvider, ownAddr: string): Promise<SyncOutbox> {
  const flights = makeFlightRegistry();
  const releaseProc = new SingleProc();
  let sinks: SyncOutboxOutcomeSinks = {};

  let retryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let retryStep = 0;
  let stopped = false;

  function reportPassOutcome(outcome: SyncPassOutcome): void {
    try {
      sinks.pass?.(outcome);
    } catch (err) {
      // A reporting failure must not turn into a failure of the pass: the sink
      // is an indicator, and the phantoms are the work.
      log.error(`Sync pass outcome sink threw`, err);
    }
  }

  function reportDeliveryOutcome(outcome: 'delivered' | 'failed'): void {
    try {
      sinks.delivery?.(outcome);
    } catch (err) {
      log.error(`Sync delivery outcome sink threw`, err);
    }
  }

  /**
   * Arms the next pass, unless one is already armed. `backOff` is false for a
   * pass that merely left work behind without failing: a failing server is not
   * helped by insistence, but neither should a successful pass push the next
   * attempt out to ten minutes.
   */
  function scheduleReleaseRetry(backOff: boolean): void {
    if (stopped) {
      return;
    }
    if (backOff) {
      retryStep = Math.min(retryStep + 1, RELEASE_RETRY_DELAYS_MS.length - 1);
    }
    if (retryTimer !== undefined) {
      return;
    }
    retryTimer = setTimeout(
      () => {
        retryTimer = undefined;
        releasePending().catch(err => log.error(
          `Retry pass over the journal of sync phantoms failed`, err,
        ));
      },
      RELEASE_RETRY_DELAYS_MS[retryStep],
    );
  }

  function clearReleaseRetry(): void {
    retryStep = 0;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  function countAwaitingRelease(): number {
    const inFlight = flights.countAwaitingOutcome(Date.now(), PHANTOM_FLIGHT_GRACE_MS);
    return Math.max(db.countPendingSyncPhantoms() - inFlight, 0);
  }

  async function announce({
    event,
    aspects,
    entityCount,
    token,
  }: Parameters<SyncOutbox['announce']>[0]): Promise<void> {
    const describedBy = aspects[0];
    if (!describedBy) {
      throw new Error(`A sync phantom needs at least one aspect version to record`);
    }

    const stamp = token ?? db.nextSyncToken();
    const phantom: MailSyncMsgV1 = {
      v: 1,
      sourceDeviceId: stamp.deviceId,
      timestamp: stamp.ts,
      event,
    };

    await db.queueSyncPhantom(
      {
        entityType: describedBy.entityType,
        entityId: describedBy.entityId,
        aspect: describedBy.aspect,
        entityCount: entityCount ?? 1,
        ts: stamp.ts,
        payload: JSON.stringify(phantom),
      },
      aspects.map(aspect => ({ ...aspect, ts: stamp.ts, deviceId: stamp.deviceId })),
    );

    await releasePending();
  }

  async function announceSnapshotChunk({
    event,
    token,
  }: Parameters<SyncOutbox['announceSnapshotChunk']>[0]): Promise<void> {
    const phantom: MailSyncMsgV2 = {
      v: 2,
      sourceDeviceId: token.deviceId,
      timestamp: token.ts,
      event,
    };

    await db.queueSyncPhantom({
      // `entityId` is unique per part, so no two rows ever share an
      // (entity, aspect) pair and isSupersedable() cannot drop a chunk in favour
      // of a "newer" one. The 'snapshot' aspect is outside SUPERSEDABLE_ASPECTS
      // as well, which says the same thing a second time on purpose - this is a
      // row that must never be dropped unsent.
      entityType: 'restore',
      entityId: `${event.restoreId}#${event.part}`,
      aspect: 'snapshot',
      entityCount: (event.msgs?.length ?? 0) + (event.folders?.length ?? 0),
      ts: token.ts,
      payload: JSON.stringify(phantom),
    });

    await releasePending();
  }

  /**
   * Hands journalled phantoms to delivery.
   *
   * Called after each announcement, at startup - where it picks up whatever the
   * previous run of the component left behind - and by the retry timer.
   *
   * Re-sending a phantom that did in fact arrive is harmless: an incoming
   * phantom with an ordering token this device has already applied loses to the
   * stored one (isNewerToken() is false for an equal token) and is skipped. That
   * is what makes every recovery path here safe to take twice.
   */
  function releasePending(): Promise<SyncPhantomReleaseResult> {
    return releaseProc.startOrChain(async () => {
      // Reported here rather than at each `return` of the pass: there are
      // several of them, and the next one added would silently fall out of the
      // reporting. A throw is an outcome too - the flags must not be left frozen
      // on the reading of some earlier pass.
      try {
        const result = await runReleasePass();
        reportPassOutcome(syncPassOutcome(result));
        return result;
      } catch (err) {
        reportPassOutcome('failed');
        throw err;
      }
    });
  }

  async function runReleasePass(): Promise<SyncPhantomReleaseResult> {
    const dropped = await db.dropExpiredSyncPhantoms(Date.now());
    if (dropped > 0) {
      // At `error`, and deliberately: these are changes that will never reach
      // the user's other devices.
      log.error(
        `Dropped ${dropped} sync phantom(s) older than the synchronization window. `
          + `The changes they announce will not reach other devices of this user.`,
      );
    }

    const queued = db.getPendingSyncPhantoms();

    // Rows leave the journal by paths the flight registry knows nothing about
    // (superseded, aged out, unreadable payload). A flight left behind would keep
    // being subtracted from the count that drives the indicator, so the registry
    // is reconciled with the journal at the head of every pass.
    for (const stale of flightsToForget(flights.current(), new Set(queued.map(({ id }) => id)))) {
      flights.forgetRow(stale.rowId);
    }

    if (queued.length === 0) {
      clearReleaseRetry();
      return { handed: 0, superseded: 0, left: 0, inFlight: 0, failed: false };
    }

    const { release, superseded } = planJournalRelease(queued);
    for (const row of superseded) {
      // A superseded row may be inside a delivery of its own; its outcome is of
      // no interest any more, and the flight must not outlive the row.
      flights.forgetRow(row.id);
      await db.deletePendingSyncPhantom(row.id);
    }
    if (superseded.length > 0) {
      log.info(
        `Dropped ${superseded.length} sync phantom(s) superseded by a newer change of the `
          + `same aspect; ${release.length} left to send.`,
      );
    }

    const now = Date.now();
    const { releasable, waiting, abandoned } = partitionByFlight(
      release, flights.current(), now, PHANTOM_FLIGHT_GRACE_MS,
    );
    for (const flight of abandoned) {
      flights.forgetRow(flight.rowId);
      const attempts = await db.recordPendingSyncPhantomFailure(flight.rowId);
      log.warn(
        `Sync phantom (${flight.describedBy}) handed to delivery ${flight.deliveryId} `
          + `${Math.round((now - flight.handedAt) / 1000)}s ago never reported an outcome; `
          + `releasing it again (attempt ${attempts}).`,
      );
    }

    if (releasable.length === 0) {
      // Everything left is inside a delivery: its outcome will either clear the
      // row or arm a retry, so there is nothing to schedule here.
      return {
        handed: 0,
        superseded: superseded.length,
        left: countAwaitingRelease(),
        inFlight: waiting.length,
        failed: false,
      };
    }

    // Once, and before the first handover: a phantom must not go out ahead of
    // its own local change reaching the disk.
    await db.flush();

    let handed = 0;
    for (const row of releasable) {
      let phantom: MailSyncMsg;
      try {
        phantom = JSON.parse(row.payload) as MailSyncMsg;
      } catch (err) {
        log.error(`Unreadable payload of a queued sync phantom ${row.id}; dropping it.`, err);
        flights.forgetRow(row.id);
        await db.deletePendingSyncPhantom(row.id);
        continue;
      }

      // Spacing goes before every message but the first: the ordinary path - one
      // change, one phantom - must stay as immediate as it was, while a pass over
      // a backlog must not begin dozens of deliveries at once.
      if (handed > 0) {
        await sleep(PHANTOM_SEND_SPACING_MS);
      }

      const deliveryId = newPhantomDeliveryId();
      const localMeta: MailSyncLocalMeta = {
        mailSync: true,
        kind: phantom.event.kind,
        syncJournalRowId: row.id,
      };

      // Registered BEFORE the handover, not after: the terminal event arrives
      // over IPC and can land while addMsg() is still being awaited, and an
      // event that finds no flight is ignored - which would leave the row in the
      // pool while its delivery is alive.
      flights.note({
        rowId: row.id,
        deliveryId,
        handedAt: Date.now(),
        describedBy: describeJournalRow(row),
      });

      try {
        await w3n.mail!.delivery.addMsg(
          [ownAddr],
          { msgType: MAIL_SYNC_MSG_TYPE, jsonBody: phantom } as web3n.asmail.OutgoingMessage,
          deliveryId,
          { sendImmediately: true, localMeta },
        );
        handed += 1;
        log.debug(
          `Handed sync phantom (${describeJournalRow(row)}) to delivery ${deliveryId}; `
            + `journal row ${row.id} stays until the outcome is known.`,
        );
      } catch (err) {
        flights.forgetRow(row.id);
        const attempts = await db.recordPendingSyncPhantomFailure(row.id);
        log.error(
          `Failed to hand a queued sync phantom (${describeJournalRow(row)}) to delivery; `
            + `it stays in the journal (attempt ${attempts}).`,
          err,
        );

        // The pass stops at the first failure instead of walking the rest.
        // Handing a message to delivery fails for one reason in practice - the
        // server cannot be reached - and that reason is the same for every row.
        // Trying them all would make each local change wait out one connection
        // timeout per queued phantom, so an offline device would get slower with
        // every change it makes.
        scheduleReleaseRetry(true);
        return {
          handed,
          superseded: superseded.length,
          left: countAwaitingRelease(),
          inFlight: flights.countAwaitingOutcome(Date.now(), PHANTOM_FLIGHT_GRACE_MS),
          failed: true,
        };
      }
    }

    const left = countAwaitingRelease();
    if (left > 0) {
      // Rows queued while this pass was running: there is work left, and it must
      // not wait for the next local change.
      scheduleReleaseRetry(false);
    } else {
      clearReleaseRetry();
    }

    const inFlight = flights.countAwaitingOutcome(Date.now(), PHANTOM_FLIGHT_GRACE_MS);
    if ((superseded.length > 0) || (left > 0)) {
      log.info(
        `Sync phantom pass: handed ${handed}, ${inFlight} awaiting an outcome, `
          + `${left} awaiting release, ${superseded.length} superseded.`,
      );
    }

    return { handed, superseded: superseded.length, left, inFlight, failed: false };
  }

  /**
   * Settles a journal row by the outcome of the delivery that carried it: the
   * row is cleared when the phantom got through, and returned to the journal for
   * another attempt when it did not.
   */
  async function noteDeliveryOutcome(
    deliveryId: string,
    progress: web3n.asmail.DeliveryProgress,
  ): Promise<'delivered' | 'failed' | 'not-ours'> {
    const flight = flights.takeByDelivery(deliveryId);
    if (!flight) {
      return 'not-ours';
    }

    if (!isTerminalDeliveryFailure(progress)) {
      await db.deletePendingSyncPhantom(flight.rowId);
      log.debug(
        `Sync phantom (${flight.describedBy}) delivered; journal row ${flight.rowId} cleared `
          + `(delivery ${deliveryId}).`,
      );
      reportDeliveryOutcome('delivered');
      return 'delivered';
    }

    const attempts = await db.recordPendingSyncPhantomFailure(flight.rowId);
    if (attempts === 0) {
      // The row is gone - superseded by a newer change of the same aspect while
      // this delivery was on its way. Nothing to retry.
      log.debug(
        `Delivery ${deliveryId} of sync phantom (${flight.describedBy}) failed, but its journal `
          + `row ${flight.rowId} is no longer there; nothing to retry.`,
      );
      return 'failed';
    }

    // At `error`: this is the one line that names a change which did not reach
    // the user's other devices. A phantom has one recipient, so it cannot flood.
    log.error(
      `Sync phantom (${flight.describedBy}) failed delivery ${deliveryId}: `
        + `${describeDeliveryErrors(progress)}. Journal row ${flight.rowId} kept, `
        + `attempt ${attempts}; a retry pass is armed.`,
    );
    // Only on the branch that kept a row: a failure whose row is already gone
    // leaves nothing stuck, and reporting it would tell the user about a change
    // that is no longer waiting for anything.
    reportDeliveryOutcome('failed');
    scheduleReleaseRetry(true);
    return 'failed';
  }

  return {
    announce,
    announceSnapshotChunk,
    releasePending,
    noteDeliveryOutcome,
    countAwaitingRelease,
    countInDelivery: () => flights.count(),
    setOutcomeSinks: next => { sinks = next; },
    stop: () => {
      stopped = true;
      clearReleaseRetry();
    },
  };
}

/** Exported for diagnostics of a journal row - see the startup line. */
export type { PendingSyncMsgDbEntry };
