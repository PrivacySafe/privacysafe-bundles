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
 * Tracker of what synchronization with the user's other devices is doing, so
 * that the GUI can say so instead of leaving the user in front of a mailbox that
 * silently fills up (or doesn't).
 *
 * A leaf module on purpose: the work it watches happens in places that do not
 * know about each other - the mail service routes incoming phantoms, the sync
 * outbox releases outgoing ones - so anything either of them imports must not
 * import them back.
 *
 * The decisions live in pure functions with `now` passed in, and the timers are
 * only a thin shell around them. That is what makes the debouncing testable at
 * all: its whole content is "how long has this state held", and a test that has
 * to wait out real delays measures the test runner, not the rule.
 */

import {
  SYNC_HIDE_DELAY_MS,
  SYNC_MIN_VISIBLE_MS,
  SYNC_SHOW_DELAY_MS,
} from '../../../shared/constants/sync.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';

const log = makeLogger('SyncActivity');

export type SyncPhase = 'idle' | 'catch-up' | 'incoming' | 'outgoing';

export interface SyncActivityView {
  /**
   * Monotonic number of this snapshot. The GUI both subscribes to events and
   * asks for the current value once, and the answer to the ask can arrive after
   * a newer event; comparing seq is what keeps the older one from winning.
   */
  seq: number;
  /** Whether to show the indicator, i.e. after debouncing. */
  syncing: boolean;
  /** Units of work left; 0 when there is nothing to show a count for. */
  pending: number;
  phase: SyncPhase;
  /**
   * There are phantoms to send, but the last pass over the journal failed: the
   * server cannot be reached, rather than this device being busy.
   */
  stalled: boolean;
}

/**
 * How a pass over the journal of outgoing phantoms ended.
 *
 * 'sent' is "the pass ended with no claim to make", not "something went out": a
 * pass that found an empty journal, and one that found every row already inside
 * a delivery, both belong here.
 *
 * chat.app has a third outcome, 'deferred', for a journal held back while a call
 * is on. There are no calls here and nothing to yield to, so that whole layer -
 * and the defect that produced it - is not reproduced.
 */
export type SyncPassOutcome = 'sent' | 'failed';

export function syncPassOutcome(result: { failed: boolean }): SyncPassOutcome {
  return result.failed ? 'failed' : 'sent';
}

/**
 * Counters of work in flight. All of them are counters rather than flags: the
 * catch-up scan can be re-entered, and inbound phantoms are applied one after
 * another while more of them keep arriving.
 */
export interface SyncActivityCounters {
  /** > 0 while a catch-up scan of missed inbox messages is running. */
  catchUpScans: number;
  /** Phantoms queued for handling and not yet processed. */
  inboundQueued: number;
  /** Phantoms currently being applied. */
  inboundApplying: number;
  /** Rows in the journal of outgoing phantoms, minus those inside a delivery. */
  outboundPending: number;
  /** When a non-zero outboundPending last changed; undefined when it is 0. */
  outboundChangedAt: number | undefined;
  /** Whether the last pass over the journal ended in a delivery failure. */
  outboundFailing: boolean;
}

export interface SyncGateParams {
  showDelayMillis: number;
  hideDelayMillis: number;
  minVisibleMillis: number;
}

const DEFAULT_GATE: SyncGateParams = {
  showDelayMillis: SYNC_SHOW_DELAY_MS,
  hideDelayMillis: SYNC_HIDE_DELAY_MS,
  minVisibleMillis: SYNC_MIN_VISIBLE_MS,
};

/** How often the journal length is polled while nothing is going on. */
const IDLE_POLL_MILLIS = 2_000;
/** Same while the indicator is up, doubling as the throttle of count updates. */
const BUSY_POLL_MILLIS = 500;

export function emptyCounters(): SyncActivityCounters {
  return {
    catchUpScans: 0,
    inboundQueued: 0,
    inboundApplying: 0,
    outboundPending: 0,
    outboundChangedAt: undefined,
    outboundFailing: false,
  };
}

/**
 * Whether queued outgoing phantoms count as work in progress.
 *
 * They stop counting the moment a pass reports a failure: a "Synchronizing…"
 * hanging forever over an unreachable server tells the user the opposite of the
 * truth. Unlike chat.app there is no age limit next to this - the failure is
 * reported by the pass itself, which is the accurate signal, and passes here are
 * started from every place that queues a phantom.
 */
export function isOutboundActive(c: SyncActivityCounters): boolean {
  return (c.outboundPending > 0) && !c.outboundFailing;
}

export function isSyncWorkOn(c: SyncActivityCounters): boolean {
  return (c.catchUpScans > 0)
    || (c.inboundQueued > 0)
    || (c.inboundApplying > 0)
    || isOutboundActive(c);
}

/**
 * Units of work left. inboundApplying is deliberately left out: a phantom being
 * applied is still counted in inboundQueued, and adding it would count it twice.
 */
export function pendingUnits(c: SyncActivityCounters): number {
  return c.inboundQueued + (isOutboundActive(c) ? c.outboundPending : 0);
}

/**
 * Which phase to name when several are on at once. Incoming work is named before
 * outgoing because it is the one that changes what the user is looking at; a
 * catch-up scan outranks both, being the reason for the other two.
 */
export function dominantPhase(c: SyncActivityCounters): SyncPhase {
  if (c.catchUpScans > 0) {
    return 'catch-up';
  }
  if ((c.inboundQueued > 0) || (c.inboundApplying > 0)) {
    return 'incoming';
  }
  if (isOutboundActive(c)) {
    return 'outgoing';
  }
  return 'idle';
}

export interface GateState {
  visible: boolean;
  /** When work started while hidden. */
  busySince: number | undefined;
  /** When work stopped while shown. */
  idleSince: number | undefined;
  /** When the indicator was shown. */
  shownAt: number | undefined;
}

export function initialGateState(): GateState {
  return { visible: false, busySince: undefined, idleSince: undefined, shownAt: undefined };
}

/**
 * Advances the show/hide gate, returning the next state and the moment at which
 * it must be advanced again (undefined when nothing is pending).
 *
 * Returning `wakeAt` rather than arming a timer inside is what keeps this pure:
 * the shell arms setTimeout, and specs step time by hand.
 */
export function stepGate(
  s: GateState,
  busy: boolean,
  now: number,
  p: SyncGateParams,
): { state: GateState; wakeAt: number | undefined } {
  if (busy) {
    if (s.visible) {
      return { state: { ...s, idleSince: undefined }, wakeAt: undefined };
    }
    const busySince = s.busySince ?? now;
    if ((now - busySince) >= p.showDelayMillis) {
      return {
        state: { visible: true, busySince: undefined, idleSince: undefined, shownAt: now },
        wakeAt: undefined,
      };
    }
    return { state: { ...s, busySince }, wakeAt: busySince + p.showDelayMillis };
  }

  if (!s.visible) {
    return { state: { ...s, busySince: undefined }, wakeAt: undefined };
  }

  const idleSince = s.idleSince ?? now;
  const hideAt = Math.max(
    idleSince + p.hideDelayMillis,
    (s.shownAt ?? idleSince) + p.minVisibleMillis,
  );
  if (now >= hideAt) {
    return { state: initialGateState(), wakeAt: undefined };
  }
  return { state: { ...s, idleSince }, wakeAt: hideAt };
}

/**
 * What the GUI is told when there is nothing to tell it - a user with a single
 * device, in practice.
 *
 * The sequence number goes on rising through it: it is what keeps the GUI from
 * applying a stale snapshot over a newer event, and a gap in it would break that
 * ordering the moment the silence ends.
 */
export function idleViewOf(seq: number): SyncActivityView {
  return { seq, syncing: false, pending: 0, phase: 'idle', stalled: false };
}

export function viewOf(
  c: SyncActivityCounters,
  gate: GateState,
  seq: number,
): SyncActivityView {
  return {
    seq,
    syncing: gate.visible,
    pending: pendingUnits(c),
    phase: gate.visible ? dominantPhase(c) : 'idle',
    stalled: (c.outboundPending > 0) && !isOutboundActive(c),
  };
}

export interface SyncActivityTracker {
  beginCatchUpScan(): void;
  endCatchUpScan(): void;
  inboundEnqueued(n?: number): void;
  inboundDone(n?: number): void;
  beginApplyingInbound(): void;
  endApplyingInbound(): void;
  /** Result of a pass over the journal of outgoing phantoms. */
  noteOutboundPass(outcome: SyncPassOutcome): void;
  /** Terminal outcome of one phantom's delivery. */
  noteOutboundDeliveryOutcome(outcome: 'delivered' | 'failed'): void;
  /** Current snapshot, for the request-reply getter the GUI starts with. */
  snapshot(): SyncActivityView;
  onChange(cb: (view: SyncActivityView) => void): () => void;
  stop(): void;
}

export function makeSyncActivityTracker({
  countOutboundPending,
  isReportable,
  gate: gateParams,
  now: nowFn,
}: {
  countOutboundPending: () => number;
  /**
   * Whether there is anybody to synchronize with, i.e. whether this device has
   * ever seen a phantom from another device of this user. While it says no,
   * nothing is reported to the GUI at all: a user with a single device has no
   * synchronization to be told about, and the phantoms in their inbox are their
   * own copies coming back.
   *
   * Counters are kept all the same, so the moment this turns true the indicator
   * shows the real state without waiting for a restart.
   */
  isReportable?: () => boolean;
  gate?: Partial<SyncGateParams>;
  now?: () => number;
}): SyncActivityTracker {
  const params: SyncGateParams = { ...DEFAULT_GATE, ...gateParams };
  const now = nowFn ?? (() => Date.now());
  const counters = emptyCounters();
  const observers = new Set<(view: SyncActivityView) => void>();

  let gate = initialGateState();
  let seq = 0;
  let lastEmitted: SyncActivityView | undefined = undefined;
  let lastCountEmittedAt = 0;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined = undefined;
  let currentPollInterval = 0;
  let stopped = false;

  function readOutbound(): void {
    let pending: number;
    try {
      pending = countOutboundPending();
    } catch (err) {
      // The journal lives in the same database as everything else; a read that
      // fails here must not take the tracker - and with it the indicator - down.
      log.error(`Failed to count pending sync phantoms`, err);
      return;
    }
    if (pending === counters.outboundPending) {
      return;
    }
    counters.outboundPending = pending;
    counters.outboundChangedAt = (pending > 0) ? now() : undefined;
    if (pending === 0) {
      counters.outboundFailing = false;
    }
  }

  function currentView(atSeq: number): SyncActivityView {
    return ((isReportable && !isReportable()) ? idleViewOf(atSeq) : viewOf(counters, gate, atSeq));
  }

  /**
   * Emits when the visible state changed, and - no more often than
   * BUSY_POLL_MILLIS - when only the count did. Without that throttle a backlog
   * of a few hundred phantoms would put an extra event on the wire per phantom,
   * on top of the message events it already generates.
   */
  function publish(): void {
    const at = now();
    const view = currentView(seq + 1);
    const visibleChange = !lastEmitted
      || (lastEmitted.syncing !== view.syncing)
      || (lastEmitted.phase !== view.phase)
      || (lastEmitted.stalled !== view.stalled);
    const countChange = !!lastEmitted && (lastEmitted.pending !== view.pending);

    if (!visibleChange && !(countChange && ((at - lastCountEmittedAt) >= BUSY_POLL_MILLIS))) {
      return;
    }

    seq = view.seq;
    lastEmitted = view;
    lastCountEmittedAt = at;
    for (const obs of observers) {
      try {
        obs(view);
      } catch (err) {
        log.error(`Failed to pass sync activity state to an observer`, err);
      }
    }
  }

  function review(): void {
    if (stopped) {
      return;
    }
    const at = now();
    const { state, wakeAt } = stepGate(gate, isSyncWorkOn(counters), at, params);
    gate = state;

    if (wakeTimer !== undefined) {
      clearTimeout(wakeTimer);
      wakeTimer = undefined;
    }
    if (wakeAt !== undefined) {
      wakeTimer = setTimeout(review, Math.max(wakeAt - at, 10));
    }

    publish();
    schedulePolling();
  }

  /**
   * The journal is polled rather than instrumented at its write sites: a phantom
   * that is journalled and handed to delivery within the same tick never shows
   * up in a poll, which is exactly the flicker not worth showing.
   */
  function schedulePolling(): void {
    const wanted = gate.visible ? BUSY_POLL_MILLIS : IDLE_POLL_MILLIS;
    if (pollTimer !== undefined) {
      if (currentPollInterval === wanted) {
        return;
      }
      clearInterval(pollTimer);
    }
    currentPollInterval = wanted;
    pollTimer = setInterval(() => {
      try {
        readOutbound();
        review();
      } catch (err) {
        log.error('Poll of the sync activity tracker threw', err);
      }
    }, wanted);
  }

  function changed(update: () => void): void {
    update();
    review();
  }

  readOutbound();
  schedulePolling();

  return {
    beginCatchUpScan: () => changed(() => { counters.catchUpScans += 1; }),
    endCatchUpScan: () => changed(() => {
      counters.catchUpScans = Math.max(counters.catchUpScans - 1, 0);
    }),
    inboundEnqueued: (n = 1) => changed(() => { counters.inboundQueued += n; }),
    inboundDone: (n = 1) => changed(() => {
      counters.inboundQueued = Math.max(counters.inboundQueued - n, 0);
    }),
    beginApplyingInbound: () => changed(() => { counters.inboundApplying += 1; }),
    endApplyingInbound: () => changed(() => {
      counters.inboundApplying = Math.max(counters.inboundApplying - 1, 0);
    }),
    noteOutboundPass: outcome => changed(() => {
      counters.outboundFailing = (outcome === 'failed');
      readOutbound();
    }),
    noteOutboundDeliveryOutcome: outcome => changed(() => {
      counters.outboundFailing = (outcome === 'failed');
      readOutbound();
    }),

    snapshot: () => currentView(seq),

    onChange: cb => {
      observers.add(cb);
      return () => observers.delete(cb);
    },

    stop: () => {
      stopped = true;
      if (wakeTimer !== undefined) {
        clearTimeout(wakeTimer);
        wakeTimer = undefined;
      }
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      observers.clear();
    },
  };
}
