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
 * Which journalled phantoms are currently inside a delivery, what to do with
 * the outcome when it arrives, and which journal rows a later row has already
 * made pointless.
 *
 * The journal exists so that a change whose phantom never went out is not lost
 * (see sync-outbox.ts). Clearing a row the moment `delivery.addMsg()` accepts
 * the message would end that promise one step too early: addMsg only *queues*
 * it, and when the delivery then fails there would be nothing left to re-send
 * from.
 *
 * Why the registry is kept in memory rather than in a column: "this row is
 * inside a delivery" is only true relative to a live delivery record and a live
 * progress subscription, both of which belong to this process. After a restart
 * the correct action is to send the row again - a phantom whose token the
 * receiving device already applied loses isNewerToken() and is skipped - so a
 * persisted flag would have to be wiped at every start, and a flag whose only
 * correct start-up action is "wipe" is a liability.
 *
 * A leaf module on purpose, and pure: everything here is decided from arguments,
 * so the rules can be pinned down by a table rather than by a live run. The
 * registry maps themselves live inside makeSyncOutbox().
 */

import type { PendingSyncMsgDbEntry, SyncAspect } from '../../types/sync-types.ts';

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
  const scope = (row.entityCount > 1) ? ` (+${row.entityCount - 1} more)` : '';
  return `${row.entityType} ${row.entityId}${scope} / ${row.aspect}`;
}

/**
 * Whether a handed phantom has waited so long that it is treated as never
 * having had an outcome, and released again.
 *
 * Unlike chat.app there is no delivery-reconcile sweep here, so this is the only
 * net under a delivery whose progress event never arrives.
 */
export function isFlightAbandoned(f: PhantomFlight, now: number, graceMillis: number): boolean {
  return (now - f.handedAt) > graceMillis;
}

/**
 * Splits rows a pass is about to release into the ones it may hand over now, the
 * ones already inside a delivery, and the flights that have waited past the
 * grace (whose rows are in `releasable`, and whose registry entries the caller
 * must drop).
 *
 * Filtering out what is already in flight is the whole reason this exists: a
 * pass runs after every local change, and without it each change would re-send
 * everything still awaiting an outcome.
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
 * aspect, aged out of the window, an unreadable payload - and a flight left
 * behind would keep being subtracted from the journal count that drives the
 * synchronization indicator.
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
 * `allDone === 'with-errors'` is the obvious case; the second branch is the one
 * a straightforward reading misses - the platform also reports a per-recipient
 * `err` alongside `allDone: 'all-ok'`, and a phantom has exactly one recipient
 * (this user's own address), so its error is the whole story.
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

/**
 * Aspects whose journal rows may supersede each other.
 *
 * Every one of them is applied by the receiver whole, by applyIfNewer, so
 * sending only the newest of several queued rows loses nothing.
 *
 * 'content' is in, unlike chat.app's 'record': there the exclusion was for the
 * sake of answering a resync request with a record's *original* timestamp, and
 * there is no resync protocol here. What makes it safe is the invariant on
 * SyncedMsgRecord - a record is built from the stored record, never from a
 * partial diff, so a newer row is a superset of an older one. The gain is real:
 * editing a draft stops costing a delivery per save.
 *
 * 'deleted' is out at any entityCount: it is a tombstone.
 */
const SUPERSEDABLE_ASPECTS: ReadonlySet<SyncAspect> = new Set<SyncAspect>([
  'content', 'read', 'placement', 'delivery', 'folderProps',
]);

/**
 * A row may be pushed out by a newer one only if it is about ONE entity and
 * about an aspect the receiver applies whole.
 *
 * entityCount > 1 is excluded for the same reason chat.app excludes tombstones:
 * a journal row is described by the first version written while covering more
 * entities than its own columns name, so a superseded row is not necessarily a
 * subset of the newer one.
 */
export function isSupersedable(row: PendingSyncMsgDbEntry): boolean {
  return (row.entityCount === 1) && SUPERSEDABLE_ASPECTS.has(row.aspect);
}

/**
 * Splits journal rows into the ones worth sending and the ones a later row of
 * the same (entity, aspect) has already made pointless.
 *
 * Pure, and exported for the spec: it decides what does *not* get sent, and that
 * is exactly the kind of rule worth pinning down by a table.
 */
export function planJournalRelease(
  rows: PendingSyncMsgDbEntry[],
): { release: PendingSyncMsgDbEntry[]; superseded: PendingSyncMsgDbEntry[] } {
  const newestOf = new Map<string, PendingSyncMsgDbEntry>();
  for (const row of rows) {
    if (!isSupersedable(row)) {
      continue;
    }
    const key = `${row.entityType}\n${row.entityId}\n${row.aspect}`;
    const seen = newestOf.get(key);
    if (!seen || (row.ts > seen.ts) || ((row.ts === seen.ts) && (row.id > seen.id))) {
      newestOf.set(key, row);
    }
  }

  const release: PendingSyncMsgDbEntry[] = [];
  const superseded: PendingSyncMsgDbEntry[] = [];
  for (const row of rows) {
    const key = `${row.entityType}\n${row.entityId}\n${row.aspect}`;
    const winner = isSupersedable(row) ? newestOf.get(key) : undefined;
    if (winner && (winner.id !== row.id)) {
      superseded.push(row);
    } else {
      release.push(row);
    }
  }

  return { release, superseded };
}

/**
 * The registry of flights. A factory rather than module state: a spec then runs
 * without resetting anything between cases, and makeSyncOutbox() owns one.
 */
export interface FlightRegistry {
  /**
   * Registers a row as handed over. Called *before* addMsg(), not after: the
   * terminal event arrives over IPC and can land while addMsg() is still being
   * awaited, and an event that finds no flight is ignored - which would put the
   * row back into the pool while its delivery is alive.
   */
  note(flight: PhantomFlight): void;
  /**
   * Takes the flight belonging to this delivery, if it is still the current one.
   *
   * Matching on deliveryId is what makes settling idempotent (a repeated
   * terminal event finds nothing) and what keeps a late event of an *earlier*
   * delivery from settling a row that has since been released again.
   */
  takeByDelivery(deliveryId: string): PhantomFlight | undefined;
  forgetRow(rowId: number): PhantomFlight | undefined;
  current(): ReadonlyMap<number, PhantomFlight>;
  /**
   * Flights still within the grace, i.e. rows whose outcome is genuinely being
   * awaited. This is what the synchronization indicator must not count: a row
   * waiting for a confirmation is not work the user can be told about.
   */
  countAwaitingOutcome(now: number, graceMillis: number): number;
  /** Every flight, abandoned or not - diagnostics. */
  count(): number;
}

export function makeFlightRegistry(): FlightRegistry {
  const byRow = new Map<number, PhantomFlight>();
  const byDelivery = new Map<string, number>();

  return {
    note(flight) {
      const previous = byRow.get(flight.rowId);
      if (previous) {
        byDelivery.delete(previous.deliveryId);
      }
      byRow.set(flight.rowId, flight);
      byDelivery.set(flight.deliveryId, flight.rowId);
    },

    takeByDelivery(deliveryId) {
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
    },

    forgetRow(rowId) {
      const flight = byRow.get(rowId);
      if (!flight) {
        return undefined;
      }
      byRow.delete(rowId);
      byDelivery.delete(flight.deliveryId);
      return flight;
    },

    current: () => byRow,

    countAwaitingOutcome(now, graceMillis) {
      let count = 0;
      for (const flight of byRow.values()) {
        if (!isFlightAbandoned(flight, now, graceMillis)) {
          count += 1;
        }
      }
      return count;
    },

    count: () => byRow.size,
  };
}
