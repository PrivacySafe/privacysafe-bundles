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
 * The single place that puts a WebRTC signal onto ASMail.
 *
 * Signalling is generated on both sides of the app - the background (call
 * stages: start/disconnect/heartbeat) and the call window (Star signals:
 * offer/answer/candidate/...) - and both used to assemble the very same
 * message body, compute its size for diagnostics, choose between confirmed and
 * fire-and-forget delivery, and log the outcome, each with its own copy of that
 * code. Only the *policy* legitimately differs between them, so the policy is
 * what callers pass in:
 *
 * | Caller | Confirms | Retries |
 * |---|---|---|
 * | background, keyed by `stage` | `start`, `disconnect` | `disconnect` x2 |
 * | call window, keyed by `signalType` | `offer`, `answer`, `disconnect`, `call-full` | none - `createRetryWatcher` owns them |
 *
 * What goes into `WebRTCMsg.data` is also the caller's business: the window
 * packs a `StarSignalData` into `description.sdp`, the background puts call
 * stage payloads there directly.
 */

import type {
  ChatIdObj,
  ChatOutgoingMessage,
  ChatWebRTCMsgV1,
  WebRTCMsg,
} from '../types/asmail-msgs.types.ts';
import type { DeliveryApiForConfirmation } from './asmail-utils.ts';
import { sendMsgWithDeliveryConfirmation } from './asmail-utils.ts';
import { sleep } from './processes/sleep.ts';
import { withoutBlockedRecipients } from './blocked-recipients.ts';
import { makeLogger } from './logger.ts';

const log = makeLogger('WebRTCSignalling');

/**
 * Master switch for delivery confirmation of WebRTC signals.
 *
 * The platform's confirmation path works end to end (verified 2026-08-10 via the
 * DeliveryConfirm trace in asmail-utils.ts: observeDelivery(id) and
 * observeAllDeliveries both report `allDone` for the same deliveryId), but it is
 * SLOW — 7-12 s from addMsg() to `all-ok` for a ~200 B signal, more for a
 * multi-KB SDP. So the only question this flag ever asked is whether the callers
 * can afford to wait that long before hearing the outcome.
 *
 * It was `false` from 4b7d4ed, when the negotiation retry timers were 4-8 s and a
 * confirmed send blocked past the first retry: the watchers fired while the
 * confirmation was still pending, and the resulting duplicate/glare storm
 * collapsed the very call the confirmation was meant to protect. The very next
 * commit (801d1f6) moved those timers to 45-60 s
 * (NEGOTIATION_RETRY_DELAYS/ANSWER_RETRY_DELAYS in host-channel.ts,
 * OFFER_RETRY_DELAYS in client-channel.ts) and nobody came back to the flag. With
 * a 20-25 s confirmation window and a first retry at 45 s the two no longer
 * overlap, which is why it is `true` again.
 *
 * Confirming is also the strongest lever against the HTTP 500s the ASMail server
 * returns while its disk is degraded (2026-08-13: 500s for minutes at only 1-3
 * parallel deliveries): the blind repeats are skipped entirely when a signal is
 * confirmed (`if (blindRepeats && !confirm)` below), so a 'start' or 'disconnect'
 * becomes ONE delivery plus a retry only on real failure, instead of four
 * unconditional copies.
 *
 * Confirmation does not replace application-level reliability, it sits on top of
 * it: retry watchers still re-send unanswered offers/answers, an answer still
 * acknowledges an offer, and an open DataChannel still acknowledges everything.
 *
 * Flip back to `false` if the negotiation timers are ever shortened again below
 * the confirmation window, or if `observeDelivery` starts losing terminal events
 * often enough that timeouts outnumber real failures (§2 of
 * plans/core-platform-recommendations-2026-08-10.md).
 */
export const CONFIRM_DELIVERY_ENABLED = true;

export interface WebRTCSignalDelivery {
  chatId: ChatIdObj;
  /** Address to send this signal to. */
  recipient: string;
  /** Complete signal, including `callSessionId` if the caller has one. */
  webrtcMsg: WebRTCMsg;
  /** Prefix of the generated delivery id, to tell callers apart in logs. */
  deliveryIdPrefix: string;
  /** Log label of the calling side, e.g. `[sendWebRTCMsg]`. */
  logLabel: string;
  /**
   * Whether to wait for delivery confirmation instead of firing and forgetting.
   * Worth it only for singular signals whose loss the caller can react to.
   * Globally gated by CONFIRM_DELIVERY_ENABLED: while that is `false`, every
   * send is fire-and-forget regardless of this field, which keeps the callers'
   * policy (which signals *deserve* confirmation) intact for when the platform
   * confirmation path works again.
   */
  confirm: boolean;
  /**
   * Re-sends after a *confirmed* delivery came back unconfirmed. Meaningless
   * without `confirm`, since fire-and-forget never reports failure.
   */
  retries?: { attempts: number; delayMillis: number };
  /**
   * How long to wait for delivery confirmation before reporting the send as
   * unconfirmed. Meaningless without `confirm`. Defaults to the transport's
   * own 30s cap; callers whose retry watchers can react sooner pass a smaller
   * value.
   */
  confirmTimeoutMs?: number;
  /**
   * Unconditional fire-and-forget re-sends of the same signal (a fresh delivery
   * id each) at the given delays, measured from this call. A stand-in for
   * confirm+retry, and SKIPPED ENTIRELY when the send is confirmed (see the
   * `!confirm` condition at the bottom of sendWebRTCSignal): one-shot signals
   * with no other recovery path (disconnect, call-full, call-declined,
   * call-handled-elsewhere) get further chances without waiting on a
   * confirmation that is not being awaited. Receivers of these signals are
   * idempotent, so the duplicates are harmless. The repeats are detached: this
   * call resolves without waiting for them.
   *
   * That skip is the point of confirming at all where the server is the
   * bottleneck: with CONFIRM_DELIVERY_ENABLED on, a departure costs one delivery
   * instead of four, and a retry happens only when a failure was actually
   * reported. The schedules stay in the callers as the fallback for the flag
   * being turned off again.
   *
   * Spread the delays past the transport's own bad spells rather than bunching
   * them: a 500-storm on the server (which is what makes a teardown signal
   * vanish in the first place) outlives a few seconds. They are also scheduled
   * regardless of how the first send went — a send that threw outright is
   * exactly the case that needs a repeat most, and the old `result.ok`
   * condition denied it one.
   *
   * `stillNeeded`, checked before every repeat, cancels the remaining ones.
   * Teardown signals don't need it (a duplicate 'disconnect' is inert), but a
   * repeated 'start' is not inert: one landing after the host hung up rings a
   * phantom call on the peer. Without a predicate the repeats stay
   * unconditional, as they have always been.
   *
   * `evenWhenConfirmed` opts out of the skip above, and 'start' is the one
   * signal that needs it. A confirmation says the message reached the
   * RECIPIENT'S INBOX; an inbox belongs to an address, not to a device, and
   * says nothing about whether each of that address's devices got to see what
   * landed there. Every other confirmed signal is content with the inbox - only
   * 'start' has to reach every device, since any of them may be the one the
   * user is sitting at. Measured 2026-08-15: a confirmed 'start' rang on one
   * device of a two-device user and was never surfaced on the other, which had
   * a live inbox subscription throughout and 55s in which to see it.
   *
   * Note that with `confirm` the delays are measured from the END of the
   * confirmation window (15-20s in practice), not from the call: the repeats are
   * scheduled where the send finishes. That is the wanted order - a server too
   * busy to confirm is the last one to hand more copies to - and the repeats
   * still land inside the invitee's ringing window.
   */
  blindRepeats?: {
    delaysMillis: number[];
    stillNeeded?: () => boolean;
    evenWhenConfirmed?: boolean;
  };
  /**
   * Whether to route this send's delivery OUTCOME back here, so that a failure
   * reported by the platform triggers an immediate out-of-schedule resend
   * (bounded by REACTIVE_RESEND_BUDGET) and, once those are spent, `onFailure`.
   *
   * Only worth it for the few signals whose loss strands the call: the registry
   * behind it (see noteSignalDeliveryOutcome) holds one entry per tracked send,
   * so the ICE candidate stream must stay out of it.
   *
   * With `confirm` the registry is not used - a confirmed send learns the outcome
   * itself, and tracking it too would react to one failure twice - but this flag
   * still selects who gets `onFailure` when the confirmed attempts are spent.
   */
  reportFailure?: boolean;
  /**
   * Called once the signal is deemed undelivered to `recipient` — that is, after
   * the reactive resends above are spent. For escalation to the user; the
   * recovery itself has by then already been tried.
   */
  onFailure?: (recipient: string, err: unknown) => void;
  /** What to log the signal as; defaults to `webrtcMsg.stage`. */
  signalName?: string;
}

export interface WebRTCSignalSendResult {
  ok: boolean;
  err?: unknown;
  /**
   * Not confirmed, but nothing said it failed either: the confirmation window
   * ran out while the delivery was still on its way.
   *
   * The distinction exists because "unconfirmed" was being read as "failed", and
   * the two call for opposite reactions. A reported failure deserves a fast
   * re-send. A confirmation that merely stopped waiting deserves NONE: the
   * message is still in flight, and re-sending a multi-KB SDP behind it is
   * exactly the duplicate that a struggling server can least afford. Observed on
   * 2026-08-13: a 21KB offer timed out at 25s with `bytesSent=0, done=false` -
   * the server had not taken a byte yet - and the client put a second copy of it
   * on the wire 5s later. The offer did arrive.
   */
  deliveryUnknown?: boolean;
}

/**
 * Whether a failed confirmation means "still travelling" rather than "failed".
 *
 * True for a timeout that saw no per-recipient error: either no progress at all,
 * or progress with nothing wrong in it. A reported `with-errors`, or any error
 * that is not a timeout (addMsg threw, the platform refused), is a real failure.
 */
export function isDeliveryStillInFlight(err: unknown): boolean {
  const timeout = err as { timeout?: true; lastProgress?: unknown } | undefined;
  if (timeout?.timeout !== true) {
    return false;
  }
  const progress = timeout.lastProgress;
  if (!isDeliveryProgress(progress)) {
    return true;
  }
  if (progress.allDone === 'with-errors') {
    return false;
  }
  return !Object.values(progress.recipients ?? {}).some(r => r.err);
}

/**
 * Assembles the ASMail message for a WebRTC signal.
 *
 * `sendImmediately: true` keeps signalling out of the ordered delivery queue -
 * it must not wait behind regular chat messages, ICE negotiation is
 * latency-critical. `localMeta` lets delivery-monitor.ts clean the completed
 * delivery up afterwards; doing it here would race that cleanup and produce
 * "sending is not complete" errors.
 */
function asmailMsgFor(chatId: ChatIdObj, webrtcMsg: WebRTCMsg): {
  msg: ChatOutgoingMessage;
  opts: web3n.asmail.DeliveryOptions;
  msgSize: number;
} {
  const jsonBody: ChatWebRTCMsgV1 = {
    v: 1,
    chatMessageType: 'webrtc-call',
    groupChatId: chatId.isGroupChat ? chatId.chatId : undefined,
    // Stated outright, and not only as `groupChatId`, so that a signal
    // addressed to the user's own address names its chat: deriving a one-to-one
    // chat from the sender would there give the chat with oneself. `groupChatId`
    // stays for builds that don't read this field yet.
    chatId,
    webrtcMsg,
  };
  return {
    msg: {
      msgType: 'chat',
      jsonBody,
    },
    opts: {
      sendImmediately: true,
      localMeta: {
        chatId,
        chatMessageType: 'webrtc-call',
      },
    },
    // Approximate serialized size, for diagnostics. Large SDP (e.g. a 16KB
    // offer with many codecs/m-lines) is a leading contributor to ASMail
    // delivery latency and "not confirmed" timeouts, so logging the size makes
    // such cases immediately visible.
    msgSize: JSON.stringify(jsonBody).length,
  };
}

export function generateSignalDeliveryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(10000 * Math.random())}`;
}

/**
 * Minimal spacing between fire-and-forget signal sends of one JS context.
 *
 * This shapes burst TIMING only — it cannot bound platform-side concurrency:
 * the delivery subsystem starts a detached delivery session per message with
 * no cap, and each session lives for seconds, so spaced starts still overlap.
 * The real fix for the observed HTTP 500 storm is fewer messages (candidate
 * batching, see CandidatesBatchPayload); this queue just avoids slamming the
 * server with all session STARTS in the same instant.
 */
const SIGNAL_SEND_SPACING_MS = 200;

let sendChain: Promise<unknown> = Promise.resolve();

function queuedAddMsg(
  recipients: string[],
  msg: ChatOutgoingMessage,
  deliveryId: string,
  opts: web3n.asmail.DeliveryOptions,
): Promise<void> {
  // Nothing is signalled to a blocked address; see blocked-recipients.ts, and
  // note that only the deno component registers a filter there.
  const allowedRecipients = withoutBlockedRecipients(recipients);
  if (allowedRecipients.length === 0) {
    return Promise.resolve();
  }

  const turn = sendChain.then(
    () => w3n.mail!.delivery.addMsg(allowedRecipients, msg, deliveryId, opts),
  );
  sendChain = turn.then(
    () => sleep(SIGNAL_SEND_SPACING_MS),
    () => sleep(SIGNAL_SEND_SPACING_MS),
  );
  return turn;
}

/**
 * The delivery service as the confirmation helper should see it: `addMsg` spaced
 * by the queue above, everything else the platform's own.
 *
 * Without this, the confirmed branch called `addMsg` directly and so was the one
 * path that skipped SIGNAL_SEND_SPACING_MS — which was added specifically against
 * the 500 storm, and applies to a confirmed 'start'/'disconnect' burst exactly as
 * much as to a fire-and-forget one.
 */
function confirmationDeliveryApi(): DeliveryApiForConfirmation {
  const delivery = w3n.mail!.delivery;
  return {
    addMsg: queuedAddMsg,
    observeDelivery: delivery.observeDelivery.bind(delivery),
    currentState: delivery.currentState.bind(delivery),
  };
}

/**
 * The actual Star signal type carried by a `stage: 'signalling'` WebRTCMsg.
 *
 * On the ASMail path every star signal is packed with a PLACEHOLDER
 * `description.type = 'offer'` (an RTCSdpType is required there), and the real
 * type lives as `signalType` inside the JSON-stringified `description.sdp`
 * (see webRTCMsgWithStarSignal in signaling-channel-core.ts). Branching on
 * `description.type` therefore reads every candidate/stream-state/etc. as an
 * SDP offer. This helper returns the real type, or `null` for a legacy raw
 * SDP payload (where `description.type` IS the truth).
 */
export function starSignalTypeOf(webrtcMsg: WebRTCMsg): string | null {
  const rawData = webrtcMsg.data;
  const data = Array.isArray(rawData) ? rawData[0] : rawData;
  const sdp = data?.description?.sdp;
  if (typeof sdp !== 'string') {
    return null;
  }
  try {
    if (sdp.includes('"signalType"')) {
      const parsed = JSON.parse(sdp) as { signalType?: unknown };
      return (typeof parsed.signalType === 'string') ? parsed.signalType : null;
    }
    if (sdp.includes('"starSignal"')) {
      const parsed = JSON.parse(sdp) as { starSignal?: { type?: unknown } };
      const t = parsed.starSignal?.type;
      return (typeof t === 'string') ? t : null;
    }
  } catch {
    // Not JSON — a legacy raw SDP; fall through.
  }
  return null;
}

// A failure description is diagnostics, not a data dump: capped so that a
// pathological error object cannot flood the platform log.
const MAX_FAILURE_TEXT = 4000;

function safeStringify(x: unknown, cap = 2000): string {
  try {
    const seen = new WeakSet();
    const s = JSON.stringify(x, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) {
          return '<circular>';
        }
        seen.add(v);
      }
      return v;
    }) ?? String(x);
    return (s.length > cap) ? `${s.slice(0, cap)}…` : s;
  } catch {
    return String(x);
  }
}

/**
 * One recipient's error (DeliveryException | RuntimeException | Error) as a
 * single log line: platform exceptions are plain objects whose meaning lives
 * in primitive fields (`runtimeException`, `type`, flag fields), so those are
 * what gets printed.
 */
function describeException(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  if (err && (typeof err === 'object')) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(err)) {
      if ((value === undefined) || (value === null) || (key === 'stack')) {
        continue;
      }
      if (typeof value === 'object') {
        parts.push(`${key}=${safeStringify(value, 300)}`);
      } else {
        parts.push(`${key}=${value}`);
      }
    }
    return (parts.length > 0) ? `{ ${parts.join(', ')} }` : safeStringify(err, 300);
  }
  return String(err);
}

function isDeliveryProgress(x: unknown): x is web3n.asmail.DeliveryProgress {
  return (
    !!x && (typeof x === 'object')
    && (typeof (x as web3n.asmail.DeliveryProgress).recipients === 'object')
  );
}

function describeDeliveryProgress(p: web3n.asmail.DeliveryProgress): string {
  const recipients = Object.entries(p.recipients ?? {}).map(([addr, r]) => {
    const bits = [`done=${r.done}`, `bytesSent=${r.bytesSent}`];
    if (r.idOnDelivery) {
      bits.push(`idOnDelivery=${r.idOnDelivery}`);
    }
    if (r.deliveryTS) {
      bits.push(`deliveryTS=${new Date(r.deliveryTS).toISOString()}`);
    }
    if (r.awaitingRetry) {
      bits.push(`awaitingRetry=true`);
    }
    if (r.err) {
      bits.push(`err=${describeException(r.err)}`);
    }
    if (r.failedAttempts?.length) {
      const attempts = r.failedAttempts.map(
        a => `${new Date(a.attemptTS).toISOString()}: ${describeException(a.err)}`,
      );
      bits.push(`failedAttempts=[${attempts.join('; ')}]`);
    }
    return `${addr}: ${bits.join(', ')}`;
  });
  return `allDone=${p.allDone ?? 'not-yet'}, notConnected=${!!p.notConnected}, `
    + `msgSize=${p.msgSize}; recipients: { ${recipients.join(' | ')} }`;
}

/**
 * Renders a delivery failure into log-ready text. The default object printing
 * shows a `DeliveryProgress` as `{…}`, hiding the per-recipient `err` and
 * `failedAttempts` that actually name the cause; a confirmation timeout used
 * to hide whether any bytes reached the recipient's server at all. Text goes
 * into the message itself, so it survives however the platform log serializes
 * `details`.
 */
export function describeDeliveryFailure(err: unknown): string {
  try {
    let text: string;
    const timeout = err as { timeout?: true; timeoutMs?: number; lastProgress?: unknown };
    if ((err === 'timeout') || (timeout?.timeout === true)) {
      const last = isDeliveryProgress(timeout?.lastProgress)
        ? describeDeliveryProgress(timeout.lastProgress)
        : 'none';
      text = `confirmation timed out`
        + ((timeout?.timeoutMs !== undefined) ? ` after ${timeout.timeoutMs}ms` : '')
        + `; last seen state: ${last}`;
    } else if (isDeliveryProgress(err)) {
      text = describeDeliveryProgress(err);
    } else if (err instanceof Error) {
      text = `${err.name}: ${err.message}`;
    } else {
      text = safeStringify(err);
    }
    return (text.length > MAX_FAILURE_TEXT) ? `${text.slice(0, MAX_FAILURE_TEXT)}…` : text;
  } catch (e) {
    return `<failed to describe delivery error: ${e}>`;
  }
}

/**
 * Signals whose sending is logged at `info` rather than `debug`, i.e. in builds
 * with diagnostics off - which is every build a user reports from.
 *
 * These happen at most a couple of times per call and are exactly what a report
 * of "the call never rang" / "the window would not close" turns on: without
 * them, the log shows a failed delivery ('NOT confirmed' is already a warning)
 * but never a successful one, so "sent and ignored" is indistinguishable from
 * "never sent". Offers, answers, ICE candidates and heartbeats - the bulk of
 * signalling - stay at `debug`.
 */
const SIGNALS_LOGGED_AT_INFO: ReadonlySet<string> = new Set([
  'start',
  'disconnect',
  'dropped',
  'call-declined',
  'call-handled-elsewhere',
  'call-collision',
  'request-start',
]);

function logSignalLine(signalName: string, line: string): void {
  if (SIGNALS_LOGGED_AT_INFO.has(signalName)) {
    log.info(line);
  } else {
    log.debug(line);
  }
}

// =============================================================================
// Delivery-outcome feedback
// =============================================================================

/**
 * How many out-of-schedule resends one tracked send may trigger on reported
 * delivery failures.
 *
 * Small on purpose: the failure being reacted to is typically the server
 * answering 500 to a burst, so an unbounded "failed, send again" loop would
 * feed the very storm that caused it. Two resends plus the blind repeats give a
 * signal four chances spread over half a minute, which is what a transient 500
 * needs; beyond that the call is not going to happen and the user should hear
 * about it instead (see `onFailure`).
 */
const REACTIVE_RESEND_BUDGET = 2;

/**
 * How long a tracked send stays in the registry without a terminal delivery
 * event. Only a safety valve against leaking entries: the platform does report
 * `allDone` for every delivery it accepted, and that is what normally removes
 * them.
 */
const PENDING_DELIVERY_TTL_MILLIS = 180_000;

interface PendingSignalDelivery {
  signalName: string;
  recipient: string;
  registeredAt: number;
  stillNeeded?: () => boolean;
  onFailure?: (recipient: string, err: unknown) => void;
  /** Sends another copy; `false` when the resend budget is spent. */
  resend: () => boolean;
}

const pendingSignalDeliveries = new Map<string, PendingSignalDelivery>();

function registerPendingDelivery(
  deliveryId: string, pending: PendingSignalDelivery,
): void {
  const cutOff = pending.registeredAt - PENDING_DELIVERY_TTL_MILLIS;
  for (const [id, entry] of pendingSignalDeliveries) {
    if (entry.registeredAt < cutOff) {
      pendingSignalDeliveries.delete(id);
    }
  }
  pendingSignalDeliveries.set(deliveryId, pending);
}

/**
 * Feeds a terminal delivery event of a tracked signal back to its sender.
 *
 * Called by the delivery monitor, which is the only place that learns what
 * actually became of a fire-and-forget send: with CONFIRM_DELIVERY_ENABLED off,
 * `sendWebRTCSignal` returns as soon as the core accepts the message, so a
 * server-side failure (the HTTP 500 storm that ate a group call's 'start' on
 * 2026-08-12) used to be logged by the monitor and dropped, leaving the signal
 * with no second chance and the caller none the wiser.
 *
 * Note the scope: the registry is module state, so this closes the loop for
 * signals sent from the same JS context as the monitor — the background process,
 * which is where 'start' and 'disconnect' come from. Signals sent by the call
 * window recover through their own retry watchers instead.
 *
 * @returns whether a resend was triggered.
 */
export function noteSignalDeliveryOutcome(
  deliveryId: string, progress: web3n.asmail.DeliveryProgress,
): boolean {
  const pending = pendingSignalDeliveries.get(deliveryId);
  if (!pending) {
    return false;
  }
  pendingSignalDeliveries.delete(deliveryId);
  if (progress.allDone !== 'with-errors') {
    return false;
  }

  const { signalName, recipient, stillNeeded, onFailure, resend } = pending;
  const recipients = progress.recipients ?? {};
  const err = recipients[recipient]?.err
    ?? Object.values(recipients).find(r => r.err)?.err;

  if (stillNeeded && !stillNeeded()) {
    log.info(
      `Delivery of '${signalName}' to ${recipient} failed, but the signal is no `
        + `longer needed; not resending`,
    );
    return false;
  }
  if (resend()) {
    log.warn(
      `Delivery of '${signalName}' to ${recipient} failed: `
        + `${describeDeliveryFailure(err)}; resending now`,
    );
    return true;
  }
  log.warn(
    `Delivery of '${signalName}' to ${recipient} failed with no resends left: `
      + `${describeDeliveryFailure(err)}`,
  );
  onFailure?.(recipient, err);
  return false;
}

/**
 * Sends one WebRTC signal to one recipient, applying the caller's confirmation
 * and retry policy.
 *
 * Never throws: a delivery failure comes back as `{ ok: false, err }`, because
 * every caller treats signalling as best-effort and has its own recovery path
 * (negotiation retry watchers, heartbeats, request-start).
 */
export async function sendWebRTCSignal(
  opts: WebRTCSignalDelivery,
): Promise<WebRTCSignalSendResult> {
  const {
    chatId, recipient, webrtcMsg, deliveryIdPrefix, logLabel, retries,
    confirmTimeoutMs, blindRepeats,
  } = opts;
  const confirm = CONFIRM_DELIVERY_ENABLED && opts.confirm;
  const signalName = opts.signalName ?? webrtcMsg.stage;
  const { msg, opts: mailOpts, msgSize } = asmailMsgFor(chatId, webrtcMsg);
  const maxAttempts = (confirm && retries) ? (retries.attempts + 1) : 1;
  // Confirmed sends learn their own outcome; tracking them too would react to
  // the same failure twice.
  const trackOutcome = !!opts.reportFailure && !confirm;
  let reactiveResendsLeft = REACTIVE_RESEND_BUDGET;
  // Every copy of the signal is tracked, so once the budget is spent EACH of
  // their failures would escalate; the user needs to hear it once.
  let failureReported = false;

  /**
   * Puts one detached copy of the signal on its way: a blind repeat, or a resend
   * triggered by a reported delivery failure. Detached in both cases - the
   * caller's `await` is long gone by then.
   */
  function dispatchExtraCopy(label: string): void {
    const copyId = generateSignalDeliveryId(deliveryIdPrefix);
    trackDelivery(copyId);
    queuedAddMsg([recipient], msg, copyId, mailOpts).then(
      // At `info` for the signals whose loss is visible to the user (a call
      // that never rings, a window that never closes): the extra copies ARE
      // the recovery, so a log without diagnostics must still show them.
      () => logSignalLine(signalName, `${logLabel}: ${label} sent (deliveryId: ${copyId})`),
      err => log.warn(`${logLabel}: ${label} failed: ${describeDeliveryFailure(err)}`),
    );
  }

  function resendAfterFailedDelivery(): boolean {
    if (reactiveResendsLeft <= 0) {
      return false;
    }
    reactiveResendsLeft -= 1;
    dispatchExtraCopy(`Resend of '${signalName}' to ${recipient} after a failed delivery`);
    return true;
  }

  function trackDelivery(deliveryId: string): void {
    if (!trackOutcome) {
      return;
    }
    registerPendingDelivery(deliveryId, {
      signalName,
      recipient,
      registeredAt: Date.now(),
      stillNeeded: blindRepeats?.stillNeeded,
      onFailure: (peer, err) => {
        if (failureReported) {
          return;
        }
        failureReported = true;
        opts.onFailure?.(peer, err);
      },
      resend: resendAfterFailedDelivery,
    });
  }

  let result: WebRTCSignalSendResult = { ok: false };
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const deliveryId = generateSignalDeliveryId(deliveryIdPrefix);
      if (confirm) {
        const confirmation = await sendMsgWithDeliveryConfirmation(
          [recipient], msg, deliveryId, mailOpts, confirmTimeoutMs,
          confirmationDeliveryApi(),
        );
        result = confirmation.ok
          ? { ok: true }
          : {
            ok: false,
            err: confirmation.err,
            deliveryUnknown: isDeliveryStillInFlight(confirmation.err),
          };
        if (!result.ok) {
          log.warn(
            `${logLabel}: Delivery of '${signalName}' to ${recipient} `
              + (result.deliveryUnknown ? `NOT confirmed but still in flight` : `FAILED`)
              + ` (attempt ${attempt}/${maxAttempts}, msgSize: ${msgSize}B): `
              + describeDeliveryFailure(result.err),
          );
        }
      } else {
        // Registered BEFORE the send: the monitor's event for it may arrive as
        // soon as addMsg() resolves, and an unregistered delivery is an
        // unrecoverable one.
        trackDelivery(deliveryId);
        await queuedAddMsg([recipient], msg, deliveryId, mailOpts);
        result = { ok: true };
      }
      // Says only as much as was actually learned. `confirmed: true` here used
      // to mean "addMsg() did not throw", i.e. the core took the message - which
      // read as "the peer has it" and made a call whose 'start' died on the
      // server look perfectly delivered in the host's log (2026-08-12).
      const outcome = confirm
        ? `confirmed: ${result.ok}, attempt: ${attempt}/${maxAttempts}`
        : `queued: ${result.ok}`;
      logSignalLine(
        signalName,
        `${logLabel}: Sent '${signalName}' to ${recipient} `
          + `(deliveryId: ${deliveryId}, ${outcome}, msgSize: ${msgSize}B)`,
      );

      if (result.ok || attempt === maxAttempts) {
        break;
      }
      // The same gate the blind repeats apply, for the same reason: a 'start'
      // re-sent after the host gave up rings a phantom call on the peer. A
      // confirmation window is 20-30s wide, so plenty can have changed by now.
      if (blindRepeats?.stillNeeded && !blindRepeats.stillNeeded()) {
        logSignalLine(
          signalName,
          `${logLabel}: Not retrying unconfirmed '${signalName}' to ${recipient}: `
            + `no longer needed`,
        );
        break;
      }
      await sleep(retries!.delayMillis);
    }
  } catch (err) {
    result = { ok: false, err };
    log.error(
      `${logLabel}: Failed to send '${signalName}' to ${recipient} (msgSize: ${msgSize}B): ` +
        describeDeliveryFailure(err),
      err,
    );
  }

  // A confirmed send learns its own outcome, so it is also where escalation to
  // the user has to happen: the pending-delivery registry that normally calls
  // `onFailure` is only fed by the fire-and-forget branch (`trackOutcome`), and
  // without this a confirmed 'start' that never arrived would leave the host's
  // "could not reach X" notice unsaid.
  if (confirm && !result.ok && opts.reportFailure && !failureReported) {
    failureReported = true;
    opts.onFailure?.(recipient, result.err);
  }

  if (blindRepeats && (!confirm || blindRepeats.evenWhenConfirmed)) {
    const { delaysMillis, stillNeeded } = blindRepeats;
    const timers: ReturnType<typeof setTimeout>[] = [];
    delaysMillis.forEach((delayMillis, i) => {
      timers.push(setTimeout(() => {
        if (stillNeeded && !stillNeeded()) {
          // Cancel the whole tail, not just this one: what makes a repeat
          // unnecessary (the peer answered, the call is over) does not un-happen.
          for (const timer of timers) {
            clearTimeout(timer);
          }
          logSignalLine(
            signalName,
            `${logLabel}: Blind repeats of '${signalName}' to ${recipient} `
              + `cancelled at #${i + 1}/${delaysMillis.length}: no longer needed`,
          );
          return;
        }
        dispatchExtraCopy(
          `Blind repeat #${i + 1}/${delaysMillis.length} of '${signalName}' to ${recipient}`,
        );
      }, delayMillis));
    });
  }
  return result;
}
