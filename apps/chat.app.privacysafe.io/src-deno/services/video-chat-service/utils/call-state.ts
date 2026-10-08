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
 * The state of every chat's call, in one place.
 *
 * This used to be spread over five registries in video-chat-service.ts (`calls`,
 * `activeCallHeartbeats`, `recentlyEndedCalls`, `callsEndedByHost`, plus the
 * `callStage`/`receivedDisconnect`/`hostEndAnnounced` triple inside CallInChat),
 * where "the call is still alive" was expressed differently in each place a
 * decision had to be made. Every question that used to be answered by
 * intersecting time windows is now answered by one record and one session id.
 *
 * Two deliberate properties:
 *
 * - **Pure.** No `w3n`, no timers, no I/O; `now` is always an argument. Callers
 *   own the clock and the side effects, which makes every rule below directly
 *   testable (see "Test Suite 7/8" in tests-app/src/tests/video-chat.ts).
 * - **Decisions return a reason, not a boolean.** The reason is what gets
 *   logged, so a dropped signal always says why it was dropped.
 *
 * Time windows did not disappear, but their job changed: for a signal that
 * carries a `callSessionId` the decision comes from comparing session ids, and
 * the windows only apply to signals without one (peers on builds that predate
 * the field). What remains unconditional is memory bounds - a record cannot
 * live forever just because its chat went quiet.
 */

import type { ChatIdObj } from '../../../../types/asmail-msgs.types.ts';
import { areAddressesEqual } from '../../../../shared-libs/address-utils.ts';
import { chatIdToString, hostAddrOfCallSession } from '../../../../shared-libs/chat-ids.ts';

// =============================================================================
// Windows
// =============================================================================

/**
 * How long a re-join record survives without a heartbeat confirming it.
 *
 * A record survives N lost beats while `(N + 1) * HEARTBEAT_INTERVAL <= this`,
 * with HEARTBEAT_INTERVAL = 15s (utils/call.ts). The former 35s therefore
 * survived exactly ONE loss, which the ASMail 500 storms make routine — 50s
 * covers three intervals (3 * 15 = 45 <= 50) and so two losses, at no cost in
 * traffic whatsoever: the beat rate is unchanged.
 *
 * Not raised further on purpose. Six consecutive losses were observed on
 * 2026-08-13 (~90s of silence), and no resend budget can cover that; a call
 * whose host has been unreachable that long SHOULD lose its "Join Call" button.
 *
 * Independent of, and deliberately different from, HEARTBEAT_MAX_AGE_MILLIS
 * (45s) below: that one bounds how old a single beat may be to count at all,
 * this one how long the record lives between beats.
 */
export const HEARTBEAT_TIMEOUT = 50_000;

/**
 * Lifetime of a *provisional* re-join record - one we created ourselves while
 * leaving a group call, on the assumption that the host stayed in it.
 * Deliberately much shorter than HEARTBEAT_TIMEOUT: if the host had in fact
 * died at that very moment, no real heartbeat will ever confirm the guess, and
 * the "Join Call" button would otherwise lead into a dead call for the full
 * HEARTBEAT_TIMEOUT. The host's out-of-cycle heartbeats are what confirm it in
 * time - see IMMEDIATE_HEARTBEAT_DELAYS_MS in utils/call.ts, whose schedule is
 * sized against this window.
 */
export const PROVISIONAL_REJOIN_TIMEOUT = 20_000;

/**
 * How long a heartbeat from the host that announced the end of a call keeps
 * being ignored. Covers a heartbeat that was already in flight just before the
 * host's 'disconnect', which would otherwise switch the "Join Call" button back
 * on for a call that is over.
 *
 * Only consulted for heartbeats **without** a `callSessionId`: with one, the
 * heartbeat is recognized as belonging to the ended session no matter how late
 * it arrives.
 */
export const HOST_ENDED_SUPPRESS_MILLIS = 20_000;

/**
 * How long late signalling for a call that ended here keeps being dropped
 * instead of buffered or answered with a re-sent 'start'. Prevents the "second
 * ringtone": after a 1-1 call ends, stale signals still in flight would
 * otherwise re-open the incoming-call UI.
 *
 * Only consulted for signals **without** a `callSessionId`.
 */
export const RECENTLY_ENDED_COOLDOWN_MILLIS = 45_000;

/**
 * How old a signal may be and still be treated as belonging to a live call.
 * A call cannot be waiting on a signal this old, so anything older was left in
 * the inbox by a finished call - e.g. a 'start' delivered after the app spent a
 * while offline, which would otherwise pop up an incoming-call window for a
 * call that is long over.
 *
 * Only consulted for signals **without** a `callSessionId`: with one, belonging
 * is decided by the id rather than guessed from the age.
 *
 * Sized to the transport, not to optimism: measured one-way ASMail latency is
 * 10-20s, the recovery paths this gates (request-start round trip, the
 * 'outgoing-call-cancelled' sysmsg on the ordinary queue) take 20-40s+, and a
 * backed-up inbox queue adds more. The former 45s cut dropped legitimately
 * slow signals of live calls (2026-08-11 revision).
 */
export const MAX_SIGNAL_AGE_MILLIS = 120_000;

/**
 * How long an `ended` record is kept at all. While the record is there, a
 * signal of that finished session is recognized and dropped by session id; once
 * it is gone the chat is back to `idle` and a signal of the old session is
 * dropped by age instead (see PENDING_SIGNAL_TTL_MILLIS in
 * video-chat-service.ts, which bounds how old a signal may be to be honored).
 *
 * Invariant: this must exceed MAX_SIGNAL_AGE_MILLIS. Anything young enough to
 * pass the age filter has to still find the record of its own session — with
 * the former 60s the window between 60s and 120s after a call let a signal
 * count as fresh while its session was already forgotten.
 */
export const ENDED_SESSION_RETENTION_MILLIS = 150_000;

/**
 * How old a heartbeat may be and still count as proof that a call is live.
 *
 * The host beats every 15s, so anything this old means five missed beats — and
 * the window's own host-silence watchdog (HOST_SILENCE_END_MS = 90s in
 * client-channel.ts) has by then already concluded the host is gone and closed
 * the call. Every heartbeat still travelling behind that verdict is therefore
 * older than this bound: without the filter, one of them arriving after our
 * `ended` record expired made the chat `rejoinable` again and flashed a "Join
 * Call" button on a call that no longer existed (observed 2026-08-11).
 */
export const HEARTBEAT_MAX_AGE_MILLIS = 45_000;

/**
 * Retention for `ended` records whose call the *host* ended. Much longer than
 * the general bound: the host's end is final for every participant, and while
 * the record lives, a replayed 'start' of that session is recognized and
 * dropped by id - which is the only clock-independent defence. A replayed
 * 'start' is not hypothetical: the inbox is shared between the user's devices,
 * a device that came online mid-call may cause the host to re-send 'start' to
 * the address, and that message is then seen by every device. A new call is
 * unaffected: it carries a different session id and is accepted regardless of
 * this record.
 */
export const ENDED_BY_HOST_RETENTION_MILLIS = 10 * 60_000;

/**
 * How long a call may ring unanswered before this device gives up on it.
 * `ringing` is a live state, so nothing else bounds it: a device that missed
 * the host's 'disconnect' (the inbox is shared, and another device may consume
 * the message first) used to ring - and show its Join button - forever. Longer
 * than MAX_SIGNAL_AGE_MILLIS and any reasonable time to answer; the host's own
 * no-answer timeout is what ends the call on its side.
 */
export const RINGING_NO_ANSWER_TIMEOUT_MILLIS = 90_000;

// =============================================================================
// States
// =============================================================================

/**
 * `idle` is the absence of a record, so it is not part of this type: a chat
 * with no call has nothing to remember.
 */
export type CallState =
  /** We host; the window is open, nobody has joined yet. */
  | 'dialing'
  /** We are a client; 'start' arrived, the user has not answered yet. */
  | 'ringing'
  /** Role settled, signalling under way. */
  | 'connecting'
  /** Media established. */
  | 'active'
  /** Teardown started - locally, or because a peer sent 'disconnect'. */
  | 'winding-down'
  /** Over. `endedBy` says by whom. */
  | 'ended'
  /** We left a group call that keeps running without us. */
  | 'rejoinable';

/** Who brought the call to an end. Decides whether heartbeats are suppressed. */
export type CallEndedBy =
  /** The call's host announced the end: nobody can be in that call anymore. */
  | 'host'
  /** We ended it on this device. */
  | 'self'
  /** A peer's 'disconnect' ended it (1-1, or the host seeing its client leave). */
  | 'peer'
  /**
   * Another device of this same user answered or declined it, so the call goes
   * on - just not here (see handleCallHandledElsewhere). Told apart from 'self'
   * because signalling of that call keeps arriving at this device too: the inbox
   * is shared, and the host addresses peers by address. Such a signal must
   * neither be acted upon nor taken out of the inbox, and the record must
   * outlive the call rather than a fixed window - otherwise, having forgotten
   * the session, this device treats the next signal as an orphan, asks the host
   * to re-send 'start', and starts ringing in the middle of the call.
   */
  | 'other-device';

export interface CallSessionRecord {
  chatId: ChatIdObj;
  state: CallState;
  /** When the current state was entered. */
  since: number;
  role?: 'host' | 'client';
  hostAddr?: string;
  /**
   * Session id of the call this record describes; undefined when the call was
   * started by a peer running a build that predates the field.
   */
  callSessionId?: string;
  /**
   * `rejoinable` only: a guess we made on our own way out of the call, not yet
   * confirmed by a real heartbeat from the host. Expires on the shorter
   * PROVISIONAL_REJOIN_TIMEOUT.
   */
  provisional?: boolean;
  /** `rejoinable` only: when the last heartbeat was seen. */
  lastBeat?: number;
  /** `ended` only. */
  endedBy?: CallEndedBy;
  /**
   * When a signal of this (finished-here) session was last seen. Only kept for
   * `endedBy: 'other-device'`, where signals still arriving are the evidence
   * that the call goes on elsewhere: the record's retention is measured from
   * this instead of from `since`, so it lasts as long as the call does.
   */
  lastSignal?: number;
  /**
   * `ringing` only: when the host sent the invitation (`startedAt` of its
   * 'start'), for the tie-break against another call started in this chat at
   * the same moment (see callCollisionWinner).
   */
  startedAt?: number;
}

/** Fields a transition may set alongside the new state. */
export type CallSessionPatch = Partial<
  Pick<
    CallSessionRecord,
    | 'role' | 'hostAddr' | 'callSessionId' | 'provisional' | 'lastBeat' | 'endedBy'
    | 'lastSignal' | 'startedAt'
  >
>;

// =============================================================================
// Transitions
// =============================================================================

/**
 * The only place that knows which transitions exist. `undefined` as `from`
 * means `idle` - there is no record for this chat yet.
 *
 * `ended` is not a sink: a chat outlives its calls, so a new call (`dialing` /
 * `ringing`) or a heartbeat telling us the host is still there (`rejoinable`)
 * legitimately follows it.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<CallState, ReadonlySet<CallState>>> = {
  'dialing': new Set(['connecting', 'active', 'winding-down', 'ended']),
  'ringing': new Set(['connecting', 'winding-down', 'ended']),
  // 'rejoinable' straight from 'connecting'/'active': the normal teardown goes
  // through 'winding-down' (end() reports it first), but the GUI→deno path may
  // deliver the terminal state directly (window closed itself, service
  // restarted mid-call). Refusing the transition used to leave the record
  // stuck in a live state forever — which blocks resync, the "Join Call"
  // button and any new call in the chat until a service restart.
  'connecting': new Set(['active', 'winding-down', 'ended', 'rejoinable']),
  'active': new Set(['winding-down', 'ended', 'rejoinable']),
  'winding-down': new Set(['ended', 'rejoinable']),
  'ended': new Set(['dialing', 'ringing', 'rejoinable']),
  'rejoinable': new Set(['connecting', 'dialing', 'ringing', 'ended']),
};

/** States a call may be entered from `idle`. */
const ENTRY_STATES: ReadonlySet<CallState> = new Set(['dialing', 'ringing', 'rejoinable']);

export function canTransit(from: CallState | undefined, to: CallState): boolean {
  if (from === undefined) {
    return ENTRY_STATES.has(to);
  }
  if (from === to) {
    // Re-entering the same state is a no-op, not an error: several paths report
    // the same fact (e.g. both the fast DataChannel and the slow ASMail
    // 'disconnect' report a peer leaving).
    return true;
  }
  return ALLOWED_TRANSITIONS[from].has(to);
}

/** States in which a call is going on and signals about it are expected. */
const LIVE_STATES: ReadonlySet<CallState> = new Set([
  'dialing', 'ringing', 'connecting', 'active',
]);

export function isLiveState(state: CallState): boolean {
  return LIVE_STATES.has(state);
}

/**
 * States in which THIS device sends signalling of its own.
 *
 * Narrower than LIVE_STATES by one state, and the difference matters to whoever
 * has to yield to a call: in `ringing` the call is live, but everything on the
 * wire is the caller's - this device has answered nothing yet and sends nothing.
 * Holding other traffic back for it means holding it for as long as the phone is
 * allowed to ring (RINGING_NO_ANSWER_TIMEOUT_MILLIS, 90 s), which is how sync
 * phantoms came to wait out calls nobody answered (2026-08-14).
 */
const SIGNALLING_STATES: ReadonlySet<CallState> = new Set([
  'dialing', 'connecting', 'active',
]);

export function isSignallingState(state: CallState): boolean {
  return SIGNALLING_STATES.has(state);
}

export type CallHandledElsewhereOutcome =
  /** Step out of the call going on here. */
  | 'yield'
  /** Carry on; the notice changes nothing here. */
  | 'keep'
  /**
   * Take the "Join Call" button down: the call it offers is the one the other
   * device has just taken.
   */
  | 'drop-rejoin-offer';

/**
 * What to do with a 'call handled elsewhere' notice from another device of this
 * user: step out of the call, carry on here, or take a re-join offer down.
 *
 * The notice is sent the moment the user answers - before the media setup screen
 * even opens - but it travels over ASMail, and that took 7 s in the run of
 * 2026-08-14. Inside that window the user can answer on a second device too, and
 * until this function the notice was acted upon only in `ringing`: a device that
 * had answered was already in `connecting`, ignored the notice, and both devices
 * went on to join. Peers are keyed by address, so the second offer lands on the
 * host's already negotiated connection and either device's 'disconnect' ends a
 * one-to-one call for both (plans/call-multidevice-endpoints.md).
 *
 * The tie-break is a plain string comparison of the two device ids, and it is
 * what makes the outcome safe: both devices compare the same pair and reach
 * opposite conclusions, so exactly one steps out - never both (that would be a
 * call nobody takes) and never neither. Not `localeCompare`: its order depends
 * on the locale, and two devices in different locales could then disagree. Ids
 * are `<formFactor>-<random>` and unique per device; equal ids mean two copies
 * on one data folder, and such a notice is taken as our own long before here.
 *
 * `otherInCall` is the notice's `inCall` marker - "I am already in this call,
 * not merely setting up". It beats the tie-break, because a device that has
 * media running has passed a point the other one has not.
 *
 * `rejoinable` is not about stepping out - there is nothing here to step out of
 * - but the button is an offer to enter the very call the neighbour has just
 * entered, and taking that offer would put two devices of one address into it,
 * which the host cannot tell apart. So the offer goes. Until 2026-08-17 it
 * stood until the record expired: the re-join path sent no notice at all, and
 * this function answered `keep` for a notice that did arrive.
 */
export function callHandledElsewhereOutcome({
  state,
  joinedThere,
  otherInCall,
  ownDeviceId,
  otherDeviceId,
}: {
  state: CallState | undefined;
  joinedThere: boolean;
  otherInCall: boolean;
  ownDeviceId: string;
  otherDeviceId: string;
}): CallHandledElsewhereOutcome {
  if (state === 'ringing') {
    // Nothing of ours is on the wire yet, so there is nothing to weigh: whether
    // the other device answered or declined, this ringtone is done.
    return 'yield';
  }

  if (state === 'rejoinable') {
    // A neighbour that DECLINED changes nothing: the call it declined is still
    // going on, and this device may still join it.
    return joinedThere ? 'drop-rejoin-offer' : 'keep';
  }

  if (state !== 'connecting') {
    // 'active' and 'winding-down': media is running here, and a device that is
    // only setting up must not be able to take the call away. 'dialing': we are
    // the host of an outgoing call, which this notice is not about. 'ended':
    // there is nothing to step out of and no offer to take down, and marking
    // the session again would only suppress the signals of the next call.
    return 'keep';
  }

  if (!joinedThere) {
    // The other device *declined*. Yielding to it would leave the call taken by
    // nobody, with this user's answer thrown away - the one outcome worse than
    // both devices joining.
    return 'keep';
  }

  return otherInCall || (ownDeviceId > otherDeviceId) ? 'yield' : 'keep';
}

/**
 * Whether the invitation to this peer is still worth another copy - the gate on
 * the repeats of 'start' (START_REPEAT_DELAYS_MILLIS in utils/_common.ts).
 *
 * Unlike a duplicate 'disconnect', a duplicate 'start' is not inert: one landing
 * after the call is over, or after this peer answered or declined, rings a
 * phantom call. So the gate has to be exact about what "this peer is done being
 * invited" means, and that is the whole reason it is a function here rather than
 * a closure over the call's own maps: the first version read the host's
 * `clients` map, which is seeded with EVERY invited peer when the role is taken
 * (initializeRole in call.ts) and therefore said "answered" about everyone from
 * the outset. The repeats were dead from the day they were written - measured in
 * the live run of 2026-08-16, where every call cancelled them at #1/3 three
 * seconds in, including calls the peer went on to answer.
 *
 * `answered` must hold peers who have *signalled back* (an offer of their own),
 * and must keep holding them after they leave: a peer who joined and left within
 * the repeat schedule has been reached, and a fresh copy of the invitation would
 * ring them into a call they have already been in.
 */
export function inviteStillPending(
  { callIsLive, answered, declined }: {
    callIsLive: boolean;
    answered: Iterable<string>;
    declined: Iterable<string>;
  },
  peerAddr: string,
): boolean {
  if (!callIsLive) {
    return false;
  }
  // areAddressesEqual, not set lookups: the address in a peer's own signal and
  // the one this call was started with may differ in case or in the way the
  // domain is written, and here a mismatch means sending an unwanted invite.
  const isPeer = (addr: string) => areAddressesEqual(addr, peerAddr);
  return !Array.from(answered).some(isPeer) && !Array.from(declined).some(isPeer);
}

/** One of two calls started in the same chat at the same moment. */
export interface CallCollisionParty {
  hostAddr: string;
  callSessionId?: string;
  /** `startedAt` of its 'start'; absent while not sent, or from an older build. */
  startedAt?: number;
  /** Someone has already answered this call. */
  established: boolean;
}

/**
 * Which of two calls started in one chat at the same moment stays, the other's
 * host stepping aside to join it as a client.
 *
 * The moment is wide: an invitation takes 7-20 s to cross ASMail, and two people
 * pressing "call" inside that window both become hosts of calls that wait for
 * each other's offer. Until this rule the second 'start' went into the first
 * host's call object, which has nothing to do with a 'start', and both windows
 * showed "Calling..." until their no-answer timeout.
 *
 * Every party - the two hosts and anybody both of them invited - runs this on
 * the same pair of facts and so reaches the same answer without a round trip.
 * The order of the rules is the order of what cannot be undone:
 * - a call someone has already answered is never the one to go;
 * - a call whose 'start' carries no `startedAt` comes from a build that cannot
 *   step aside, so it is the one to join - its host accepts our offer like any
 *   other client's;
 * - otherwise the earlier call stays, which is also what the users expect: "who
 *   called first";
 * - a tie on time goes by a plain comparison of session ids. Not
 *   `localeCompare`, for the reason given at callHandledElsewhereOutcome().
 *
 * Symmetric by construction: `callCollisionWinner(a, b)` and
 * `callCollisionWinner(b, a)` name the same call.
 */
export function callCollisionWinner(
  a: CallCollisionParty, b: CallCollisionParty,
): 'a' | 'b' {
  if (a.established !== b.established) {
    return a.established ? 'a' : 'b';
  }
  const aKnown = (typeof a.startedAt === 'number');
  const bKnown = (typeof b.startedAt === 'number');
  if (aKnown !== bKnown) {
    return aKnown ? 'b' : 'a';
  }
  if (aKnown && bKnown && (a.startedAt !== b.startedAt)) {
    return (a.startedAt! < b.startedAt!) ? 'a' : 'b';
  }
  const aId = a.callSessionId ?? a.hostAddr;
  const bId = b.callSessionId ?? b.hostAddr;
  return (aId <= bId) ? 'a' : 'b';
}

/**
 * How rarely a device may re-send the host's heartbeat to its own neighbours.
 *
 * Under HEARTBEAT_INTERVAL (15s, utils/call.ts) on purpose, so that EVERY beat
 * of the host is passed on, and only the duplicate copies of one beat (ASMail's
 * blind repeats, a resend after a reported failure) are dropped.
 *
 * Relaying every second beat instead - 30s, which is what this feature was first
 * sketched with - would have given a neighbour that hears nothing from the host
 * a beat every 30s against a record that expires 50s after the last one: a
 * single lost relay, and its "Join Call" button goes out for half a minute and
 * comes back. Losses like that are routine on this transport, and the whole
 * point of the relay is a device with no other source of beats. At 15s the
 * neighbour is exactly as well served as anybody hearing the host directly -
 * HEARTBEAT_TIMEOUT covers two losses - and the cost is one small message to
 * one's own address per beat, only while a call this device may re-join is
 * going on.
 *
 * The first relay of a session is not throttled at all: that one carries the
 * button itself.
 */
export const REJOIN_RELAY_MIN_INTERVAL_MILLIS = 12_000;

/**
 * Whether to mirror a just-accepted heartbeat to this user's other devices.
 *
 * The case it exists for is a device that gets nothing at all from the host
 * while its neighbour gets everything - a platform defect, see `relayedRejoin`
 * in asmail-msgs.types.ts. A device that HAS the "Join Call" button knows two
 * facts its blind neighbour cannot learn: that the call is going on, and who
 * hosts it. Both are in the beat it just took, so passing that beat on costs
 * nothing to compute and lands on the one route that still works.
 *
 * Only from `rejoinable`, and only while not in the call:
 * - any other state means this device has no button to mirror. `ended` above
 *   all: the hold a yielded call puts on the user's other devices (see
 *   admitsHeartbeat) must not be undone by this device relaying beats to them;
 * - in the call, a relayed beat would invite a second device of one address
 *   into a call the host cannot tell the two apart in.
 *
 * `beatWasRelayed` is the loop protection: a relayed beat is never relayed on,
 * so no chain can be longer than one hop.
 */
export function shouldRelayRejoinBeat({
  state,
  inCall,
  beatWasRelayed,
  lastRelayAt,
  now,
}: {
  /** State of this chat's record AFTER the beat was noted. */
  state: CallState | undefined;
  /** Whether a live call object exists for this chat here. */
  inCall: boolean;
  /** Whether the beat just accepted was itself a relayed one. */
  beatWasRelayed: boolean;
  /** When this device last relayed a beat of this very session. */
  lastRelayAt: number | undefined;
  now: number;
}): boolean {
  if ((state !== 'rejoinable') || inCall || beatWasRelayed) {
    return false;
  }
  return (lastRelayAt === undefined)
    || ((now - lastRelayAt) >= REJOIN_RELAY_MIN_INTERVAL_MILLIS);
}

// =============================================================================
// Decisions
// =============================================================================

/**
 * How old a signal is, measured twice - because the two measurements fail
 * independently:
 *
 * - `fromSenderClock` comes from `webrtcMsg.id`, a Date.now() of the sender's
 *   machine. It survives a message sitting undelivered (the sender stamped it
 *   when the call actually rang), but a sender whose clock runs ahead makes an
 *   old signal look forever fresh.
 * - `sinceDelivery` comes from the message's `deliveryTS`, stamped by this
 *   side's own delivery. It is immune to the sender's clock, but a message
 *   delivered while a device was offline gets a fresh stamp on arrival.
 *
 * A signal is stale when EITHER says so: each measurement covers the other's
 * blind spot, and the cost of wrongly reviving a finished call (an incoming
 * call UI for a call that is over) is higher than that of dropping a live
 * signal, which confirmed delivery and re-sends already cover.
 */
export interface SignalAge {
  fromSenderClock: number;
  sinceDelivery: number;
}

export function isStaleAge(age: SignalAge): boolean {
  return (age.fromSenderClock > MAX_SIGNAL_AGE_MILLIS)
    || (age.sinceDelivery > MAX_SIGNAL_AGE_MILLIS);
}

/**
 * Why an incoming signal is or is not acted upon. Every value is logged, so
 * "the signal vanished" is never a possible reading of the logs.
 */
export type SignalVerdict =
  /** Act on it. */
  | 'accept'
  /** Belongs to a different session of this chat than the one we know. */
  | 'drop-foreign-session'
  /** Belongs to a session that has already ended. */
  | 'drop-ended-session'
  /** No session id, and a call here ended within the cooldown window. */
  | 'drop-recently-ended'
  /**
   * This call is being held on another device of ours. Unlike every other
   * `drop-*`, the message stays in the inbox: it is addressed to that device,
   * and the inbox is shared.
   */
  | 'drop-handled-elsewhere'
  /**
   * A re-send of 'start' was asked for by an address that is already in the
   * call. Peers are keyed by address, so the asking device is another one of
   * that person's, and answering would ring it in the middle of the call.
   */
  | 'drop-peer-connected'
  /** No session id, and the signal is older than signals may be. */
  | 'drop-stale'
  /** A call is going on here and this signal is not part of it. */
  | 'drop-in-call'
  /** The call is winding down or over; nothing to act on. */
  | 'drop-not-live'
  /** The asking peer is not a participant of the call it asks about. */
  | 'drop-not-participant'
  /** Only the host of a call can re-send its 'start'. */
  | 'drop-not-host'
  /**
   * 'start' of a call that ran into the call ringing here and lost the
   * tie-break (see callCollisionWinner).
   */
  | 'drop-superseded'
  /**
   * 'start' of a call that ran into the call ringing here and won the
   * tie-break: act on it, in place of the ringing one. Not 'accept', because
   * the caller has a call object to retire first.
   */
  | 'accept-superseding';

/**
 * Where an address stands in a call, as only the call object knows.
 * `invited` - it was offered the call but has not exchanged SDP with us;
 * `connected` - it has, so someone at that address is in the call.
 */
export type ParticipantState = 'unknown' | 'invited' | 'connected';

/** What a 'call-declined' from a peer does to the call it is about. */
export type DeclineOutcome =
  /** Not ours to act on. */
  | 'ignore'
  /** Note the peer as having declined, but keep the call going. */
  | 'note'
  /** The call is over: nobody is left to talk to. */
  | 'end-call';

/**
 * What a peer's explicit decline means for this call.
 *
 * Only 'end-call' in a one-to-one call, and that is the whole point: there the
 * declining peer *is* the other side, so waiting for anything else to end the
 * call leaves the caller's window open (nothing else is coming - a device that
 * declined never initialized a call role, so its `end()` sends no 'disconnect').
 * In a group call the same signal only says one invitee will not be joining.
 *
 * `peerIsConnected` is what keeps this from ending a live call: peers are keyed
 * by address, so a decline from an address that has already exchanged SDP with
 * us comes from *another device of that same person* dismissing its ringing UI,
 * not from the participant who is in the call.
 *
 * Pure, and separate from CallInChat, so every one of these rules is directly
 * testable - see "Decline policy" in tests-app/src/tests/video-chat.ts.
 */
export function declineEndsCall({ isGroupChat, role, callIsLive, peerIsConnected }: {
  isGroupChat: boolean;
  /** Our role in the call; `null` before a role was initialized. */
  role: 'host' | 'client' | null;
  /** Whether the call is still running here (not torn down, not yet started). */
  callIsLive: boolean;
  /** Whether that address has already exchanged SDP with us. */
  peerIsConnected: boolean;
}): DeclineOutcome {
  if (!callIsLive) {
    return 'ignore';
  }
  // Declines are addressed to the host: it is the one that invited the peer, and
  // the only side that keeps track of who was invited.
  if (role !== 'host') {
    return 'ignore';
  }
  if (peerIsConnected) {
    return 'ignore';
  }
  return isGroupChat ? 'note' : 'end-call';
}

/** Whether a "the call was cancelled" system message may end the call here. */
export type CallCancelSysMsgVerdict =
  /** Act on it. */
  | 'accept'
  /** It names no call, so there is no telling which one it is about. */
  | 'drop-no-session'
  /** It is about a different call than the one going on here. */
  | 'drop-foreign-session'
  /** Too old to be about a live call. */
  | 'drop-stale';

/**
 * Whether a `webrtc-call` system message ('incoming-call-cancelled') may end the
 * call that is on here.
 *
 * This message is the backup for the 'call-declined' signal: it travels the
 * ordinary delivery queue, so it survives a lost signal. What it does not have is
 * the signal's protection - `admitsSignal` refuses a signal of a session we are
 * not in - and it needs it more, not less: unlike a signal, it stays in the inbox
 * for days after being handled and the start-up catch-up scan replays it. An
 * unguarded one ended a call that had only just started, from a cancellation of a
 * call an hour and a half old.
 *
 * A message with no session id is refused rather than trusted: the sender is on a
 * build that predates the field, and the cost of being wrong is a live call torn
 * down. Such senders still get their call ended by the 'call-declined' signal
 * (confirmed delivery with retries) or, failing that, by the window's setup
 * timeout.
 *
 * Age is the secondary check, and deliberately so: it comes from clocks on two
 * different machines, while comparing session ids does not depend on clocks at
 * all. It covers the case where the ids happen to match - a replayed cancellation
 * of the very call we are in.
 */
export function admitsCallCancelSysMsg({ msgSessionId, callSessionId, msgAge }: {
  /** Session id the message names, if any. */
  msgSessionId: string | undefined;
  /** Session id of the call going on here, if any. */
  callSessionId: string | undefined;
  /** How long ago the message was delivered. */
  msgAge: number;
}): CallCancelSysMsgVerdict {
  if (!msgSessionId || !callSessionId) {
    return 'drop-no-session';
  }
  if (msgSessionId !== callSessionId) {
    return 'drop-foreign-session';
  }
  return (msgAge > MAX_SIGNAL_AGE_MILLIS) ? 'drop-stale' : 'accept';
}

/** Why a record was dropped by the watchdog. */
export type ExpiryReason = 'heartbeat-timeout' | 'provisional-timeout' | 'ended-retention';

export interface ExpiredSession {
  record: CallSessionRecord;
  reason: ExpiryReason;
}

export interface CallSessions {
  /** The record of this chat, or undefined when the chat is idle. */
  get(chatId: ChatIdObj): CallSessionRecord | undefined;
  state(chatId: ChatIdObj): CallState | undefined;
  /** Every record, for diagnostics. */
  all(): CallSessionRecord[];

  /**
   * Applies a transition. Returns false - leaving the record untouched - when
   * the transition is not allowed; callers log that and carry on, because
   * dropping a network-driven update is better than throwing out of a handler.
   */
  transit(
    chatId: ChatIdObj, to: CallState, now: number, patch?: CallSessionPatch,
  ): boolean;

  /** Forgets this chat's record entirely (back to `idle`). */
  drop(chatId: ChatIdObj): void;

  /**
   * Records a heartbeat from `hostAddr`, moving the chat to `rejoinable` (or
   * refreshing it). Call only after admitsHeartbeat() returned 'accept'.
   * Returns true when this made the chat newly re-joinable, i.e. when the
   * "Join Call" button has to appear.
   */
  noteHeartbeat(
    chatId: ChatIdObj, hostAddr: string, callSessionId: string | undefined, now: number,
  ): boolean;

  /**
   * Records that the host ended this call, whatever state the chat is in —
   * including `idle`, where a plain transit() would be refused ('ended' is not
   * an entry state) and the chat would be left with no memory of the call at
   * all. That memory is what suppresses the late heartbeats and signals of the
   * finished session; without it a 'disconnect' arriving after our own record
   * expired let the next straggling heartbeat resurrect the "Join Call" button.
   */
  noteRemoteEnded(
    chatId: ChatIdObj, now: number,
    patch: { hostAddr: string; callSessionId?: string },
  ): void;

  /**
   * Whether a 'start' from `sessionId` should create a call. `caller` - who
   * sent it and its `startedAt` - settles a collision with a call ringing here;
   * without it such a 'start' is refused as `drop-in-call`, as it always was.
   */
  admitsStart(
    chatId: ChatIdObj, sessionId: string | undefined, msgAge: SignalAge, now: number,
    caller?: { hostAddr: string; startedAt?: number },
  ): SignalVerdict;

  /** Whether a non-'start' signal should be handled or buffered. */
  admitsSignal(
    chatId: ChatIdObj, sessionId: string | undefined, msgAge: SignalAge, now: number,
  ): SignalVerdict;

  /** Whether a heartbeat should make the chat re-joinable. */
  admitsHeartbeat(
    chatId: ChatIdObj, sender: string, sessionId: string | undefined,
    msgAge: SignalAge, now: number,
  ): SignalVerdict;

  /**
   * Whether to honor a peer's request to re-send 'start' (its 'start' was lost
   * in delivery). `participantState` answers where the requester stands in this
   * call, which only the call object knows.
   */
  admitsRequestStart(
    chatId: ChatIdObj,
    requester: string,
    sessionId: string | undefined,
    participantState: (addr: string) => ParticipantState,
    now: number,
  ): SignalVerdict;

  /**
   * Notes the arrival of a signal of a call that is being held on another device
   * of ours, keeping that record from expiring while the call lasts.
   */
  noteSignalOfCallElsewhere(chatId: ChatIdObj, now: number): void;

  /** Records that timed out, removing them from the registry. */
  takeExpired(now: number): ExpiredSession[];

  /**
   * `ringing` records older than RINGING_NO_ANSWER_TIMEOUT_MILLIS. Unlike
   * takeExpired(), the records are NOT removed: a ringing call has a live
   * CallInChat behind it, and it is the caller's teardown of that object that
   * legitimately moves the record on (`ringing` -> `ended`), after which a
   * repeat call returns nothing. Removing the record here would leave the call
   * object orphaned and its inbox messages unaccounted for.
   */
  takeRingingTimeouts(now: number): CallSessionRecord[];
}

/**
 * Whether the session a signal claims is the session this record describes.
 * A signal with no session id, or a record with none, cannot be judged this
 * way - hence the third answer.
 */
function sessionMatch(
  record: CallSessionRecord, sessionId: string | undefined,
): 'same' | 'different' | 'unknown' {
  if (!sessionId || !record.callSessionId) {
    return 'unknown';
  }
  return (sessionId === record.callSessionId) ? 'same' : 'different';
}

/**
 * Whether this 'disconnect' withdraws a call that is still ringing here: the
 * user has not answered on this device, so it is not a participant of the call
 * and must send nothing back about it.
 *
 * `ringing` is the one live state whose end nothing else on this device would
 * learn about - an answered call winds its own window down, a declined one is
 * already over - and it is also the state in which the call object refuses
 * every signal, its callStage being 'not-started' until the user answers.
 *
 * Only the host of the ringing call may end it this way. The session check
 * repeats what admitsSignal already refused for a live record, so that the rule
 * holds on its own rather than by where it is called from.
 */
export function isHostEndingRingingCall(
  record: CallSessionRecord | undefined,
  sender: string,
  sessionId: string | undefined,
): boolean {
  if (!record || (record.state !== 'ringing') || !record.hostAddr) {
    return false;
  }
  return areAddressesEqual(record.hostAddr, sender)
    && (sessionMatch(record, sessionId) !== 'different');
}

export function createCallSessions(
  logIllegalTransition?: (from: CallState | undefined, to: CallState, chatId: ChatIdObj) => void,
): CallSessions {
  // Keyed by chatIdToString(): a chat is identified by the (isGroupChat, chatId)
  // pair, and keying by the bare chatId would let a group chat and a
  // one-to-one chat that happen to share the string collide.
  const sessions = new Map<string, CallSessionRecord>();

  function get(chatId: ChatIdObj): CallSessionRecord | undefined {
    return sessions.get(chatIdToString(chatId));
  }

  function transit(
    chatId: ChatIdObj, to: CallState, now: number, patch?: CallSessionPatch,
  ): boolean {
    const chatKey = chatIdToString(chatId);
    const current = sessions.get(chatKey);
    if (!canTransit(current?.state, to)) {
      logIllegalTransition?.(current?.state, to, chatId);
      return false;
    }
    sessions.set(chatKey, {
      ...(current ?? { chatId }),
      ...patch,
      // Every other field of the patch may deliberately clear itself with
      // `undefined` — `endedBy`, `provisional`, `lastBeat` all do, and their
      // meaning is about THIS device. `hostAddr` is not: it says who runs the
      // call, which is a fact about the call, so "I have nothing to say about
      // it" must not be recorded as "nobody hosts it".
      //
      // The path that says nothing is the terminal transition of a device that
      // never led the call: with no role initialized, call.ts has no hostAddr
      // to report (see the endState it builds), and the detach handler passes
      // that `undefined` straight in. On 2026-08-17 that erased the host from a
      // device which had merely yielded a ringing call to its neighbour — and
      // when the neighbour left and the user pressed "Join Call" there, the
      // hostless record sent it off to start a SECOND call in a chat whose call
      // was still going.
      hostAddr: patch?.hostAddr ?? current?.hostAddr,
      chatId,
      state: to,
      since: (current?.state === to) ? current.since : now,
    });
    return true;
  }

  function drop(chatId: ChatIdObj): void {
    sessions.delete(chatIdToString(chatId));
  }

  function noteRemoteEnded(
    chatId: ChatIdObj, now: number,
    patch: { hostAddr: string; callSessionId?: string },
  ): void {
    const chatKey = chatIdToString(chatId);
    const current = sessions.get(chatKey);
    if (current) {
      transit(chatId, 'ended', now, { ...patch, endedBy: 'host' });
      return;
    }
    // No record: write the terminal one directly. This is the single
    // deliberate exception to ENTRY_STATES — a host 'disconnect' that outlives
    // our own record must still leave a tombstone, which is what
    // ENDED_BY_HOST_RETENTION_MILLIS then keeps around to reject the rest of
    // that session's traffic.
    sessions.set(chatKey, {
      chatId,
      ...patch,
      state: 'ended',
      since: now,
      endedBy: 'host',
    });
  }

  function noteHeartbeat(
    chatId: ChatIdObj, hostAddr: string, callSessionId: string | undefined, now: number,
  ): boolean {
    const wasRejoinable = get(chatId)?.state === 'rejoinable';
    // A real heartbeat confirms the call is live, so the record is no longer a
    // provisional guess made on our way out of it.
    transit(chatId, 'rejoinable', now, {
      hostAddr,
      callSessionId,
      lastBeat: now,
      provisional: false,
      role: 'client',
      endedBy: undefined,
    });
    return !wasRejoinable;
  }

  /**
   * Shared part of admitsStart/admitsSignal: what a call that is *not live here*
   * - finished, winding down, or going on without us - says about a signal
   * addressed to it.
   */
  function verdictAfterCall(
    record: CallSessionRecord, sessionId: string | undefined, msgAge: SignalAge, now: number,
  ): SignalVerdict {
    switch (sessionMatch(record, sessionId)) {
      case 'same':
        // The id alone is proof: this signal belongs to a call we are not in.
        // `rejoinable` means that call is still going, just without us, so the
        // reason is "not live here" rather than "over".
        if (record.state === 'rejoinable') {
          return 'drop-not-live';
        }
        // Held on another device of ours: the signal is not ours to consume, and
        // its arrival is what keeps this record alive (see CallEndedBy).
        return (record.endedBy === 'other-device')
          ? 'drop-handled-elsewhere'
          : 'drop-ended-session';
      case 'different':
        // A different session of this chat: either the host started a new call
        // (legitimate) or this is a straggler of an older one. Only the caller
        // knows which, by signal kind, so accept and let the state rules decide.
        return 'accept';
      case 'unknown':
        // No session id on either side: fall back on time, as before.
        if (record.state === 'ended' && (now - record.since) <= RECENTLY_ENDED_COOLDOWN_MILLIS) {
          return 'drop-recently-ended';
        }
        return isStaleAge(msgAge) ? 'drop-stale' : 'accept';
    }
  }

  function admitsStart(
    chatId: ChatIdObj, sessionId: string | undefined, msgAge: SignalAge, now: number,
    caller?: { hostAddr: string; startedAt?: number },
  ): SignalVerdict {
    const record = get(chatId);
    if (!record) {
      // Nothing known about this chat: only the signal's own age can disqualify
      // a 'start' (e.g. delivered late after the app was offline).
      return isStaleAge(msgAge) ? 'drop-stale' : 'accept';
    }

    if (isLiveState(record.state)) {
      switch (sessionMatch(record, sessionId)) {
        case 'same':
          // A re-sent 'start' of the call we are already in: hand it to the
          // call object, which is idempotent about it.
          return 'accept';
        case 'different':
          // Someone is starting another call in a chat where we are already in
          // one. While 'dialing' it is a collision of two hosts, and the caller
          // settles it (it needs the call object's facts, which are not here).
          if (record.state === 'dialing') {
            return 'accept';
          }
          // Two hosts invited us at the same moment. Neither call has us yet,
          // so the one to ring for is the one both hosts are going to settle
          // on - not merely the one whose 'start' happened to arrive first.
          if ((record.state === 'ringing') && caller && record.hostAddr
            && !isStaleAge(msgAge)) {
            const winner = callCollisionWinner(
              {
                hostAddr: record.hostAddr,
                callSessionId: record.callSessionId,
                startedAt: record.startedAt,
                established: false,
              },
              {
                hostAddr: caller.hostAddr,
                callSessionId: sessionId,
                startedAt: caller.startedAt,
                established: false,
              },
            );
            return (winner === 'b') ? 'accept-superseding' : 'drop-superseded';
          }
          return 'drop-in-call';
        case 'unknown':
          return 'accept';
      }
    }

    return verdictAfterCall(record, sessionId, msgAge, now);
  }

  function admitsSignal(
    chatId: ChatIdObj, sessionId: string | undefined, msgAge: SignalAge, now: number,
  ): SignalVerdict {
    const record = get(chatId);
    if (!record) {
      return isStaleAge(msgAge) ? 'drop-stale' : 'accept';
    }

    if (isLiveState(record.state)) {
      const match = sessionMatch(record, sessionId);
      return (match === 'different') ? 'drop-foreign-session' : 'accept';
    }

    return verdictAfterCall(record, sessionId, msgAge, now);
  }

  function admitsHeartbeat(
    chatId: ChatIdObj, sender: string, sessionId: string | undefined,
    msgAge: SignalAge, now: number,
  ): SignalVerdict {
    // Age first, before any state reasoning: a stale heartbeat proves nothing
    // about the call being live now, and losing one is harmless because the
    // next beat is 15s away. This is what keeps the beats still in flight
    // behind a host that has already gone from resurrecting the call.
    if ((msgAge.fromSenderClock > HEARTBEAT_MAX_AGE_MILLIS)
      || (msgAge.sinceDelivery > HEARTBEAT_MAX_AGE_MILLIS)) {
      return 'drop-stale';
    }

    const record = get(chatId);
    if (!record) {
      return 'accept';
    }

    if (isLiveState(record.state) || record.state === 'winding-down') {
      // We are in this call (or leaving it): a "you may join" invitation is
      // meaningless and would show a "Join Call" button to someone already in.
      return 'drop-in-call';
    }

    if (record.state === 'ended' && record.endedBy === 'other-device') {
      // Another device of ours holds this call. A "you may join" invitation
      // would put a Join button in front of a user who is already in the call -
      // on their other device - and taking it would make two devices of one
      // address participants of one call, which the host cannot even tell apart
      // (peers are keyed by address). Seen in the live run of 2026-08-16: the
      // device that had just yielded the call offered to join it seconds later.
      //
      // Only for the session that is being held: a heartbeat of a different one
      // is a new call, and nothing about this record has anything to say about
      // it. The hold ends when the device holding the call says it left (see
      // handleCallHandledElsewhere), and, failing that, when this record expires
      // for want of that call's signalling.
      switch (sessionMatch(record, sessionId)) {
        case 'different':
          return 'accept';
        case 'same':
        case 'unknown':
          return 'drop-handled-elsewhere';
      }
    }

    if (record.state === 'ended' && record.endedBy === 'host') {
      // The host announced the end of the call. A heartbeat of that same
      // session, however late, must not resurrect the "Join Call" button;
      // one from a new session is a new call and is welcome.
      switch (sessionMatch(record, sessionId)) {
        case 'same':
          return 'drop-ended-session';
        case 'different':
          return 'accept';
        case 'unknown':
          // No session ids: suppress by time, and only from the host that made
          // the announcement - a stray 'disconnect' from a non-host peer must
          // not be able to hide a genuinely live call.
          return ((now - record.since) <= HOST_ENDED_SUPPRESS_MILLIS
            && !!record.hostAddr && areAddressesEqual(record.hostAddr, sender))
            ? 'drop-ended-session'
            : 'accept';
      }
    }

    return 'accept';
  }

  function admitsRequestStart(
    chatId: ChatIdObj,
    requester: string,
    sessionId: string | undefined,
    participantState: (addr: string) => ParticipantState,
    now: number,
  ): SignalVerdict {
    const record = get(chatId);
    if (!record) {
      return 'drop-not-live';
    }

    // Only the host issues 'start'. Without this, a client accepts the request
    // too, because for a client `isExpectedParticipant` is true of the host
    // address (hasPeer() in call.ts) - and the requester of an orphaned signal
    // reaching a *host's* second device is the client. That client would then
    // send a 'start' to the host address, opening an incoming-call window, with
    // its own peer as the caller, on the host's other device.
    if (record.role !== 'host') {
      return 'drop-not-host';
    }

    if (!isLiveState(record.state)) {
      // Re-sending 'start' for a call that is over is exactly what re-opened
      // the incoming-call UI after a 1-1 call ended (the "second ringtone").
      const match = sessionMatch(record, sessionId);
      if (match === 'same' || record.state === 'winding-down') {
        return 'drop-not-live';
      }
      return (match === 'unknown'
        && record.state === 'ended'
        && (now - record.since) <= RECENTLY_ENDED_COOLDOWN_MILLIS)
        ? 'drop-recently-ended'
        : 'drop-not-live';
    }

    if (sessionMatch(record, sessionId) === 'different') {
      return 'drop-foreign-session';
    }

    switch (participantState(requester)) {
      case 'unknown':
        return 'drop-not-participant';
      case 'connected':
        // That address has exchanged SDP with us, so it *is* in this call. Peers
        // are keyed by address, so the asker is another device of that person -
        // one that dropped its own copy of the call when the user answered
        // elsewhere, and has since forgotten the session. Re-sending 'start'
        // there makes it ring in the middle of a call it is already part of.
        //
        // Same reasoning as ignoring 'callDeclined' from a connected address
        // (handleSignalAsHost in call.ts).
        return 'drop-peer-connected';
      case 'invited':
        return 'accept';
    }
  }

  /**
   * Notes that a signal of a session finished *here* but going on elsewhere has
   * just arrived, which is what keeps the record from expiring mid-call. A no-op
   * for any other record: nothing else measures its life by signals.
   */
  function noteSignalOfCallElsewhere(chatId: ChatIdObj, now: number): void {
    const record = get(chatId);
    if (record?.endedBy === 'other-device') {
      record.lastSignal = now;
    }
  }

  function takeExpired(now: number): ExpiredSession[] {
    const expired: ExpiredSession[] = [];
    for (const [chatKey, record] of sessions.entries()) {
      const reason = expiryOf(record, now);
      if (reason) {
        sessions.delete(chatKey);
        expired.push({ record, reason });
      }
    }
    return expired;
  }

  function takeRingingTimeouts(now: number): CallSessionRecord[] {
    // Records stay in the registry (see the interface note): the caller ends
    // the live call object, whose teardown moves `ringing` to `ended` - and
    // that is what keeps this from returning the same record twice.
    return Array.from(sessions.values()).filter(record =>
      (record.state === 'ringing')
      && ((now - record.since) > RINGING_NO_ANSWER_TIMEOUT_MILLIS)
    );
  }

  return {
    get,
    state: chatId => get(chatId)?.state,
    all: () => Array.from(sessions.values()),
    transit,
    drop,
    noteHeartbeat,
    noteRemoteEnded,
    admitsStart,
    admitsSignal,
    admitsHeartbeat,
    admitsRequestStart,
    noteSignalOfCallElsewhere,
    takeExpired,
    takeRingingTimeouts,
  };
}

/**
 * The call a "Join Call" button leads into, or `undefined` when there is none
 * to name.
 *
 * Pressing that button must put this device into the call that is going on -
 * as a CLIENT of its host. The alternative, starting a call of our own in the
 * same chat, is not a fallback but a fresh problem: the participants of the
 * live call drop the new invitation as `drop-in-call`, their host's 'disconnect'
 * later reaches us as `drop-foreign-session`, and the chat records an outgoing
 * call that nobody was ever in. That is exactly what a hostless `rejoinable`
 * record produced on 2026-08-17, so the question "whom do we join?" is asked
 * here, once, and a refusal is a refusal - never a licence to start something
 * else.
 *
 * The session id is the second place the host's address is written down
 * (`<host>#<device>-<n>`), and it is consulted when the field itself is empty:
 * a record can be missing the field and still know perfectly well whose call it
 * describes. `hostAddrOfCallSession` returns undefined for anything that is not
 * of that shape, including ids minted by builds that predate it.
 */
export function rejoinTargetOf(
  record: CallSessionRecord | undefined, ownAddr: string,
): { hostAddr: string; callSessionId?: string } | undefined {
  if (record?.state !== 'rejoinable') {
    return undefined;
  }
  const hostAddr = record.hostAddr || hostAddrOfCallSession(record.callSessionId);
  if (!hostAddr) {
    return undefined;
  }
  if (areAddressesEqual(hostAddr, ownAddr)) {
    // A re-joinable record is a client's record of somebody else's call (see
    // the endState in call.ts, which only ever calls a client's departure
    // re-joinable). One naming us as the host contradicts itself, and joining
    // ourselves is not a thing that can be done.
    return undefined;
  }
  return { hostAddr, callSessionId: record.callSessionId };
}

/**
 * Whether a record has outlived its purpose. Live states have no timeout here:
 * a call in progress is torn down by its own paths (GUI close, 'disconnect',
 * ICE failure), never by this sweep.
 */
export function expiryOf(record: CallSessionRecord, now: number): ExpiryReason | undefined {
  if (record.state === 'rejoinable') {
    const age = now - (record.lastBeat ?? record.since);
    if (record.provisional) {
      return (age > PROVISIONAL_REJOIN_TIMEOUT) ? 'provisional-timeout' : undefined;
    }
    return (age > HEARTBEAT_TIMEOUT) ? 'heartbeat-timeout' : undefined;
  }
  if (record.state === 'ended') {
    // Measured from the last signal of this session where there is one: a call
    // held on another device of ours goes on for as long as its signalling does,
    // and forgetting it mid-call is what made this device ring again. Still a
    // memory bound - the record goes once the signalling stops.
    //
    // A host-ended call is remembered much longer: dropping the record is what
    // lets a replayed 'start' of that very session ring again (the id can no
    // longer be recognized), and only the host's end is final enough to justify
    // the longer suppression.
    const age = now - (record.lastSignal ?? record.since);
    const retention = (record.endedBy === 'host')
      ? ENDED_BY_HOST_RETENTION_MILLIS
      : ENDED_SESSION_RETENTION_MILLIS;
    return (age > retention) ? 'ended-retention' : undefined;
  }
  return undefined;
}
