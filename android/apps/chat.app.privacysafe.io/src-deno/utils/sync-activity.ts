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
 * that the GUI can say so instead of leaving the user in front of a chat that
 * silently fills up (or doesn't).
 *
 * This is a leaf module on purpose: the work it watches happens in two services
 * that don't know about each other - the inbox dispatcher (mail-service) hands
 * phantoms over, the chat service applies them - so anything either of them
 * imports must not import them back.
 *
 * The decisions live in pure functions with `now` passed in, and the timers are
 * only a thin shell around them. That is what makes the debouncing testable at
 * all: its whole content is "how long has this state held", and a test that has
 * to wait out real delays to check it measures the test runner, not the rule.
 */

import { makeLogger } from '../../shared-libs/logger.ts';
import type { SyncActivityView, SyncPhase } from '../../types/services.types.ts';

const log = makeLogger('SyncActivity');

/**
 * Counters of work in flight. All of them are counters rather than flags: the
 * catch-up scan can be re-entered, and inbound phantoms are applied one after
 * another while more of them keep arriving.
 */
export interface SyncActivityCounters {
  /** > 0 while a catch-up scan of missed inbox messages is running. */
  catchUpScans: number;
  /** Sync phantoms handed to the dispatcher's queue and not yet processed. */
  inboundQueued: number;
  /** Phantoms currently inside handleIncomingSync(). */
  inboundApplying: number;
  /** Rows in the journal of outgoing phantoms. */
  outboundPending: number;
  /** When a non-zero outboundPending last changed; undefined when it is 0. */
  outboundChangedAt: number | undefined;
  /** Whether the last pass over the journal ended in a delivery failure. */
  outboundFailing: boolean;
  /**
   * Whether the queued phantoms are deliberately held back - a call is on, and
   * signalling comes first (see setPhantomReleaseBusyCheck in sync-phantoms.ts).
   *
   * Held work is not work in progress and not work that is stuck: it is work
   * waiting on purpose, and the user has nothing to be told about it. Without
   * this distinction every call put a "Synchronizing…" line and a progress bar in
   * front of the user - including users with a single device, who have nobody to
   * synchronize with (2026-08-14).
   */
  outboundHeld: boolean;
}

/**
 * How a pass over the journal of outgoing phantoms ended: the phantoms went out,
 * delivery refused them, or they are held back until a call ends.
 */
export type SyncPassOutcome = 'sent' | 'failed' | 'deferred';

/**
 * How a pass's result reads to the indicator.
 *
 * 'sent' is "the pass ended with no claim to make", not "something went out": a
 * pass that found an empty journal, and one that found every row already inside
 * a delivery, both belong here - nothing is held and nothing is broken.
 *
 * `deferred` wins over `failed` because the two say different things about the
 * same pass and only one of them is the user's business: a pass held back by a
 * call never got as far as trying, so reading it as a failure would put "cannot
 * synchronize" in front of a user whose device is perfectly fine.
 */
export function syncPassOutcome(
  result: { failed: boolean; deferred: boolean },
): SyncPassOutcome {
  if (result.deferred) {
    return 'deferred';
  }
  if (result.failed) {
    return 'failed';
  }
  return 'sent';
}

export interface SyncGateParams {
  /** How long work must hold before the indicator is shown. */
  showDelayMillis: number;
  /** How long quiet must hold before it is hidden again. */
  hideDelayMillis: number;
  /** Once shown, for how long it stays no matter what. */
  minVisibleMillis: number;
  /** After this long without progress, pending outgoing work stops counting. */
  outboundStallMillis: number;
}

/**
 * One phantom of ordinary traffic (a sent message, a read mark) is journalled
 * and handed to delivery within the same tick, and an incoming one is applied in
 * tens of milliseconds. 600 ms is comfortably above that, so ordinary use never
 * produces a flash, and comfortably below the ~1 s after which a user starts to
 * read a silent app as a stuck one.
 */
const SHOW_DELAY_MILLIS = 600;
/**
 * Draining a backlog has gaps in it: the dispatcher flushes the database every
 * INBOX_COMMIT_BATCH messages, and consecutive local changes journal their
 * phantoms hundreds of milliseconds apart. Without this window the indicator
 * would strobe through what is, to the user, one continuous synchronization.
 */
const HIDE_DELAY_MILLIS = 500;
/** An indicator that did come up has to stay long enough to be read. */
const MIN_VISIBLE_MILLIS = 1200;
/**
 * Backstop for "there are phantoms to send and nothing is happening". The
 * accurate signal is `outboundFailing`, reported by the journal pass itself;
 * this limit covers the case where no pass reports anything at all.
 */
const OUTBOUND_STALL_MILLIS = 90_000;

const DEFAULT_GATE: SyncGateParams = {
  showDelayMillis: SHOW_DELAY_MILLIS,
  hideDelayMillis: HIDE_DELAY_MILLIS,
  minVisibleMillis: MIN_VISIBLE_MILLIS,
  outboundStallMillis: OUTBOUND_STALL_MILLIS,
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
    outboundHeld: false,
  };
}

/**
 * Whether queued outgoing phantoms should count as work in progress.
 *
 * They stop counting when the journal stops moving: a failed pass is not
 * retried until the retry timer fires (see index.ts), and a "Synchronizing…"
 * that hangs forever over an unreachable server tells the user the opposite of
 * the truth. A reported failure is that answer immediately; the age limit is
 * only for the case where nothing reported anything.
 */
export function isOutboundActive(
  c: SyncActivityCounters, now: number, p: SyncGateParams,
): boolean {
  if (c.outboundPending < 1) {
    return false;
  }
  if (c.outboundFailing || c.outboundHeld) {
    return false;
  }
  return (now - (c.outboundChangedAt ?? now)) <= p.outboundStallMillis;
}

export function isSyncWorkOn(
  c: SyncActivityCounters, now: number, p: SyncGateParams,
): boolean {
  return (c.catchUpScans > 0)
    || (c.inboundQueued > 0)
    || (c.inboundApplying > 0)
    || isOutboundActive(c, now, p);
}

/**
 * Units of work left. inboundApplying is deliberately left out: a phantom being
 * applied is still counted in inboundQueued, and adding it would count it
 * twice. It only ever affects the boolean above - which is also what covers
 * phantoms fed straight into the chat service (specs do that), bypassing the
 * dispatcher's queue: work is on, and there is simply no count to show.
 */
export function pendingUnits(
  c: SyncActivityCounters, now: number, p: SyncGateParams,
): number {
  return c.inboundQueued + (isOutboundActive(c, now, p) ? c.outboundPending : 0);
}

/**
 * Which phase to name when several are on at once. Incoming work is named
 * before outgoing because it is the one that changes what the user is looking
 * at; a catch-up scan outranks both, being the reason for the other two.
 */
export function dominantPhase(
  c: SyncActivityCounters, now: number, p: SyncGateParams,
): SyncPhase {
  if (c.catchUpScans > 0) {
    return 'catch-up';
  }
  if ((c.inboundQueued > 0) || (c.inboundApplying > 0)) {
    return 'incoming';
  }
  if (isOutboundActive(c, now, p)) {
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
 * Returning `wakeAt` rather than arming a timer inside is what keeps this a
 * pure function: the shell arms setTimeout, and specs step time by hand.
 */
export function stepGate(
  s: GateState, busy: boolean, now: number, p: SyncGateParams,
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
  c: SyncActivityCounters, gate: GateState, seq: number, now: number, p: SyncGateParams,
): SyncActivityView {
  return {
    seq,
    syncing: gate.visible,
    pending: pendingUnits(c, now, p),
    phase: gate.visible ? dominantPhase(c, now, p) : 'idle',
    // Held work is not stalled work: it is waiting for a call to end, which is
    // this device's own decision and needs no reporting.
    stalled: (c.outboundPending > 0) && !c.outboundHeld && !isOutboundActive(c, now, p),
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
  /**
   * Terminal outcome of one phantom's delivery.
   *
   * Separate from the pass outcome, and touching only the "cannot send" flag: a
   * delivery finishing says nothing about whether the journal is being held for
   * a call, and letting it clear that flag would light the indicator in the
   * middle of a call every time a delivery started before the call reported in.
   */
  noteOutboundDeliveryOutcome(outcome: 'delivered' | 'failed'): void;
  /** Current snapshot, for the request-reply getter the GUI starts with. */
  snapshot(): SyncActivityView;
  /** Subscribes to changes of the visible state. */
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
   * nothing but the inbox catch-up is reported to the GUI: a user with a single
   * device has no synchronization to be told about, and the phantoms in their
   * inbox are their own copies coming back (see hasSeenOtherDevice in
   * local-data-store.ts). The catch-up is the exception because it is not about
   * their devices at all - see currentView() below.
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
      // fails here must not take the tracker (and with it the indicator) down.
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
      counters.outboundHeld = false;
    }
  }

  /**
   * Emits when the visible state changed, and - no more often than
   * BUSY_POLL_MILLIS - when only the count did. Without that throttle a
   * backlog of a few hundred phantoms would put an extra event on the wire per
   * phantom, on top of the chat and message events it already generates.
   */
  function currentView(atSeq: number, at: number): SyncActivityView {
    const view = viewOf(counters, gate, atSeq, at, params);
    if (!isReportable || isReportable()) {
      return view;
    }
    // The one thing a user with a single device is still told about: the
    // catch-up scan of the inbox. Everything else this tracker watches is
    // traffic between the user's devices, and there is none - but the inbox
    // holds messages from other people, sent while the app was closed, and
    // until the scan comes back they are missing from the chat list. That scan
    // was measured taking from 15 to 88 seconds (2026-09-11), which is a long
    // time to look at an app that appears to be fully up and simply has
    // nothing new to show.
    //
    // Counts are dropped with it: `pending` here would be phantoms and journal
    // rows, which is the very thing not to report to this user.
    return (view.phase === 'catch-up')
      ? { ...view, pending: 0, stalled: false }
      : idleViewOf(atSeq);
  }

  function publish(): void {
    const at = now();
    const view = currentView(seq + 1, at);
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
    const busy = isSyncWorkOn(counters, at, params);
    const { state, wakeAt } = stepGate(gate, busy, at, params);
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
   * The journal is polled rather than instrumented at its write sites: a
   * phantom that is journalled and handed to delivery within the same tick
   * never shows up in a poll, which is exactly the flicker not worth showing.
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
        log.error('syncActivity pollTimer error:', err);
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
      counters.outboundHeld = (outcome === 'deferred');
      readOutbound();
    }),
    // Only `outboundFailing`: the held flag belongs to the pass, which is the
    // only thing that knows whether a call is holding the journal back.
    noteOutboundDeliveryOutcome: outcome => changed(() => {
      counters.outboundFailing = (outcome === 'failed');
      readOutbound();
    }),

    snapshot: () => currentView(seq, now()),

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
