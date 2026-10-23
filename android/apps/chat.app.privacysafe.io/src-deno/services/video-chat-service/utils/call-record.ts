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
 * Choosing WHICH chat history record a finished call's duration is stamped onto.
 *
 * Pure - it is handed the candidate records and `now`, and returns one of them -
 * so the rules below are covered by spec directly (see tests-app's video-chat.ts).
 *
 * It exists because the previous inline version got this wrong in a way that
 * only luck hid. It sorted with `(a, b) => (a.timestamp - b.timestamp ? -1 : 1)`,
 * which returns -1 for ANY two differing timestamps, i.e. does not order at all
 * (V8 happens to reverse a strictly ascending input with such a comparator,
 * which is why the newest record came out first in practice). It then insisted
 * the record it landed on be an `event: 'call'` one, and gave up otherwise - so
 * any other system event recorded during the call (a chat rename, a
 * 'member-left', the 'webrtc-call' cancellation that a host's teardown itself
 * writes) meant the duration was never stored. And since stamping is idempotent
 * - nothing revisits a call record afterwards - "never" is literal.
 */

/** The little a stamping decision needs of a message record. */
export interface CallRecordCandidate {
  chatMessageId: string;
  /** Serialized ChatSystemMessageData, or null for a record without a body. */
  body: string | null;
  timestamp: number;
}

/**
 * How old a call record may be and still be stamped by a heuristic pick.
 *
 * Only the fallback path needs it: an `endTimestamp` on a record from days ago
 * renders as a call that lasted days, and the history template clamps only
 * negative durations. A call that ran longer than this is not something the
 * fallback should be guessing about; the id-based path (see `chatMessageId`
 * below) has no such bound, because there the record is known rather than
 * guessed.
 */
export const CALL_RECORD_STAMP_MAX_AGE_MILLIS = 24 * 60 * 60 * 1000;

export interface CallRecordPick {
  candidate: CallRecordCandidate;
  /** Parsed body, with `value.endTimestamp` still unset. */
  body: { event: 'call'; value: { endTimestamp?: number | null } & Record<string, unknown> };
}

function parseCallBody(candidate: CallRecordCandidate): CallRecordPick['body'] | undefined {
  if (!candidate.body) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.body);
  } catch {
    // A record whose body is not JSON is not a call record; nothing to stamp.
    return undefined;
  }
  const body = parsed as CallRecordPick['body'] | null;
  if (!body || (body.event !== 'call') || (typeof body.value !== 'object') || !body.value) {
    return undefined;
  }
  // Already stamped: a second stamp would move the end of a call that is over.
  if ((body.value.endTimestamp !== undefined) && (body.value.endTimestamp !== null)) {
    return undefined;
  }
  return body;
}

/**
 * The record to write `endTimestamp` onto, or `undefined` if there is none.
 *
 * `chatMessageId`, when the caller kept the id its own "call started" record was
 * written under, decides outright: it is the same call, and no heuristic can beat
 * knowing. It is optional because the id lives in memory only - a background
 * process restarted mid-call has lost it - and the heuristic then applies:
 *
 * - among `event: 'call'` records that carry no `endTimestamp` yet,
 * - the newest by `timestamp`,
 * - provided it is younger than CALL_RECORD_STAMP_MAX_AGE_MILLIS.
 *
 * Note what is NOT a criterion: being the last record in the chat. Every other
 * system event of the call (rename, member-left, the teardown's own
 * 'webrtc-call' cancellation) sits between the call record and the end of the
 * call, and each of them used to be enough to lose the duration.
 */
export function pickCallRecordToStamp(
  candidates: readonly CallRecordCandidate[],
  now: number,
  chatMessageId?: string,
): CallRecordPick | undefined {
  if (chatMessageId) {
    const named = candidates.find(c => c.chatMessageId === chatMessageId);
    const body = named && parseCallBody(named);
    if (named && body) {
      return { candidate: named, body };
    }
    // Falls through to the heuristic: the id may name a record already stamped
    // (this call's end reported twice) or one this device never stored.
  }

  let best: CallRecordPick | undefined = undefined;
  for (const candidate of candidates) {
    const body = parseCallBody(candidate);
    if (!body) {
      continue;
    }
    if ((now - candidate.timestamp) > CALL_RECORD_STAMP_MAX_AGE_MILLIS) {
      continue;
    }
    // Strictly newer, so that equal timestamps keep the first one seen - the
    // input's own order, which is the insertion order from the db.
    if (!best || (candidate.timestamp > best.candidate.timestamp)) {
      best = { candidate, body };
    }
  }
  return best;
}
