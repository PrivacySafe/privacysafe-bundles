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
 * Which journalled sync phantoms are currently inside a delivery, and what to do
 * with the outcome when it arrives.
 *
 * The journal exists so that a change whose phantom never went out is not lost
 * (see sync-phantoms.ts). Until this registry, that promise ended one step too
 * early: the row was cleared the moment `delivery.addMsg()` accepted the
 * message, and `addMsg` only *queues* it. When the delivery then failed - the
 * server answering 500, which this server does in bursts - nothing was left to
 * re-send from, no line was logged, and the change was gone from the user's
 * other devices for good. That is how a record of an answered incoming call
 * failed to appear on the user's other device in the live run of 2026-08-14.
 *
 * Why the registry is in memory rather than a column in the journal: "this row
 * is inside a delivery" is only true relative to a live delivery record and a
 * live progress subscription, both of which belong to this process. After a
 * restart the correct action is to send the row again (a phantom whose token the
 * receiving device already applied loses isNewerToken() and is skipped), so a
 * persisted flag would have to be wiped at every start - and a flag whose only
 * correct start-up action is "wipe" is a liability: forget the wipe and the row
 * is never released again, which is the same silent loss, made durable.
 *
 * A leaf module on purpose: the delivery monitor, the reconcile sweep and the
 * release pass all need it, and it must not pull any of them in.
 */

import { makeLogger } from '../../../shared-libs/logger.ts';
import type { PendingSyncMsgDbEntry } from '../../types/index.ts';

const log = makeLogger('PhantomFlight');

/** A journal row handed to delivery, waiting for the delivery's outcome. */
export interface PhantomFlight {
  rowId: number;
  deliveryId: string;
  handedAt: number;
  /**
   * How to name the change in a log line, kept here because the row may be gone
   * by the time the outcome is logged.
   */
  describedBy: string;
}

export function describeJournalRow(row: PendingSyncMsgDbEntry): string {
  return `${row.entityType} ${row.entityId} / ${row.aspect}`;
}

/**
 * Whether a handed phantom has waited so long that it is treated as never
 * having had an outcome, and released again.
 *
 * This is the second net, not the first: the reconcile sweep already cancels a
 * delivery without progress after STUCK_MSG_MS and hands the row back
 * (delivery-reconcile.ts). The grace is set above that window on purpose, so
 * that in the ordinary "the terminal event never reached the monitor" case the
 * sweep acts and this never fires. What is left for it are the cases the sweep
 * cannot reach: a call that never ends (the sweep steps aside while one is on),
 * a delivery record that listMsgs() does not show, a dead subscription.
 */
export function isFlightAbandoned(f: PhantomFlight, now: number, graceMillis: number): boolean {
  return (now - f.handedAt) > graceMillis;
}

/**
 * Splits rows a pass is about to release into the ones it may hand over now, the
 * ones already inside a delivery, and the flights that have waited past the
 * grace (whose rows are in `releasable` and whose registry entries the caller
 * must drop).
 *
 * Filtering out what is already in flight is the whole reason this is a
 * function: a pass runs after every local change, and without it each change
 * would re-send everything still awaiting an outcome.
 */
export function partitionByFlight(
  rows: PendingSyncMsgDbEntry[],
  flights: ReadonlyMap<number, PhantomFlight>,
  now: number,
  graceMillis: number,
): {
  releasable: PendingSyncMsgDbEntry[];
  waiting: PendingSyncMsgDbEntry[];
  abandoned: PhantomFlight[];
} {
  const releasable: PendingSyncMsgDbEntry[] = [];
  const waiting: PendingSyncMsgDbEntry[] = [];
  const abandoned: PhantomFlight[] = [];

  for (const row of rows) {
    const flight = flights.get(row.id);
    if (!flight) {
      releasable.push(row);
    } else if (isFlightAbandoned(flight, now, graceMillis)) {
      abandoned.push(flight);
      releasable.push(row);
    } else {
      waiting.push(row);
    }
  }

  return { releasable, waiting, abandoned };
}

/**
 * Flights whose journal row is no longer there. A row leaves by paths this
 * registry knows nothing about - superseded by a newer change of the same
 * aspect, aged out of the synchronization window, an unreadable payload - and a
 * flight left behind would keep being subtracted from the journal count that
 * drives the synchronization indicator.
 */
export function flightsToForget(
  flights: ReadonlyMap<number, PhantomFlight>,
  journalRowIds: ReadonlySet<number>,
): PhantomFlight[] {
  const stale: PhantomFlight[] = [];
  for (const flight of flights.values()) {
    if (!journalRowIds.has(flight.rowId)) {
      stale.push(flight);
    }
  }
  return stale;
}

/**
 * Whether a terminal delivery progress says the message did not get through.
 *
 * `allDone === 'with-errors'` is the obvious case; the other one is what the old
 * handler missed entirely - the platform also reports a per-recipient `err`
 * alongside `allDone: 'all-ok'`, and a phantom has exactly one recipient (this
 * user's own address), so its error is the whole story.
 */
export function isTerminalDeliveryFailure(progress: web3n.asmail.DeliveryProgress): boolean {
  if (progress.allDone === 'with-errors') {
    return true;
  }
  return Object.values(progress.recipients ?? {}).some(r => !!r.err);
}

export function describeDeliveryErrors(progress: web3n.asmail.DeliveryProgress): string {
  const errs = Object.entries(progress.recipients ?? {})
    .filter(([, r]) => r.err)
    .map(([addr, r]) => `${addr}: ${JSON.stringify(r.err)}`)
    .join('; ');
  return errs || 'no per-recipient error recorded';
}

// =============================================================================
// The registry itself
// =============================================================================

const byRow = new Map<number, PhantomFlight>();
const byDelivery = new Map<string, number>();

/**
 * Registers a row as handed over. Called *before* addMsg(), not after: the
 * terminal event arrives over IPC and can land while the addMsg() call is still
 * being awaited, and an event that finds no flight is ignored - which would put
 * the row back into the pool while its delivery is alive.
 */
export function notePhantomHandedToDelivery(flight: PhantomFlight): void {
  const previous = byRow.get(flight.rowId);
  if (previous) {
    byDelivery.delete(previous.deliveryId);
  }
  byRow.set(flight.rowId, flight);
  byDelivery.set(flight.deliveryId, flight.rowId);
}

/**
 * Takes the flight belonging to this delivery, if it is still the current one.
 *
 * Matching on deliveryId is what makes settling idempotent (a repeated terminal
 * event finds nothing) and what keeps a late event of an *earlier* delivery from
 * settling a row that has since been released again under a new delivery id.
 */
export function takeFlightOfDelivery(deliveryId: string): PhantomFlight | undefined {
  const rowId = byDelivery.get(deliveryId);
  if (rowId === undefined) {
    return undefined;
  }
  byDelivery.delete(deliveryId);
  const flight = byRow.get(rowId);
  if (flight?.deliveryId !== deliveryId) {
    return undefined;
  }
  byRow.delete(rowId);
  return flight;
}

export function forgetFlightOfRow(rowId: number): PhantomFlight | undefined {
  const flight = byRow.get(rowId);
  if (!flight) {
    return undefined;
  }
  byRow.delete(rowId);
  byDelivery.delete(flight.deliveryId);
  return flight;
}

export function currentFlights(): ReadonlyMap<number, PhantomFlight> {
  return byRow;
}

/**
 * Flights still within the grace, i.e. rows whose outcome is genuinely being
 * awaited. This is what the synchronization indicator must not count: a row
 * waiting for a confirmation is not work the user can be told about, and
 * counting it would light the indicator for as long as the platform takes to
 * report (tens of seconds, sometimes never).
 */
export function countFlightsAwaitingOutcome(now: number, graceMillis: number): number {
  let count = 0;
  for (const flight of byRow.values()) {
    if (!isFlightAbandoned(flight, now, graceMillis)) {
      count += 1;
    }
  }
  return count;
}

/** Every flight, abandoned or not - for diagnostics. */
export function countFlights(): number {
  return byRow.size;
}

export function clearAllFlights(): void {
  if (byRow.size > 0) {
    log.debug(`Forgetting ${byRow.size} phantom flight(s)`);
  }
  byRow.clear();
  byDelivery.clear();
}
