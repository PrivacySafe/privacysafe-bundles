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
 * Reactive resending of heartbeat deliveries the platform reported as failed.
 *
 * A heartbeat is what holds a departed participant's "Join Call" button on, and
 * losing enough of them in a row takes the button off a call that is still
 * running (see HEARTBEAT_TIMEOUT in call-state.ts for the survival arithmetic).
 * The ASMail server 500s in bursts, so the losses come in runs.
 *
 * Why a resend and not delivery confirmation: a heartbeat is a ~250 B multicast
 * every 15 s, and holding a confirmation session open for 20-25 s per tick — for
 * every peer, for the whole call — is the opposite of what the 500s call for. A
 * resend costs one extra message and only when a failure was actually reported.
 *
 * Two bounds, and both matter:
 *
 * - **Budget** (RESEND_BUDGET per call): the failure being reacted to is the
 *   server answering 500 to a burst, so an unbounded "failed, send again" loop
 *   would feed the storm that caused it.
 * - **Age** (MAX_TICK_AGE_MILLIS): a resend is only worth anything while the
 *   tick it replaces is still fresher than the next scheduled one. This also
 *   makes the whole mechanism self-limiting with respect to a question we have
 *   not measured yet — how fast the platform reports a delivery outcome. If the
 *   report takes longer than this, no resend is ever attempted and nothing is
 *   made worse; see the `report-latency` case in
 *   tests-app/src/tests/asmail-group-call-load.ts, which measures it.
 *
 * A leaf module on purpose: it must not pull in the mail-sending service (and
 * through it the storage stack), because the delivery monitor imports it. Hence
 * the caller hands in a `resend` closure rather than this module assembling a
 * heartbeat of its own.
 */

import { makeLogger } from '../../../../shared-libs/logger.ts';

const log = makeLogger('HeartbeatDelivery');

/** How many resends all heartbeat ticks of ONE call may trigger between them. */
const RESEND_BUDGET = 2;

/**
 * How old a tick may be when its failure is reported and still be worth
 * resending. Below HEARTBEAT_INTERVAL (15 s, call.ts): past that the next
 * regular tick is already due, and it carries the same message.
 */
const MAX_TICK_AGE_MILLIS = 12_000;

/**
 * Safety valve against leaking entries when the platform reports no terminal
 * event for a delivery. Well past MAX_TICK_AGE_MILLIS, since an entry older than
 * that is refused a resend anyway.
 */
const REGISTRATION_TTL_MILLIS = 60_000;

interface HeartbeatDelivery {
  /** Which call this tick belongs to; the key `forgetCall` takes. */
  callKey: string;
  /** When the tick was handed to the delivery sub-system. */
  sentAt: number;
  /** `false` once this call is over — a beat accepted after it re-lights Join. */
  stillNeeded: () => boolean;
  /** Sends this tick again, to the named recipients only. */
  resend: (recipients: string[]) => Promise<void>;
}

const pending = new Map<string, HeartbeatDelivery>();
const resendsLeft = new Map<string, number>();

function dropExpired(now: number): void {
  const cutOff = now - REGISTRATION_TTL_MILLIS;
  for (const [id, entry] of pending) {
    if (entry.sentAt < cutOff) {
      pending.delete(id);
    }
  }
}

/**
 * Notes a heartbeat delivery so that its reported failure can be answered.
 * Must be called BEFORE the send: the monitor's event may arrive as soon as
 * addMsg() resolves, and an unregistered delivery is an unrecoverable one.
 */
export function registerHeartbeatDelivery(
  deliveryId: string, entry: HeartbeatDelivery,
): void {
  dropExpired(entry.sentAt);
  pending.set(deliveryId, entry);
}

/**
 * Everything this call had in flight is now irrelevant, and its resend budget
 * goes back. Called from CallInChat.end(): a heartbeat that lands after the call
 * is over switches the recipient's "Join Call" button back on (the 'unknown'
 * branch of admitsHeartbeat), with nothing left to clear it.
 */
export function forgetHeartbeatDeliveriesOf(callKey: string): void {
  for (const [id, entry] of pending) {
    if (entry.callKey === callKey) {
      pending.delete(id);
    }
  }
  resendsLeft.delete(callKey);
}

/**
 * Feeds a terminal delivery event of a heartbeat back to its sender, resending
 * to the recipients that failed if it is still worth it.
 *
 * @returns whether a resend was dispatched.
 */
export function noteHeartbeatDeliveryOutcome(
  deliveryId: string, progress: web3n.asmail.DeliveryProgress, now = Date.now(),
): boolean {
  const entry = pending.get(deliveryId);
  if (!entry) {
    return false;
  }
  pending.delete(deliveryId);
  if (progress.allDone !== 'with-errors') {
    return false;
  }

  const failed = Object.entries(progress.recipients ?? {})
    .filter(([, r]) => r.err)
    .map(([addr]) => addr);
  if (failed.length === 0) {
    return false;
  }

  if (!entry.stillNeeded()) {
    return false;
  }

  const age = now - entry.sentAt;
  if (age > MAX_TICK_AGE_MILLIS) {
    log.debug(
      `Heartbeat delivery ${deliveryId} failed for ${failed.join(', ')} but is `
        + `already ${age}ms old; the next regular tick supersedes it`,
    );
    return false;
  }

  const left = resendsLeft.get(entry.callKey) ?? RESEND_BUDGET;
  if (left <= 0) {
    log.debug(
      `Heartbeat delivery ${deliveryId} failed for ${failed.join(', ')} with no `
        + `resends left for this call`,
    );
    return false;
  }
  resendsLeft.set(entry.callKey, left - 1);

  log.warn(
    `Heartbeat delivery ${deliveryId} failed for ${failed.join(', ')} `
      + `(${age}ms ago); resending to them (${left - 1} resend(s) left this call)`,
  );
  entry.resend(failed).catch(err => {
    w3n.log('error', `Failed to resend heartbeat to ${failed.join(', ')}`, err);
  });
  return true;
}
