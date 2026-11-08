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
 * What the synchronization indicator shows, and what the journal of outgoing
 * phantoms actually sends.
 *
 * Both are rules about *time* - "has this state held long enough", "is this row
 * older than that one" - and both are written as pure functions with `now` and
 * the rows passed in, precisely so that a spec can step through them instead of
 * waiting them out. A test that had to sit through 600 ms of debounce to check
 * the debounce would be measuring the test runner; one that drives a live
 * tracker would be racing it.
 *
 * Nothing here touches the network, the database, or the background component.
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { chatService } from '@main/common/services/external-services.ts';
import {
  dominantPhase,
  emptyCounters,
  idleViewOf,
  initialGateState,
  isOutboundActive,
  isSyncWorkOn,
  makeSyncActivityTracker,
  pendingUnits,
  stepGate,
  syncPassOutcome,
  viewOf,
  type SyncActivityCounters,
  type SyncGateParams,
} from '@deno/utils/sync-activity.ts';
import { planJournalRelease } from '@deno/services/mail-sending-service/sync-phantoms.ts';
import { isSyncPhantomFromOtherDevice } from '@deno/services/mail-service/inbox-dispatcher.ts';
import {
  clearAllFlights,
  countFlightsAwaitingOutcome,
  currentFlights,
  flightsToForget,
  forgetFlightOfRow,
  isTerminalDeliveryFailure,
  notePhantomHandedToDelivery,
  partitionByFlight,
  takeFlightOfDelivery,
} from '@deno/services/mail-sending-service/phantom-flight.ts';
import type { PendingSyncMsgDbEntry, SyncPhantomAspect } from '@deno/types/msgs-db.types.ts';

const GATE: SyncGateParams = {
  showDelayMillis: 600,
  hideDelayMillis: 500,
  minVisibleMillis: 1200,
  outboundStallMillis: 90_000,
};

const NOW = 1_000_000;

function counters(overrides: Partial<SyncActivityCounters>): SyncActivityCounters {
  return { ...emptyCounters(), ...overrides };
}

/** Queued outgoing work whose journal moved just now, i.e. work in progress. */
function outbound(pending: number, changedAt = NOW): SyncActivityCounters {
  return counters({ outboundPending: pending, outboundChangedAt: changedAt });
}

// =============================================================================
// Test Suite 1: what counts as work in progress
// =============================================================================

describe(`Synchronization activity, state of the counters`, () => {

  itCond(`an idle device is idle`, async () => {
    const c = emptyCounters();

    expect(isSyncWorkOn(c, NOW, GATE))
      .withContext(`nothing queued, nothing being applied, nothing to send`)
      .toBe(false);
    expect(pendingUnits(c, NOW, GATE)).toBe(0);
    expect(dominantPhase(c, NOW, GATE)).toBe('idle');
  });

  itCond(`incoming, outgoing and a scan each count as work`, async () => {
    expect(isSyncWorkOn(counters({ inboundQueued: 1 }), NOW, GATE)).toBe(true);
    expect(isSyncWorkOn(counters({ inboundApplying: 1 }), NOW, GATE)).toBe(true);
    expect(isSyncWorkOn(counters({ catchUpScans: 1 }), NOW, GATE)).toBe(true);
    expect(isSyncWorkOn(outbound(1), NOW, GATE)).toBe(true);
  });

  itCond(`a phantom being applied is not counted twice`, async () => {
    // It is still one of the queued ones; adding it to the count would show
    // "2" where there is one message.
    const c = counters({ inboundQueued: 1, inboundApplying: 1 });

    expect(pendingUnits(c, NOW, GATE))
      .withContext(`one queued phantom, one of them in flight`)
      .toBe(1);
  });

  itCond(`a phantom applied outside the queue has no count, but is work`, async () => {
    // The path specs use: handleIncomingMsg() called straight over IPC, with the
    // dispatcher's queue never involved.
    const c = counters({ inboundApplying: 1 });

    expect(isSyncWorkOn(c, NOW, GATE)).toBe(true);
    expect(pendingUnits(c, NOW, GATE)).toBe(0);
    expect(dominantPhase(c, NOW, GATE)).toBe('incoming');
  });

  itCond(`incoming and outgoing units add up`, async () => {
    const c = counters({ inboundQueued: 3, outboundPending: 2, outboundChangedAt: NOW });

    expect(pendingUnits(c, NOW, GATE)).toBe(5);
  });

  itCond(`a phase is named by what outranks the rest`, async () => {
    const all = counters({
      catchUpScans: 1, inboundQueued: 2, outboundPending: 2, outboundChangedAt: NOW,
    });
    expect(dominantPhase(all, NOW, GATE))
      .withContext(`a scan is the reason for the other two`)
      .toBe('catch-up');

    const inAndOut = counters({ inboundQueued: 1, outboundPending: 1, outboundChangedAt: NOW });
    expect(dominantPhase(inAndOut, NOW, GATE))
      .withContext(`incoming changes what the user is looking at`)
      .toBe('incoming');

    expect(dominantPhase(outbound(1), NOW, GATE)).toBe('outgoing');
  });

  itCond(`a reported delivery failure stops outgoing work from counting`, async () => {
    const failing = counters({
      outboundPending: 4, outboundChangedAt: NOW, outboundFailing: true,
    });

    expect(isOutboundActive(failing, NOW, GATE))
      .withContext(`the server refused the last pass; nothing is in progress`)
      .toBe(false);
    expect(viewOf(failing, { ...initialGateState(), visible: true }, 1, NOW, GATE).stalled)
      .withContext(`there is work to send and it is not moving`)
      .toBe(true);
  });

  itCond(`a journal that stops moving stops counting too`, async () => {
    const stuck = outbound(4, NOW - GATE.outboundStallMillis - 1);

    expect(isOutboundActive(stuck, NOW, GATE))
      .withContext(`nothing reported anything, and the journal has not moved`)
      .toBe(false);
    expect(isOutboundActive(outbound(4, NOW - 1_000), NOW, GATE))
      .withContext(`a journal that moved a second ago is in progress`)
      .toBe(true);
  });

  itCond(`work held back by a call is neither in progress nor stalled`, async () => {
    // Phantoms wait out a call on purpose (signalling comes first), and a user
    // has nothing to be told about that. Counting it as work put a progress bar
    // in front of everyone during their calls - including users with a single
    // device, who have nobody to synchronize with (2026-08-14).
    const held = counters({ outboundPending: 3, outboundChangedAt: NOW, outboundHeld: true });

    expect(isOutboundActive(held, NOW, GATE)).toBe(false);
    expect(isSyncWorkOn(held, NOW, GATE))
      .withContext(`nothing is going on while the journal waits for a call to end`)
      .toBe(false);

    const view = viewOf(held, initialGateState(), 1, NOW, GATE);
    expect(view.syncing).toBe(false);
    expect(view.stalled)
      .withContext(`waiting on purpose is not being stuck`)
      .toBe(false);
  });

  itCond(`incoming work still shows while outgoing work is held`, async () => {
    // A call does not stop phantoms from arriving, and applying them is work the
    // indicator should still name.
    const c = counters({
      inboundQueued: 2, outboundPending: 1, outboundChangedAt: NOW, outboundHeld: true,
    });

    expect(isSyncWorkOn(c, NOW, GATE)).toBe(true);
    expect(dominantPhase(c, NOW, GATE)).toBe('incoming');
    expect(pendingUnits(c, NOW, GATE))
      .withContext(`held outgoing rows are not counted`)
      .toBe(2);
  });

  itCond(`an empty journal is never stalled`, async () => {
    const view = viewOf(emptyCounters(), initialGateState(), 1, NOW, GATE);

    expect(view.stalled).toBe(false);
    expect(view.syncing).toBe(false);
    expect(view.phase).toBe('idle');
  });

});

// =============================================================================
// Test Suite 2: the show/hide gate
// =============================================================================

/**
 * Steps the gate through a script of (busy, at) pairs, returning every state it
 * passed through. `wakeAt` is followed where the script does not step past it,
 * because that is what the timer in the tracker does.
 */
function runGate(script: { busy: boolean; at: number }[]) {
  let state = initialGateState();
  const seen: { at: number; visible: boolean; wakeAt: number | undefined }[] = [];
  let busy = false;

  for (const step of script) {
    busy = step.busy;
    const result = stepGate(state, busy, step.at, GATE);
    state = result.state;
    seen.push({ at: step.at, visible: state.visible, wakeAt: result.wakeAt });
  }

  return { state, seen };
}

describe(`Synchronization activity, the show/hide gate`, () => {

  itCond(`a short burst of work never shows the indicator`, async () => {
    // One message sent: journalled, handed to delivery, done - in far less than
    // the show delay. This is the flicker the delay exists to prevent.
    const { seen } = runGate([
      { busy: true, at: NOW },
      { busy: true, at: NOW + 200 },
      { busy: false, at: NOW + 200 },
      { busy: false, at: NOW + 5_000 },
    ]);

    expect(seen.some(s => s.visible))
      .withContext(`work held for 200 ms, the gate opens at 600`)
      .toBe(false);
  });

  itCond(`work that holds opens the gate on the boundary`, async () => {
    const before = runGate([
      { busy: true, at: NOW },
      { busy: true, at: NOW + GATE.showDelayMillis - 1 },
    ]);
    expect(before.state.visible).toBe(false);

    const on = runGate([
      { busy: true, at: NOW },
      { busy: true, at: NOW + GATE.showDelayMillis },
    ]);
    expect(on.state.visible).toBe(true);
  });

  itCond(`the gate asks to be stepped again while a change is pending`, async () => {
    const { seen } = runGate([{ busy: true, at: NOW }]);
    const [first] = seen;

    expect(first.wakeAt)
      .withContext(`the indicator is due at the show delay, and nothing else will step the gate`)
      .toBe(NOW + GATE.showDelayMillis);
  });

  itCond(`a shown indicator stays for its minimum, then hides`, async () => {
    // Work stops right after the gate opened: the hide delay alone would take
    // the indicator away almost immediately.
    const shownAt = NOW + GATE.showDelayMillis;
    let state = runGate([
      { busy: true, at: NOW },
      { busy: true, at: shownAt },
    ]).state;

    const goneIdle = stepGate(state, false, shownAt + 10, GATE);
    state = goneIdle.state;
    expect(state.visible).toBe(true);
    expect(goneIdle.wakeAt)
      .withContext(`hiding waits out the minimum visible time, not the hide delay`)
      .toBe(shownAt + GATE.minVisibleMillis);

    expect(stepGate(state, false, shownAt + GATE.minVisibleMillis - 1, GATE).state.visible).toBe(true);
    expect(stepGate(state, false, shownAt + GATE.minVisibleMillis, GATE).state.visible).toBe(false);
  });

  itCond(`a gap shorter than the hide delay does not strobe the indicator`, async () => {
    // Draining a backlog has gaps in it (a database flush every batch), and the
    // indicator must read as one synchronization rather than a series of them.
    const shownAt = NOW + GATE.showDelayMillis;
    const { seen } = runGate([
      { busy: true, at: NOW },
      { busy: true, at: shownAt },
      { busy: false, at: shownAt + 2_000 },
      { busy: true, at: shownAt + 2_300 },
      { busy: false, at: shownAt + 2_400 },
      { busy: true, at: shownAt + 2_600 },
    ]);

    const afterShown = seen.filter(s => s.at >= shownAt);
    expect(afterShown.every(s => s.visible))
      .withContext(`gaps of 300 and 200 ms against a hide delay of ${GATE.hideDelayMillis}`)
      .toBe(true);
  });

  itCond(`work resuming clears a pending hide`, async () => {
    const shownAt = NOW + GATE.showDelayMillis;
    const shown = runGate([
      { busy: true, at: NOW },
      { busy: true, at: shownAt },
    ]).state;

    const idling = stepGate(shown, false, shownAt + 3_000, GATE).state;
    expect(idling.idleSince).toBe(shownAt + 3_000);

    const busyAgain = stepGate(idling, true, shownAt + 3_100, GATE).state;
    expect(busyAgain.idleSince)
      .withContext(`the countdown to hiding starts over next time work stops`)
      .toBeUndefined();
    expect(busyAgain.visible).toBe(true);
  });

});

// =============================================================================
// Test Suite 3: what the journal actually sends
// =============================================================================

function row(
  id: number, aspect: SyncPhantomAspect, entityId: string, ts: number,
): PendingSyncMsgDbEntry {
  return { id, entityType: 'msg', entityId, aspect, ts, payload: '{}', attempts: 0 };
}

describe(`Journal of outgoing sync phantoms, what a pass sends`, () => {

  itCond(`several changes of one aspect collapse into the newest`, async () => {
    // A message going out stamps its status more than once ('sending', then a
    // terminal one); an offline device accumulates all of them.
    const rows = [
      row(1, 'status', 'chat/msg-1', 100),
      row(2, 'status', 'chat/msg-1', 200),
      row(3, 'status', 'chat/msg-1', 300),
    ];

    const { release, superseded } = planJournalRelease(rows);

    expect(release.length).toBe(1);
    expect(release[0].ts)
      .withContext(`the receiver would apply only this one anyway`)
      .toBe(300);
    expect(superseded.map(r => r.id)).toEqual([1, 2]);
  });

  itCond(`different entities and aspects never collapse into each other`, async () => {
    const rows = [
      row(1, 'status', 'chat/msg-1', 100),
      row(2, 'status', 'chat/msg-2', 100),
      row(3, 'body', 'chat/msg-1', 100),
      row(4, 'reactions', 'chat/msg-1', 100),
    ];

    const { release, superseded } = planJournalRelease(rows);

    expect(release.length).toBe(4);
    expect(superseded.length).toBe(0);
  });

  itCond(`a record is never superseded`, async () => {
    // 'record' carries the message itself rather than a change of one aspect,
    // and a resync answer repeats a record with its *original* stamp - so
    // "keep the greatest ts" would drop exactly the answer that was asked for.
    const rows = [
      row(1, 'record', 'chat/msg-1', 500),
      row(2, 'record', 'chat/msg-1', 100),
    ];

    const { release, superseded } = planJournalRelease(rows);

    expect(release.map(r => r.id)).toEqual([1, 2]);
    expect(superseded.length).toBe(0);
  });

  itCond(`tombstones are never superseded`, async () => {
    // A deletion phantom can cover more messages than the row naming it, so a
    // superseded one is not necessarily a subset of the newer one.
    const rows = [
      row(1, 'deleted', 'chat/msg-1', 100),
      row(2, 'deleted', 'chat/msg-1', 200),
    ];

    const { release, superseded } = planJournalRelease(rows);

    expect(release.length).toBe(2);
    expect(superseded.length).toBe(0);
  });

  itCond(`equal stamps are broken by insertion order`, async () => {
    const rows = [
      row(7, 'body', 'chat/msg-1', 100),
      row(8, 'body', 'chat/msg-1', 100),
    ];

    const { release, superseded } = planJournalRelease(rows);

    expect(release.map(r => r.id))
      .withContext(`the later row is the later change`)
      .toEqual([8]);
    expect(superseded.map(r => r.id)).toEqual([7]);
  });

  itCond(`an empty journal plans nothing`, async () => {
    const { release, superseded } = planJournalRelease([]);

    expect(release.length).toBe(0);
    expect(superseded.length).toBe(0);
  });

});

// =============================================================================
// Test Suite 4: the state the GUI starts from
// =============================================================================

describe(`Synchronization activity over IPC`, () => {

  itCond(`the background component answers with a usable snapshot`, async () => {
    // The GUI asks for this once, right after subscribing: events are only built
    // while a GUI is attached, so a start-up catch-up would otherwise be invisible.
    const state = await chatService.getSyncActivityState();

    expect(typeof state.seq).toBe('number');
    expect(typeof state.syncing).toBe('boolean');
    expect(typeof state.pending).toBe('number');
    expect(typeof state.stalled).toBe('boolean');
    expect(['idle', 'catch-up', 'incoming', 'outgoing'])
      .withContext(`phase should be one of the known ones, got '${state.phase}'`)
      .toContain(state.phase);
  });

});

// =============================================================================
// Test Suite 5: rows inside a delivery
// =============================================================================

const GRACE = 7 * 60_000;

type RecipientProgress = web3n.asmail.DeliveryProgress['recipients'][string];

function progressOf(
  allDone: web3n.asmail.DeliveryProgress['allDone'], err?: RecipientProgress['err'],
): web3n.asmail.DeliveryProgress {
  return {
    allDone,
    msgSize: 0,
    recipients: { 'a@b.c': { done: true, bytesSent: 0, ...(err ? { err } : {}) } },
  };
}

describe(`Journal of outgoing sync phantoms, rows inside a delivery`, () => {

  beforeEach(() => clearAllFlights());
  afterEach(() => clearAllFlights());

  itCond(`a row handed to delivery is not handed over again`, async () => {
    // The regression this whole mechanism risks: a pass runs after every local
    // change, so without this filter each change would re-send everything that is
    // still awaiting an outcome.
    const rows = [row(1, 'status', 'chat/msg-1', 100), row(2, 'body', 'chat/msg-2', 100)];
    notePhantomHandedToDelivery({
      rowId: 1, deliveryId: 'sync_1_a', handedAt: NOW, describedBy: 'msg chat/msg-1 / status',
    });

    const { releasable, waiting, abandoned } = partitionByFlight(rows, currentFlights(), NOW, GRACE);

    expect(releasable.map(r => r.id)).toEqual([2]);
    expect(waiting.map(r => r.id)).toEqual([1]);
    expect(abandoned.length).toBe(0);
  });

  itCond(`a handover whose outcome never came is released again after the grace`, async () => {
    const rows = [row(1, 'status', 'chat/msg-1', 100)];
    notePhantomHandedToDelivery({
      rowId: 1, deliveryId: 'sync_1_a', handedAt: NOW - GRACE - 1, describedBy: 'msg chat/msg-1 / status',
    });

    const { releasable, abandoned } = partitionByFlight(rows, currentFlights(), NOW, GRACE);

    expect(releasable.map(r => r.id))
      .withContext(`the platform never reported anything; the change must not be lost`)
      .toEqual([1]);
    expect(abandoned.map(f => f.deliveryId)).toEqual(['sync_1_a']);
    expect(countFlightsAwaitingOutcome(NOW, GRACE))
      .withContext(`an abandoned flight is not awaited any more`)
      .toBe(0);
  });

  itCond(`an outcome settles a handover exactly once`, async () => {
    notePhantomHandedToDelivery({
      rowId: 1, deliveryId: 'sync_1_a', handedAt: NOW, describedBy: 'msg chat/msg-1 / status',
    });

    expect(takeFlightOfDelivery('sync_1_a')?.rowId)
      .withContext(`the terminal event finds its row`)
      .toBe(1);
    expect(takeFlightOfDelivery('sync_1_a'))
      .withContext(`a repeated terminal event has nothing left to settle`)
      .toBeUndefined();
  });

  itCond(`an outcome of a superseded handover is ignored`, async () => {
    // The row was released again under a new delivery id (the grace expired, or
    // the sweep handed it back); a late event of the older delivery must not
    // settle - let alone delete - the row that the newer one is carrying.
    notePhantomHandedToDelivery({
      rowId: 1, deliveryId: 'sync_1_a', handedAt: NOW - GRACE - 1, describedBy: 'msg chat/msg-1 / status',
    });
    notePhantomHandedToDelivery({
      rowId: 1, deliveryId: 'sync_1_b', handedAt: NOW, describedBy: 'msg chat/msg-1 / status',
    });

    expect(takeFlightOfDelivery('sync_1_a'))
      .withContext(`the old delivery no longer owns this row`)
      .toBeUndefined();
    expect(takeFlightOfDelivery('sync_1_b')?.rowId).toBe(1);
  });

  itCond(`a row that left the journal takes its flight with it`, async () => {
    // Rows also leave by paths the registry knows nothing about - superseded by a
    // newer change, aged out of the window - and a flight left behind would keep
    // being subtracted from the count that drives the indicator.
    notePhantomHandedToDelivery({
      rowId: 1, deliveryId: 'sync_1_a', handedAt: NOW, describedBy: 'msg chat/msg-1 / status',
    });
    notePhantomHandedToDelivery({
      rowId: 2, deliveryId: 'sync_2_a', handedAt: NOW, describedBy: 'msg chat/msg-2 / body',
    });

    const stale = flightsToForget(currentFlights(), new Set([2]));
    expect(stale.map(f => f.rowId)).toEqual([1]);

    for (const f of stale) {
      forgetFlightOfRow(f.rowId);
    }
    expect(countFlightsAwaitingOutcome(NOW, GRACE)).toBe(1);
  });

  itCond(`a per-recipient error is a failure even when allDone says 'all-ok'`, async () => {
    // What the old handler missed entirely: it reacted to any terminal allDone the
    // same way and never read recipients[...].err. A phantom has one recipient -
    // this user's own address - so that error is the whole story.
    expect(isTerminalDeliveryFailure(progressOf('all-ok'))).toBe(false);
    expect(isTerminalDeliveryFailure(progressOf('with-errors'))).toBe(true);
    expect(isTerminalDeliveryFailure(
      progressOf('all-ok', { runtimeException: true, type: 'http-request', message: 'server said 500' }),
    ))
      .withContext(`a reported error is a failure whatever allDone says`)
      .toBe(true);
  });

  itCond(`the indicator counts only rows not handed to delivery`, async () => {
    const rows = [
      row(1, 'status', 'chat/msg-1', 100),
      row(2, 'body', 'chat/msg-2', 100),
      row(3, 'reactions', 'chat/msg-3', 100),
    ];
    notePhantomHandedToDelivery({
      rowId: 1, deliveryId: 'sync_1_a', handedAt: NOW, describedBy: 'msg chat/msg-1 / status',
    });

    const { releasable } = partitionByFlight(rows, currentFlights(), NOW, GRACE);

    expect(rows.length - countFlightsAwaitingOutcome(NOW, GRACE))
      .withContext(`this is the subtraction countPhantomsAwaitingRelease() makes`)
      .toBe(releasable.length);
  });

});

// =============================================================================
// Test Suite 6: how a pass reports itself
// =============================================================================

describe(`Journal of outgoing sync phantoms, the outcome a pass reports`, () => {

  itCond(`reads an ordinary pass as 'sent'`, async () => {
    // 'sent' means "the pass ended with no claim to make", not "something went
    // out": an empty journal and a journal whose every row is already inside a
    // delivery both end here, and neither is anything to tell the user about.
    expect(syncPassOutcome({ failed: false, deferred: false })).toBe('sent');
  });

  itCond(`reads a pass held back by a call as 'deferred'`, async () => {
    expect(syncPassOutcome({ failed: false, deferred: true })).toBe('deferred');
  });

  itCond(`reads a pass that delivery refused as 'failed'`, async () => {
    expect(syncPassOutcome({ failed: true, deferred: false })).toBe('failed');
  });

  itCond(`prefers 'deferred' over 'failed'`, async () => {
    // The two say different things about the same pass, and only one of them is
    // the user's business: a pass held back by a call never got as far as
    // trying, so reading it as a failure would put "cannot synchronize" in front
    // of a user whose device is perfectly fine.
    expect(syncPassOutcome({ failed: true, deferred: true })).toBe('deferred');
  });


});

// =============================================================================
// Test Suite 7: a user with one device
// =============================================================================

describe(`Synchronization activity, a device that has nobody to synchronize with`, () => {

  const OWN_DEVICE = 'desktop-aaa00000000000000000';
  const OTHER_DEVICE = 'desktop-bbb00000000000000000';

  itCond(`a phantom from another device is the work to report`, async () => {
    expect(isSyncPhantomFromOtherDevice(
      { chatMessageType: 'synchronization', sourceDeviceId: OTHER_DEVICE }, OWN_DEVICE,
    )).toBe(true);
  });

  itCond(`this device's own phantom is not`, async () => {
    // An inbox belongs to the user, not to a device, so a phantom this device
    // sent comes back to it. All that is done with such a copy is scheduling its
    // removal - counting it made a single-device user watch their device
    // "synchronize" with nobody at every start-up (2026-08-14).
    expect(isSyncPhantomFromOtherDevice(
      { chatMessageType: 'synchronization', sourceDeviceId: OWN_DEVICE }, OWN_DEVICE,
    )).toBe(false);
  });

  itCond(`neither is anything that is not a phantom`, async () => {
    expect(isSyncPhantomFromOtherDevice(
      { chatMessageType: 'regular', sourceDeviceId: OTHER_DEVICE }, OWN_DEVICE,
    )).toBe(false);
    expect(isSyncPhantomFromOtherDevice(undefined, OWN_DEVICE)).toBe(false);
  });

  itCond(`nor a phantom that cannot name its origin`, async () => {
    // A build that predates the field: it cannot be shown as another device's
    // work, because nothing says it is.
    expect(isSyncPhantomFromOtherDevice({ chatMessageType: 'synchronization' }, OWN_DEVICE))
      .toBe(false);
  });

  itCond(`an idle view keeps the sequence number`, async () => {
    // The number is what stops the GUI from applying a stale snapshot over a
    // newer event; a gap in it would break that ordering the moment the silence
    // ends.
    expect(idleViewOf(7)).toEqual({
      seq: 7, syncing: false, pending: 0, phase: 'idle', stalled: false,
    });
  });

  itCond(`work is tracked while silent, and shows the moment a device appears`, async () => {
    let hasOtherDevice = false;
    const tracker = makeSyncActivityTracker({
      countOutboundPending: () => 3,
      isReportable: () => hasOtherDevice,
    });
    try {
      tracker.inboundEnqueued(2);

      const silent = tracker.snapshot();
      expect(silent.syncing).toBe(false);
      expect(silent.pending)
        .withContext(`five units of work, and not a word about them`)
        .toBe(0);
      expect(silent.phase).toBe('idle');
      expect(silent.stalled).toBe(false);

      // The first phantom from another device arrives. Nothing is re-counted:
      // the counters were kept all along, which is why no restart is needed.
      hasOtherDevice = true;

      expect(tracker.snapshot().pending)
        .withContext(`2 queued phantoms + 3 rows awaiting release`)
        .toBe(5);
    } finally {
      tracker.stop();
    }
  });

  itCond(`the inbox catch-up is shown to a user with a single device too`, async () => {
    // The one thing that silence must not cover. Everything else this tracker
    // watches is traffic between the user's own devices, of which this user has
    // none - but the catch-up scan is the shared inbox being read for what
    // arrived while the app was closed, and it was measured taking up to 91
    // seconds (2026-09-11). During it the chat list is short of messages and the
    // app looks perfectly idle.
    const tracker = makeSyncActivityTracker({
      countOutboundPending: () => 3,
      isReportable: () => false,
      gate: { showDelayMillis: 0 },
    });
    try {
      tracker.inboundEnqueued(2);
      expect(tracker.snapshot().syncing)
        .withContext(`phantom traffic stays silent: there is no other device`)
        .toBe(false);

      tracker.beginCatchUpScan();
      const scanning = tracker.snapshot();
      expect(scanning.syncing).toBe(true);
      expect(scanning.phase).toBe('catch-up');
      expect(scanning.pending)
        .withContext(`a count here would be phantoms - the very thing not to report`)
        .toBe(0);

      tracker.endCatchUpScan();
      expect(tracker.snapshot().phase)
        .withContext(`and the silence comes back with the end of the scan`)
        .toBe('idle');
    } finally {
      tracker.stop();
    }
  });

});
