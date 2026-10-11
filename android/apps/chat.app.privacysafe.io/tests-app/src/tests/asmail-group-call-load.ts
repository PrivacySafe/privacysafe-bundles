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
 * ASMail load diagnostic for group-call signalling patterns.
 *
 * Mirrors production policy (signaling-channel-core.ts):
 *   - offer/answer: sendImmediately + confirm (SDP_CONFIRM_MS)
 *   - candidate:    sendImmediately + fire-and-forget (no confirm)
 *
 * Does NOT open a call window / RTCPeerConnection.
 * Baseline must succeed; load cases log FAIL_ASMAIL, never fail the suite.
 *
 * See plans/group-call-3p-media-and-hangup-2026-08-10.md and
 * plans/group-call-signalling-and-rejoin-fixes-2026-08-13.md (report-latency).
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import {
  sendMsgWithDeliveryConfirmation,
  type DeliveryConfirmationResult,
} from '@shared/asmail-utils.ts';
import { describeDeliveryFailure } from '@shared/webrtc-signalling.ts';
import type { ChatIdObj, ChatOutgoingMessage, ChatWebRTCMsgV1, WebRTCMsg } from '~/asmail-msgs.types';

declare const w3n: web3n.testing.CommonW3N;

// Production SDP confirm timeout (SDP_CONFIRM_TIMEOUT_MS, signaling-channel-core.ts).
const SDP_CONFIRM_MS = 25_000;

/**
 * How fast a delivery outcome must be reported for a REACTIVE resend to be worth
 * anything (MAX_TICK_AGE_MILLIS in
 * src-deno/services/video-chat-service/utils/heartbeat-delivery.ts).
 *
 * The heartbeat resend reacts to a reported failure rather than waiting on a
 * confirmation, which is only useful while the tick it replaces is still fresher
 * than the next scheduled one (HEARTBEAT_INTERVAL = 15s). The `report-latency`
 * case below measures the platform against this number so the mechanism is not
 * argued about from assumptions.
 */
const USEFUL_REPORT_LATENCY_MS = 12_000;

type DeliveryOutcome = {
  caseId: string;
  deliveryId: string;
  recipient: string;
  msgSize: number;
  kind: 'sdp' | 'candidate' | 'info';
  sendImmediately: boolean;
  confirm: boolean;
  startedAt: number;
  finishedAt: number;
  ok: boolean;
  errSummary?: string;
  peakInFlight?: number;
};

type CaseSummary = {
  caseId: string;
  total: number;
  ok: number;
  fail: number;
  failRate: number;
  firstFailIndex: number | null;
  errKinds: Record<string, number>;
  avgMs: number;
  maxMs: number;
  peakInFlight: number;
};

const allOutcomes: DeliveryOutcome[] = [];
const CASE_IDS: string[] = [];
let inFlight = 0;
let peakInFlightGlobal = 0;

function noteCase(id: string): string {
  CASE_IDS.push(id);
  return id;
}

function trackStart(): void {
  inFlight += 1;
  if (inFlight > peakInFlightGlobal) peakInFlightGlobal = inFlight;
}

function trackEnd(): void {
  inFlight = Math.max(0, inFlight - 1);
}

function errKind(text: string): string {
  if (/status=500/.test(text)) {
    if (/\/msg\/meta/.test(text)) return 'http-500-meta';
    if (/\/msg\/obj\//.test(text)) return 'http-500-obj';
    return 'http-500-other';
  }
  if (/already been added for delivery/i.test(text)) return 'duplicate-delivery-id';
  if (/timeout/i.test(text)) return 'confirm-timeout';
  // Match only the true flag, not `notConnected=false` inside progress dumps.
  if (/\bnotConnected=true\b/i.test(text)) return 'not-connected';
  if (/ETIMEDOUT|ECONN|ENOTFOUND|network/i.test(text)) return 'network';
  if (/bytesSent=0/.test(text)) return 'bytes-sent-zero';
  return text ? 'other' : 'unknown';
}

function summarizeCase(caseId: string): CaseSummary {
  const mine = allOutcomes.filter(o => o.caseId === caseId);
  const failIdx = mine.findIndex(o => !o.ok);
  const errKinds: Record<string, number> = {};
  let sumMs = 0;
  let maxMs = 0;
  let peak = 0;
  let fail = 0;
  for (const o of mine) {
    const ms = o.finishedAt - o.startedAt;
    sumMs += ms;
    if (ms > maxMs) maxMs = ms;
    if ((o.peakInFlight ?? 0) > peak) peak = o.peakInFlight ?? 0;
    if (!o.ok) {
      fail += 1;
      const k = errKind(o.errSummary ?? '');
      errKinds[k] = (errKinds[k] ?? 0) + 1;
    }
  }
  const total = mine.length;
  return {
    caseId,
    total,
    ok: total - fail,
    fail,
    failRate: total ? fail / total : 0,
    firstFailIndex: failIdx >= 0 ? failIdx : null,
    errKinds,
    avgMs: total ? Math.round(sumMs / total) : 0,
    maxMs,
    peakInFlight: peak,
  };
}

async function logInfo(msg: string): Promise<void> {
  console.log(msg);
  try {
    await w3n.testStand.log('info', msg);
  } catch { /* ignore */ }
}

function printSummary(): void {
  const lines = ['', '======== ASMAIL_GROUP_CALL_LOAD SUMMARY ========'];
  for (const id of CASE_IDS) {
    const s = summarizeCase(id);
    const mark = s.fail > 0 ? 'FAIL_ASMAIL' : 'OK';
    lines.push(
      `[${mark}] ${s.caseId}: ok=${s.ok}/${s.total} failRate=${(s.failRate * 100).toFixed(1)}% `
        + `firstFail=${s.firstFailIndex ?? '-'} peakInFlight=${s.peakInFlight} `
        + `avgMs=${s.avgMs} maxMs=${s.maxMs} errs=${JSON.stringify(s.errKinds)}`,
    );
  }
  lines.push('======== END ASMAIL_GROUP_CALL_LOAD SUMMARY ========');
  const block = lines.join('\n');
  console.log(block);
  void logInfo(block);
}

function padPayload(targetBytes: number, seed: string): string {
  if (targetBytes <= 0) return '';
  const unit = `${seed}:`;
  return unit.repeat(Math.ceil(targetBytes / unit.length)).slice(0, targetBytes);
}

function makeChatId(tag: string): ChatIdObj {
  return { isGroupChat: true, chatId: `asmail-load-${tag}` };
}

function makeMsg(kind: 'candidate' | 'sdp' | 'info', bytes: number, seq: number): {
  msg: ChatOutgoingMessage;
  msgSize: number;
} {
  const pad = padPayload(Math.max(0, bytes - 280), `pad-${kind}-${seq}`);
  const signalType = kind === 'sdp' ? 'offer' : kind === 'candidate' ? 'candidate' : 'stream-sender-info';
  const payload = kind === 'sdp'
    ? { type: 'offer', sdp: `v=0\r\n${pad}` }
    : kind === 'candidate'
      ? {
        candidate: `candidate:1 1 UDP 2122252543 192.0.2.${seq % 250} ${10000 + (seq % 50000)} typ host`,
        sdpMid: '0',
        sdpMLineIndex: 0,
        _pad: pad,
      }
      : { streamId: `stream-${seq}`, senderAddr: 'peer@test', _pad: pad };
  const starSignal = { signalType, fromAddr: 'diag-host', payload };
  const webrtcMsg: WebRTCMsg = {
    stage: 'signalling',
    id: Date.now() + seq,
    callSessionId: 'asmail-load#diag',
    data: {
      description: {
        type: 'offer',
        sdp: JSON.stringify(starSignal),
      } as RTCSessionDescription,
    },
  };
  const jsonBody: ChatWebRTCMsgV1 = {
    v: 1,
    chatMessageType: 'webrtc-call',
    groupChatId: 'asmail-load-diag',
    chatId: makeChatId('diag'),
    webrtcMsg,
  };
  const msg: ChatOutgoingMessage = { msgType: 'chat', jsonBody };
  return { msg, msgSize: JSON.stringify(jsonBody).length };
}

function deliveryId(prefix: string, seq: number): string {
  return `${prefix}-${Date.now()}-${seq}-${Math.floor(Math.random() * 1e6)}`;
}

async function sendOne(opts: {
  caseId: string;
  recipient: string;
  kind: 'candidate' | 'sdp' | 'info';
  bytes: number;
  seq: number;
  sendImmediately: boolean;
  /** Override; default: sdp/info confirm, candidate no-confirm (prod). */
  confirm?: boolean;
  confirmTimeoutMs?: number;
  fixedDeliveryId?: string;
}): Promise<DeliveryOutcome> {
  const confirm = opts.confirm ?? (opts.kind === 'sdp' || opts.kind === 'info');
  const { msg, msgSize } = makeMsg(opts.kind, opts.bytes, opts.seq);
  const id = opts.fixedDeliveryId ?? deliveryId(opts.caseId, opts.seq);
  const startedAt = Date.now();
  trackStart();
  const localPeak = inFlight;
  // eslint-disable-next-line no-useless-assignment
  let ok = false;
  let errSummary: string | undefined;
  try {
    const mailOpts: web3n.asmail.DeliveryOptions = {
      sendImmediately: opts.sendImmediately,
      localMeta: {
        chatId: makeChatId(opts.caseId),
        chatMessageType: 'webrtc-call',
      },
    };
    if (confirm) {
      const result: DeliveryConfirmationResult = await sendMsgWithDeliveryConfirmation(
        [opts.recipient],
        msg,
        id,
        mailOpts,
        opts.confirmTimeoutMs ?? SDP_CONFIRM_MS,
      );
      ok = result.ok;
      if (!result.ok) errSummary = describeDeliveryFailure(result.err);
    } else {
      await w3n.mail!.delivery.addMsg([opts.recipient], msg, id, mailOpts);
      ok = true;
    }
  } catch (err) {
    ok = false;
    errSummary = describeDeliveryFailure(err);
  } finally {
    trackEnd();
  }
  const outcome: DeliveryOutcome = {
    caseId: opts.caseId,
    deliveryId: id,
    recipient: opts.recipient,
    msgSize,
    kind: opts.kind,
    sendImmediately: opts.sendImmediately,
    confirm,
    startedAt,
    finishedAt: Date.now(),
    ok,
    errSummary,
    peakInFlight: Math.max(localPeak, peakInFlightGlobal),
  };
  allOutcomes.push(outcome);
  return outcome;
}

type Item = { kind: 'candidate' | 'sdp' | 'info'; bytes: number; confirm?: boolean };

async function burst(opts: {
  caseId: string;
  recipients: string[];
  items: Item[];
  parallel: boolean;
  sendImmediately: boolean;
  confirmTimeoutMs?: number;
}): Promise<DeliveryOutcome[]> {
  let seq = 0;
  const tasks: Array<() => Promise<DeliveryOutcome>> = [];
  for (const recipient of opts.recipients) {
    for (const item of opts.items) {
      const s = seq++;
      tasks.push(() => sendOne({
        caseId: opts.caseId,
        recipient,
        kind: item.kind,
        bytes: item.bytes,
        seq: s,
        sendImmediately: opts.sendImmediately,
        confirm: item.confirm,
        confirmTimeoutMs: opts.confirmTimeoutMs,
      }));
    }
  }
  if (opts.parallel) return Promise.all(tasks.map(t => t()));
  const out: DeliveryOutcome[] = [];
  for (const t of tasks) out.push(await t());
  return out;
}

/** Prod-like ICE exchange: 1 confirmed SDP + N fire-and-forget candidates. */
function iceBurstItems(nCandidates: number, sdpBytes: number): Item[] {
  return [
    { kind: 'sdp', bytes: sdpBytes, confirm: true },
    ...Array.from({ length: nCandidates }, () => ({
      kind: 'candidate' as const,
      bytes: 600,
      confirm: false,
    })),
  ];
}

async function logCase(caseId: string, extra = ''): Promise<void> {
  const s = summarizeCase(caseId);
  await logInfo(
    `[asmail-load] ${caseId}: ok=${s.ok}/${s.total} failRate=${(s.failRate * 100).toFixed(1)}% `
      + `firstFail=${s.firstFailIndex ?? '-'} peakInFlight=${s.peakInFlight} `
      + `avgMs=${s.avgMs} maxMs=${s.maxMs} errs=${JSON.stringify(s.errKinds)}${extra ? ` ${extra}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/**
 * Whether the burst cases run.
 *
 * They are a deliberate storm against a REAL ASMail server — hundreds of
 * messages, some of them 14KB, sent in parallel on purpose — and they take the
 * better part of an hour. That is a thing to ask for, not a thing to get by
 * importing this file, so they are off by default and `itHeavy` does not even
 * register them: a run's spec count then says what actually ran, and the line
 * logged in their place says what did not.
 *
 * `report-latency` below is NOT one of them (five ~300B messages, the size of a
 * heartbeat) and always runs: its whole value is a distribution gathered over
 * many ordinary runs rather than a single reading.
 */
const RUN_HEAVY_BURSTS = false;

function itHeavy(
  expectation: string, assertion: () => Promise<void>, timeout: number,
): void {
  if (RUN_HEAVY_BURSTS) {
    itCond(expectation, assertion, timeout);
  }
}

describe(`ASMail group-call load diagnostic`, () => {
  let user2: string;
  let user3: string;
  /** Confirm path works end-to-end (allDone). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let confirmBaselineOk = false;
  /** addMsg accepts without throwing (fire-and-forget path). */
  let addMsgBaselineOk = false;

  beforeAll(async () => {
    if (!RUN_HEAVY_BURSTS) {
      await logInfo(
        `[asmail-load] burst cases are OFF (RUN_HEAVY_BURSTS in this file); only `
          + `report-latency runs. Turn it on to storm the server on purpose.`,
      );
    }
    user2 = await w3n.testStand.idOfTestUser(2);
    user3 = await w3n.testStand.idOfTestUser(3);
    await logInfo(`[asmail-load] recipients: user2=${user2}, user3=${user3}`);
    // preFlight: is the recipient's ASMail server reachable at all?
    try {
      const t0 = Date.now();
      await w3n.mail!.delivery.preFlight(user2);
      await logInfo(`[asmail-load] preFlight(user2) ok in ${Date.now() - t0}ms`);
    } catch (err) {
      await logInfo(`[asmail-load] preFlight(user2) FAILED: ${describeDeliveryFailure(err)}`);
    }
    // The timeout is explicit because this reaches the server, and jasmine's
    // default of 5 s is a measure of nothing: an unreachable server takes the
    // connect timeout to say so, and the suite then fails as a *suite* - which
    // reads as a broken build rather than as an outage the specs below skip on
    // their own (seen on 2026-08-15, ETIMEDOUT to the ASMail server).
  }, 60000);

  afterAll(() => {
    printSummary();
  });

  itHeavy(`oto-baseline-addMsg: 5×~400B sequential fire-and-forget`, async () => {
    const caseId = noteCase('oto-baseline-addMsg');
    await logInfo(`[asmail-load] start ${caseId}`);
    const outcomes = await burst({
      caseId,
      recipients: [user2],
      items: Array.from({ length: 5 }, () => ({
        kind: 'candidate' as const,
        bytes: 400,
        confirm: false,
      })),
      parallel: false,
      sendImmediately: true,
    });
    await logCase(caseId);
    const fails = outcomes.filter(o => !o.ok);
    addMsgBaselineOk = fails.length === 0;
    // Diagnostic: do not fail suite; record only.
    expect(outcomes.length).toBe(5);
  }, 60_000);

  itHeavy(`oto-baseline-confirm: 5×~400B sequential confirm`, async () => {
    const caseId = noteCase('oto-baseline-confirm');
    await logInfo(`[asmail-load] start ${caseId}`);
    const outcomes = await burst({
      caseId,
      recipients: [user2],
      items: Array.from({ length: 5 }, () => ({
        kind: 'candidate' as const,
        bytes: 400,
        confirm: true,
      })),
      parallel: false,
      sendImmediately: true,
      confirmTimeoutMs: 12_000,
    });
    await logCase(caseId);
    const fails = outcomes.filter(o => !o.ok);
    confirmBaselineOk = fails.length === 0;
    if (fails.length > 0) {
      await logInfo(
        `[asmail-load] CONFIRM BASELINE DEGRADED ${fails.length}/${outcomes.length} `
          + `(addMsgBaselineOk=${addMsgBaselineOk}). first: ${fails[0]?.errSummary ?? 'n/a'}. `
          + `Continuing load matrix — this IS a platform signal when addMsg works but confirm does not, `
          + `or when both fail after incompleteDelivery pollution.`,
      );
    }
    expect(outcomes.length).toBe(5);
  }, 180_000);

  itHeavy(`oto-baseline-sdp: 3×~8KB sequential confirmed SDP`, async () => {
    // Always run: even degraded stands need size data.
    const caseId = noteCase('oto-baseline-sdp');
    await logInfo(`[asmail-load] start ${caseId}`);
    const outcomes = await burst({
      caseId,
      recipients: [user2],
      items: Array.from({ length: 3 }, () => ({ kind: 'sdp' as const, bytes: 8_000, confirm: true })),
      parallel: false,
      sendImmediately: true,
      confirmTimeoutMs: 12_000,
    });
    await logCase(caseId);
    const fails = outcomes.filter(o => !o.ok);
    if (fails.length > 0) {
      await logInfo(`[asmail-load] sdp baseline degraded ${fails.length}/3: ${fails[0]?.errSummary ?? ''}`);
    }
    expect(outcomes.length).toBe(3);
  }, 180_000);

  itHeavy(`oto-ice-burst: 1 SDP + 20 candidates parallel → 1 peer (prod confirm policy)`, async () => {
    const caseId = noteCase('oto-ice-burst');
    await logInfo(`[asmail-load] start ${caseId}`);
    peakInFlightGlobal = 0;
    const outcomes = await burst({
      caseId,
      recipients: [user2],
      items: iceBurstItems(20, 8_000),
      parallel: true,
      sendImmediately: true,
    });
    await logCase(caseId);
    expect(outcomes.length).toBe(21);
  }, 120_000);

  itHeavy(`group-dual-ice-burst: ICE burst to user2 AND user3 in parallel (main group diff)`, async () => {
    const caseId = noteCase('group-dual-ice-burst');
    await logInfo(`[asmail-load] start ${caseId}`);
    peakInFlightGlobal = 0;
    const outcomes = await burst({
      caseId,
      recipients: [user2, user3],
      items: iceBurstItems(20, 8_000),
      parallel: true,
      sendImmediately: true,
    });
    await logCase(caseId);
    expect(outcomes.length).toBe(42);
  }, 180_000);

  itHeavy(`group-dual-sdp-reneg: dual peers × (sdp + reneg + info)`, async () => {
    const caseId = noteCase('group-dual-sdp-reneg');
    await logInfo(`[asmail-load] start ${caseId}`);
    peakInFlightGlobal = 0;
    const wave1 = await burst({
      caseId,
      recipients: [user2, user3],
      items: [{ kind: 'sdp', bytes: 8_000, confirm: true }],
      parallel: true,
      sendImmediately: true,
    });
    const wave2 = await burst({
      caseId,
      recipients: [user2, user3],
      items: [
        { kind: 'sdp', bytes: 12_000, confirm: true },
        { kind: 'info', bytes: 400, confirm: false },
        { kind: 'info', bytes: 400, confirm: false },
      ],
      parallel: true,
      sendImmediately: true,
    });
    await logCase(
      caseId,
      `wave1Fail=${wave1.filter(o => !o.ok).length} wave2Fail=${wave2.filter(o => !o.ok).length}`,
    );
    expect(wave1.length + wave2.length).toBe(8);
  }, 180_000);

  itHeavy(`concurrency-ramp: N∈{1,2,4,8,16} parallel 2KB confirmed SDP`, async () => {
    for (const n of [1, 2, 4, 8]) {
      const caseId = noteCase(`concurrency-ramp-n${n}`);
      await logInfo(`[asmail-load] start ${caseId}`);
      peakInFlightGlobal = 0;
      await burst({
        caseId,
        recipients: [user2],
        items: Array.from({ length: n }, () => ({ kind: 'sdp' as const, bytes: 2_000, confirm: true })),
        parallel: true,
        sendImmediately: true,
      });
      await logCase(caseId);
      await new Promise(r => setTimeout(r, 1000));
    }
    expect(true).toBe(true);
  }, 300_000);

  itHeavy(`size-ramp: size∈{0.5,2,8,14}KB × concurrency=8 confirmed`, async () => {
    for (const bytes of [500, 2_000, 8_000, 14_000]) {
      const caseId = noteCase(`size-ramp-${bytes}b-c4`);
      await logInfo(`[asmail-load] start ${caseId}`);
      peakInFlightGlobal = 0;
      await burst({
        caseId,
        recipients: [user2],
        items: Array.from({ length: 4 }, () => ({ kind: 'sdp' as const, bytes, confirm: true })),
        parallel: true,
        sendImmediately: true,
        confirmTimeoutMs: 12_000,
      });
      await logCase(caseId);
      await new Promise(r => setTimeout(r, 1000));
    }
    expect(true).toBe(true);
  }, 360_000);

  itHeavy(`sendImmediately-false: dual ICE burst via ordered queue`, async () => {
    const caseId = noteCase('sendImmediately-false-dual-burst');
    await logInfo(`[asmail-load] start ${caseId}`);
    peakInFlightGlobal = 0;
    const outcomes = await burst({
      caseId,
      recipients: [user2, user3],
      items: iceBurstItems(20, 8_000),
      parallel: true,
      sendImmediately: false,
      confirmTimeoutMs: 12_000,
    });
    await logCase(caseId);
    expect(outcomes.length).toBe(42);
  }, 300_000);

  itHeavy(`fire-and-forget-all: dual ICE burst, even SDP without confirm`, async () => {
    const caseId = noteCase('fire-and-forget-all-dual');
    await logInfo(`[asmail-load] start ${caseId}`);
    peakInFlightGlobal = 0;
    const outcomes = await burst({
      caseId,
      recipients: [user2, user3],
      items: [
        { kind: 'sdp', bytes: 8_000, confirm: false },
        ...Array.from({ length: 20 }, () => ({ kind: 'candidate' as const, bytes: 600, confirm: false })),
      ],
      parallel: true,
      sendImmediately: true,
    });
    await logCase(caseId);
    expect(outcomes.length).toBe(42);
  }, 60_000);

  itHeavy(`duplicate-delivery-id: same id twice quickly`, async () => {
    const caseId = noteCase('duplicate-delivery-id');
    await logInfo(`[asmail-load] start ${caseId}`);
    const fixed = deliveryId('dup-fixed', 0);
    const outcomes = await Promise.all([
      sendOne({
        caseId, recipient: user2, kind: 'candidate', bytes: 400, seq: 0,
        sendImmediately: true, confirm: true, confirmTimeoutMs: 12_000, fixedDeliveryId: fixed,
      }),
      sendOne({
        caseId, recipient: user2, kind: 'candidate', bytes: 400, seq: 1,
        sendImmediately: true, confirm: true, confirmTimeoutMs: 12_000, fixedDeliveryId: fixed,
      }),
    ]);
    await logCase(caseId, `details=${outcomes.map(o => o.errSummary ?? 'ok').join(' | ')}`);
    expect(outcomes.length).toBe(2);
  }, 60_000);

  itHeavy(`timeline-group-join: scripted 2nd-client join host outbox load`, async () => {
    const caseId = noteCase('timeline-group-join');
    await logInfo(`[asmail-load] start ${caseId}`);
    peakInFlightGlobal = 0;

    // t0: answer+candidates to C1
    const t0 = burst({
      caseId,
      recipients: [user2],
      items: iceBurstItems(12, 3_000),
      parallel: true,
      sendImmediately: true,
    });
    await new Promise(r => setTimeout(r, 300));
    // new joiner C2 + reneg to C1 in parallel
    const tNew = burst({
      caseId,
      recipients: [user3],
      items: iceBurstItems(12, 3_000),
      parallel: true,
      sendImmediately: true,
    });
    const tReneg = burst({
      caseId,
      recipients: [user2],
      items: [
        { kind: 'sdp', bytes: 8_000, confirm: true },
        { kind: 'info', bytes: 400, confirm: false },
        { kind: 'info', bytes: 400, confirm: false },
      ],
      parallel: true,
      sendImmediately: true,
    });
    await Promise.all([t0, tNew, tReneg]);

    // retries of reneg to C2
    await new Promise(r => setTimeout(r, 1000));
    for (let i = 0; i < 3; i++) {
      await sendOne({
        caseId, recipient: user3, kind: 'sdp', bytes: 8_000, seq: 1000 + i,
        sendImmediately: true, confirm: true,
      });
      await new Promise(r => setTimeout(r, 400));
    }

    // recreate storm
    await burst({
      caseId,
      recipients: [user3],
      items: iceBurstItems(20, 9_000),
      parallel: true,
      sendImmediately: true,
    });

    await logCase(caseId);
    expect(summarizeCase(caseId).total).toBeGreaterThan(20);
  }, 360_000);

  itCond(`report-latency: how long a terminal delivery event takes to arrive`, async () => {
    // The measurement the heartbeat resend rests on (P4.3 of
    // plans/group-call-signalling-and-rejoin-fixes-2026-08-13.md). A resend
    // reacting to a REPORTED failure replaces a lost tick, so it is only useful
    // while that tick is still fresher than the next scheduled one — if the
    // platform takes longer than USEFUL_REPORT_LATENCY_MS to say what became of a
    // delivery, the mechanism is dead weight and should be dropped rather than
    // tuned. Purely diagnostic: it prints the number, it does not fail the suite.
    const caseId = noteCase('report-latency');
    await logInfo(`[asmail-load] start ${caseId}`);

    const N = 5;
    // A heartbeat-sized multicast, which is what this measures for.
    const HEARTBEAT_BYTES = 300;
    const sentAt = new Map<string, number>();
    const reportedAt = new Map<string, { ms: number; allDone: string; via: string }>();

    function noteReport(id: string, allDone: string, via: string): void {
      const startedAt = sentAt.get(id);
      if ((startedAt === undefined) || reportedAt.has(id)) {
        return;
      }
      reportedAt.set(id, { ms: Date.now() - startedAt, allDone, via });
    }

    const stopWatching = w3n.mail!.delivery.observeAllDeliveries({
      next: data => {
        const { id, progress } = data;
        if (!progress.allDone) {
          return;
        }
        noteReport(id, String(progress.allDone), 'observer');
      },
      error: err => {
        void logInfo(`[asmail-load] ${caseId}: observeAllDeliveries error: ${describeDeliveryFailure(err)}`);
      },
    });

    /**
     * The observer alone measures nothing, and the first run of this case
     * (2026-08-13: sent=5, reported=0) is what showed it: delivery-monitor.ts
     * drops a completed delivery on `allDone` (rmMsg), and this app runs its
     * own monitor over the very same 'webrtc-call' deliveries — so the terminal
     * event can be consumed and the record gone before this subscription is
     * ever called. Production knows this and never relies on observing alone
     * (see finishFromCurrentState in asmail-utils.ts).
     *
     * So poll `currentState()` the way production does, and read a vanished
     * record as "reported": `rmMsg` without `cancelSending` only removes a
     * delivery that has finished, and nothing here cancels one. Which of the
     * two saw it first is kept in `via`, because a case that measures the
     * wrong thing silently is how the first reading came to say the mechanism
     * was dead weight.
     */
    let stillInFlightAtDeadline = 0;
    async function pollCurrentStates(): Promise<void> {
      let inFlightNow = 0;
      for (const id of sentAt.keys()) {
        if (reportedAt.has(id)) {
          continue;
        }
        try {
          const state = await w3n.mail!.delivery.currentState(id);
          if (!state) {
            noteReport(id, 'record-gone', 'poll');
          } else if (state.allDone) {
            noteReport(id, String(state.allDone), 'poll');
          } else {
            inFlightNow += 1;
          }
        } catch {
          // Nothing to conclude from a failed lookup; the next tick retries.
        }
      }
      stillInFlightAtDeadline = inFlightNow;
    }

    try {
      for (let i = 0; i < N; i += 1) {
        const id = deliveryId(caseId, i);
        const { msg } = makeMsg('info', HEARTBEAT_BYTES, i);
        sentAt.set(id, Date.now());
        try {
          // Fire-and-forget and to both peers, exactly as a heartbeat goes out.
          await w3n.mail!.delivery.addMsg([user2, user3], msg, id, {
            sendImmediately: true,
            localMeta: {
              chatId: makeChatId(caseId),
              chatMessageType: 'webrtc-call',
            },
          });
        } catch (err) {
          await logInfo(`[asmail-load] ${caseId}: addMsg #${i} threw: ${describeDeliveryFailure(err)}`);
          sentAt.delete(id);
        }
        // Spaced like production signalling (SIGNAL_SEND_SPACING_MS).
        await new Promise(r => setTimeout(r, 200));
      }

      // Well past the useful bound, so a report that never comes is measured as
      // such rather than as a slow one.
      const deadline = Date.now() + (3 * USEFUL_REPORT_LATENCY_MS);
      while ((reportedAt.size < sentAt.size) && (Date.now() < deadline)) {
        await new Promise(r => setTimeout(r, 250));
        await pollCurrentStates();
      }
    } finally {
      stopWatching();
    }

    const latencies = [...reportedAt.values()].map(r => r.ms).sort((a, b) => a - b);
    const reported = latencies.length;
    const unreported = sentAt.size - reported;
    const median = reported ? latencies[Math.floor((reported - 1) / 2)] : null;
    const maxMs = reported ? latencies[reported - 1] : null;
    const withinUseful = latencies.filter(ms => ms <= USEFUL_REPORT_LATENCY_MS).length;
    const outcomes = [...reportedAt.values()].reduce<Record<string, number>>((acc, r) => {
      acc[r.allDone] = (acc[r.allDone] ?? 0) + 1;
      return acc;
    }, {});
    const sources = [...reportedAt.values()].reduce<Record<string, number>>((acc, r) => {
      acc[r.via] = (acc[r.via] ?? 0) + 1;
      return acc;
    }, {});

    // Three different things, and lumping them together is what made the first
    // reading of this case (2026-08-13) unusable:
    //  - still in flight at the deadline: the SERVER is slow, the reporting
    //    mechanism was never exercised. Says nothing about the resend, and on a
    //    stand where a plain 2-message spec also times out at 20s it is the
    //    expected reading, not a finding;
    //  - reported, but all of them late: the resend is genuinely dead weight;
    //  - reported within the bound: it works, and by how much.
    const verdict = (reported === 0)
      ? ((stillInFlightAtDeadline > 0)
        ? `NOT MEASURED: ${stillInFlightAtDeadline}/${sentAt.size} deliveries were still `
          + `in flight at +${3 * USEFUL_REPORT_LATENCY_MS}ms — a slow server, not a `
          + `verdict on the resend`
        : 'NOT MEASURED: no terminal event and no settled state at all — suspect the '
          + 'measurement before the mechanism (see pollCurrentStates above)')
      : ((withinUseful === 0)
        ? `RESEND USELESS: every report later than ${USEFUL_REPORT_LATENCY_MS}ms`
        : `RESEND USEFUL for ${withinUseful}/${reported} reports`);
    await logInfo(
      `[asmail-load] ${caseId}: sent=${sentAt.size} reported=${reported} `
        + `unreported=${unreported} stillInFlight=${stillInFlightAtDeadline} `
        + `medianMs=${median ?? '-'} maxMs=${maxMs ?? '-'} `
        + `withinUsefulMs(${USEFUL_REPORT_LATENCY_MS})=${withinUseful} `
        + `allDone=${JSON.stringify(outcomes)} via=${JSON.stringify(sources)} → ${verdict}`,
    );

    // Deliberately not an assertion on the latency: this case exists to produce
    // the number on whatever stand it runs against, and a degraded server must
    // not turn the diagnostic into a red suite.
    expect(sentAt.size).toBeGreaterThan(0);
  }, 180_000);
});
