/*
 Copyright (C) 2024 3NSoft Inc.

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

import { areAddressesEqual } from './address-utils.ts';
import { filter, streamFrom } from './stream-utils.ts';
import { makeLogger } from './logger.ts';

type IncomingMessage = web3n.asmail.IncomingMessage;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type DeliveryProgress = web3n.asmail.DeliveryProgress;

// Trace of the per-delivery confirmation path (runs only while
// CONFIRM_DELIVERY_ENABLED is on): `debug` for the normal flow, `warn` for an
// unconfirmed outcome. Verified live on 2026-08-10: the platform's events DO
// arrive (both via observeDelivery(id) and observeAllDeliveries), the problem
// is 7-12s delivery latency per tiny signal — see CONFIRM_DELIVERY_ENABLED in
// webrtc-signalling.ts. Bare console.log is useless here: the production Deno
// bundle drops console entirely (ci/build-deno.js `drop: ['console']`), only
// w3n.log survives.
const confirmLog = makeLogger('DeliveryConfirm');

/**
 * One-line summary of a DeliveryProgress for the experiment trace: allDone
 * plus per-recipient byte counts and error flags, without the full JSON noise.
 */
function describeProgress(p: DeliveryProgress | undefined): string {
  if (!p) {
    return 'record unknown';
  }
  const recips = Object.entries(p.recipients ?? {}).map(([addr, r]) =>
    `${addr}: done=${r.done}, bytesSent=${r.bytesSent ?? 0}`
      + `${r.awaitingRetry ? ', awaitingRetry' : ''}`
      + `${r.idOnDelivery ? ', hasIdOnDelivery' : ''}`
      + `${r.err ? `, err=${JSON.stringify(r.err)}` : ''}`
  ).join('; ');
  return `allDone=${p.allDone ?? 'not-yet'}`
    + `${p.notConnected ? ', notConnected' : ''} { ${recips} }`;
}

export type MsgType = 'chat';

export function watchIncomingMsgs(
  msgType: MsgType,
): ReadableStream<IncomingMessage> {
  return streamFrom<IncomingMessage>(
    obs => w3n.mail!.inbox.subscribe('message', obs),
  ).pipeThrough(filter(m => (m.msgType === msgType)));
}

export async function sendMsg(
  msg: OutgoingMessage,
  progress?: (p: DeliveryProgress) => void,
) {
  if (!msg.recipients || (msg.recipients.length === 0)) {
    throw new Error(`No recipients given in the message`);
  }
  const recipients = msg.recipients.concat();
  msg.carbonCopy?.forEach(addr => {
    if (!recipients.find(a => areAddressesEqual(a, addr))) {
      recipients.push(addr);
    }
  });
  const deliveryId = `#${Date.now()}-${Math.floor(Number.MAX_SAFE_INTEGER * Math.random())}`;
  await w3n.mail!.delivery.addMsg(recipients, msg, deliveryId);
  try {
    await new Promise<void>((resolve, reject) => {
      let isDone = false;
      w3n.mail!.delivery.observeDelivery(deliveryId, {
        next: p => {
          if (isDone) {
            return;
          }
          try {
            progress?.(p);
          } catch (err) {
            w3n.log('error', JSON.stringify(err), err);
          }
          if (p.allDone) {
            isDone = true;
            if (p.allDone === 'all-ok') {
              resolve();
            } else if (p.allDone === 'with-errors') {
              reject(p);
            }
          }
        },
        complete: () => {
          if (!isDone) {
            isDone = true;
            resolve();
          }
        },
        error: err => {
          if (!isDone) {
            isDone = true;
            reject(err);
          }
        },
      });
    });
  } finally {
    w3n.mail!.delivery.rmMsg(deliveryId).catch(err => w3n.log('error', JSON.stringify(err), err));
  }
}

export interface DeliveryConfirmationResult {
  ok: boolean;
  err?: unknown;
}

/**
 * What a confirmation timeout resolves with instead of a bare 'timeout'
 * string: the last delivery state seen before giving up, so the log can tell
 * "recipient's server never took a byte" from "delivery was merely slow".
 */
export interface DeliveryConfirmationTimeout {
  timeout: true;
  timeoutMs: number;
  lastProgress?: DeliveryProgress;
}

/**
 * The part of the delivery service that delivery confirmation needs. Named so
 * that a test can hand in a fake one: the races this code exists to close are
 * about *when* events arrive relative to the subscription, which is not
 * reproducible against the real platform.
 */
export type DeliveryApiForConfirmation = Pick<
  web3n.asmail.DeliveryService, 'addMsg' | 'observeDelivery' | 'currentState'
>;

/**
 * Sends a message via ASMail and waits for actual delivery confirmation
 * (as opposed to just waiting for `addMsg()` to resolve, which only means
 * that core has accepted the message into its delivery sub-system).
 *
 * This is intended for latency-critical, singular signalling messages
 * (e.g. WebRTC offer/answer/disconnect) where the caller needs to know for
 * sure whether the message actually reached the recipient's server, so it
 * can react (e.g. retry) without waiting on a blind timeout.
 *
 * Unlike `sendMsg()`, this function does NOT call `rmMsg()` on the
 * delivered/failed message — cleanup of completed deliveries for webrtc
 * signalling is handled elsewhere (via `localMeta` + a delivery monitor),
 * since removing the message here races with that cleanup.
 *
 * @param recipients addresses to send message to
 * @param msg the message to send
 * @param deliveryId id used to add and track this message in delivery sub-system
 * @param opts optional delivery options (e.g. sendImmediately, localMeta)
 * @param timeoutMs how long to wait for delivery confirmation before giving
 * up and resolving with `{ ok: false, err: DeliveryConfirmationTimeout }`.
 * This does not cancel
 * the actual delivery, only stops this function from waiting for it. The
 * default must stay above the latency ASMail actually shows for signalling
 * payloads (a multi-KB SDP has been observed to take 10s+ to be accepted):
 * a timeout below it turns every send into a false "NOT confirmed", and the
 * callers' retry watchers then flood the channel with duplicates.
 * @param deliveryApi the delivery service to use; the platform's own by
 * default, injectable for tests.
 */
export async function sendMsgWithDeliveryConfirmation(
  recipients: string[],
  msg: OutgoingMessage,
  deliveryId: string,
  opts?: web3n.asmail.DeliveryOptions,
  timeoutMs = 30_000,
  deliveryApi: DeliveryApiForConfirmation = w3n.mail!.delivery,
): Promise<DeliveryConfirmationResult> {
  const t0 = Date.now();
  confirmLog.debug(
    `[${deliveryId}] confirm-send start: to ${recipients.join(', ')}, timeoutMs=${timeoutMs}`,
  );
  await deliveryApi.addMsg(recipients, msg, deliveryId, opts);
  confirmLog.debug(`[${deliveryId}] addMsg() resolved in ${Date.now() - t0}ms`);
  return new Promise<DeliveryConfirmationResult>(resolve => {
    let isDone = false;
    // Kept for the timeout outcome: a bare 'timeout' hides whether any bytes
    // ever reached the recipient's server.
    let lastProgress: DeliveryProgress | undefined = undefined;
    // Declared up here, and cleaned up only if they were ever set: observing is
    // documented to make callbacks hot, so `next` may well be called from inside
    // observeDelivery() below - before either of these exists. Reaching for a
    // `const` from that call would throw out of the subscription (a temporal
    // dead zone error), which the caller then reports as a failure to send a
    // signal that was in fact on its way.
    let detach: (() => void) | undefined = undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined;

    const finish = (result: DeliveryConfirmationResult) => {
      if (isDone) {
        return;
      }
      isDone = true;
      const finishLine = `[${deliveryId}] confirm-send finished in ${Date.now() - t0}ms: `
        + `ok=${result.ok}${result.err ? `, err=${JSON.stringify(result.err)}` : ''}`;
      if (result.ok) {
        confirmLog.debug(finishLine);
      } else {
        confirmLog.warn(finishLine);
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      detach?.();
      resolve(result);
    };

    /**
     * What the delivery sub-system says about this message right now.
     *
     * Needed because observing alone misses events: `addMsg()` above has to
     * resolve before there is an id to observe, and by then the delivery may
     * well be over - `sendImmediately: true` (every webrtc signal) makes that
     * the common case, not a corner one. Worse, delivery-monitor.ts drops the
     * completed delivery record on `allDone` (rmMsg), so a subscription that
     * arrives late gets neither `next` nor `complete`, and the only thing left
     * to fire is the timeout below. That is where the "NOT confirmed ...
     * timeout" lines for messages that were in fact delivered came from.
     *
     * An unknown id means exactly that cleanup: `addMsg()` did register it, and
     * `rmMsg()` without `cancelSending` only removes a delivery that has
     * completed. So "unknown" is read as delivered - said in its own words in
     * the log, to keep it distinguishable in diagnostics. (`rmMsg(id, true)`
     * would break that reading, but nothing cancels a signalling delivery.)
     */
    const finishFromCurrentState = async (whenUnknown: string) => {
      let state: DeliveryProgress | undefined;
      try {
        state = await deliveryApi.currentState(deliveryId);
      } catch (err) {
        // Nothing to conclude from a failed lookup: leave it to the observer
        // and the timeout.
        confirmLog.debug(
          `[${deliveryId}] currentState() at +${Date.now() - t0}ms threw: ${JSON.stringify(err)}`,
        );
        return;
      }
      confirmLog.debug(
        `[${deliveryId}] currentState() at +${Date.now() - t0}ms: ${describeProgress(state)}`,
      );
      if (isDone) {
        return;
      }
      if (!state) {
        // Settled before it is logged: what this function concludes must not
        // hinge on the log going through.
        finish({ ok: true });
        w3n.log('info', `Delivery ${deliveryId} ${whenUnknown}`).catch(() => {});
      } else if (state.allDone === 'all-ok') {
        finish({ ok: true });
      } else if (state.allDone === 'with-errors') {
        finish({ ok: false, err: state });
      } else {
        lastProgress = state;
      }
    };

    const detacher = deliveryApi.observeDelivery(deliveryId, {
      next: p => {
        confirmLog.debug(
          `[${deliveryId}] observeDelivery.next at +${Date.now() - t0}ms: ${describeProgress(p)}`,
        );
        if (p.allDone === 'all-ok') {
          finish({ ok: true });
        } else if (p.allDone === 'with-errors') {
          finish({ ok: false, err: p });
        } else {
          lastProgress = p;
        }
      },
      complete: () => {
        confirmLog.debug(`[${deliveryId}] observeDelivery.complete at +${Date.now() - t0}ms`);
        finish({ ok: true });
      },
      error: err => {
        confirmLog.debug(
          `[${deliveryId}] observeDelivery.error at +${Date.now() - t0}ms: ${JSON.stringify(err)}`,
        );
        // The platform answers a subscription to an unknown id with
        // `error({ msgNotFound: true })`. Unknown means the same thing as the
        // `!state` branch of finishFromCurrentState() above: the delivery
        // completed and its record was already cleaned up. A confirmation,
        // not a failure.
        if ((err as web3n.asmail.ASMailSendException)?.msgNotFound === true) {
          finish({ ok: true });
          w3n.log(
            'info',
            `Delivery ${deliveryId} confirmed: observing found its record already cleaned up`,
          ).catch(() => {});
        } else {
          finish({ ok: false, err });
        }
      },
    });
    if (isDone) {
      // Settled from inside the subscription, so there is nothing left to wait
      // for and the detacher is ours to call.
      detacher();
      return;
    }
    detach = detacher;

    // Subscribe first, take the snapshot second: an event from before the
    // subscription shows up in the snapshot, one from after arrives at the
    // observer, and no ordering leaves both empty.
    void finishFromCurrentState('confirmed: its delivery record was already cleaned up');

    timeoutId = setTimeout(() => {
      // The record may have been cleaned up after the subscription too, in
      // which case no terminal event ever comes; ask once more before calling
      // this a failure. `finish` is a no-op once the snapshot has settled it.
      void finishFromCurrentState(
        'confirmed at timeout: its delivery record was already cleaned up',
      ).then(() => finish({
        ok: false,
        err: { timeout: true, timeoutMs, lastProgress } satisfies DeliveryConfirmationTimeout,
      }));
    }, timeoutMs);
  });
}
