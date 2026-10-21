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
 * Calls into the background component that cannot hang forever.
 *
 * The problem this solves is not slowness, it is indistinguishability. A
 * connection to 'AppChatsInternal' always succeeds - the component exposes its
 * facade before building anything (facadeOver in chat-service/ipc-expose.ts) -
 * and every method behind that facade waits for the real service. So a call
 * that has not come back can mean either "the databases are still opening" or
 * "this component stopped answering hours ago", and on 2026-09-10 the window
 * sat on the second one showing a spinner until the app was restarted.
 *
 * `ping()` is what tells them apart: it answers from the component's own
 * state, so a component that is merely slow still answers, and one that has
 * stopped answers nothing. That is what lets a call be given up on without
 * cutting short a legitimately slow start: the window timer only decides when
 * to ASK, never that the wait is over.
 */

import { wrapWithTimeout } from '@shared/processes/timeouts';
import { sleep } from '@shared/processes/sleep';
import { makeLogger } from '@shared/logger';
import { chatService } from '@main/common/services/external-services';
import type { ComponentStatus } from '~/index.ts';

const log = makeLogger('BackendAvailability');

/**
 * How long a ping may take before the component counts as not answering.
 *
 * A ping touches no storage, so on an idle component the answer is immediate -
 * but "immediate" is a property of the component's event loop, and that loop
 * is busiest exactly when the ping matters: opening databases, running a
 * catch-up scan of the inbox. At three seconds this fired against a live
 * component on a freshly created user (test run of 2026-09-10), which in
 * production is the "service is not responding" screen shown to somebody whose
 * app is merely starting. Generous here costs only how long a genuinely dead
 * component takes to be called dead, and that verdict is never urgent.
 */
export const PING_TIMEOUT_MILLIS = 10_000;

/**
 * Pings that must go unanswered in a row before the component is declared
 * unreachable. One unanswered ping is a busy event loop; two, with a wait in
 * between, is not.
 */
const PINGS_BEFORE_UNREACHABLE = 2;

/** Pause between those attempts, to let a busy loop get to the second one. */
const PING_RETRY_PAUSE_MILLIS = 2_000;

/** How long a call may run before we ask the component whether it is alive. */
export const FIRST_CALL_WINDOW_MILLIS = 20_000;

/**
 * The same, for the connect barrier at start-up. Longer, because it covers the
 * platform's own connect timeout (10 s per service) with room to spare.
 */
export const CONNECT_TIMEOUT_MILLIS = 30_000;

/**
 * How many windows a call gets while the component keeps saying it is still
 * starting. Bounded so a component stuck on one stage forever eventually
 * surfaces as a failure rather than as a spinner with a caption.
 */
const MAX_STILL_STARTING_WINDOWS = 30;

export type BackendVerdict =
  | { kind: 'starting'; status: ComponentStatus }
  | { kind: 'ready' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unreachable'; err: unknown };

export class BackendUnreachableError extends Error {
  readonly backendUnreachable = true;

  constructor(what: string, readonly cause?: unknown) {
    super(`The chat background service did not answer a ping while '${what}' was pending`);
    this.name = 'BackendUnreachableError';
  }
}

export function isBackendUnreachable(err: unknown): err is BackendUnreachableError {
  return !!(err as BackendUnreachableError)?.backendUnreachable;
}

/**
 * Asks the component where it stands. Never throws: the verdict is the answer.
 *
 * "Unreachable" is only returned after more than one ping goes unanswered,
 * because that verdict costs the user a screen telling them their app is
 * broken. A single slow ping is a busy event loop - which is the normal state
 * of a component that is opening databases or catching up on its inbox.
 */
export async function probeBackend(): Promise<BackendVerdict> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= PINGS_BEFORE_UNREACHABLE; attempt += 1) {
    try {
      const status = await wrapWithTimeout(
        chatService.ping(),
        PING_TIMEOUT_MILLIS,
        () => Error(`Ping of the chat background service timed out`),
      );
      if (status.failed) {
        return { kind: 'failed', reason: status.failed };
      }
      return status.ready ? { kind: 'ready' } : { kind: 'starting', status };
    } catch (err) {
      lastErr = err;
      if (attempt < PINGS_BEFORE_UNREACHABLE) {
        log.info(`ping ${attempt} of the background service went unanswered; asking again`);
        await sleep(PING_RETRY_PAUSE_MILLIS);
      }
    }
  }
  return { kind: 'unreachable', err: lastErr };
}

/**
 * Human-readable "what it is doing", for a caption under a spinner.
 */
export function describeStartingStatus(status: ComponentStatus): string {
  const seconds = Math.round((status.stageMillis ?? status.uptimeMillis) / 1000);
  return status.stage ? `${status.stage}, ${seconds}s` : `${seconds}s`;
}

/**
 * Runs a call to the background component, and while it is pending, keeps
 * checking whether the component is still alive.
 *
 * Resolves with the call's own result, rejects with the call's own error, or
 * rejects with BackendUnreachableError when the component stops answering
 * pings. Nothing is cancelled on our side - IPC calls cannot be recalled - so
 * a late answer is simply ignored.
 */
export async function callBackend<T>(
  what: string,
  call: () => Promise<T>,
  opts?: {
    windowMillis?: number;
    onStillStarting?: (status: ComponentStatus) => void;
  },
): Promise<T> {
  const windowMillis = opts?.windowMillis ?? FIRST_CALL_WINDOW_MILLIS;
  const callProc = call();
  // Rejections are consumed by the races below; without this a window that
  // ends before the call does turns its later failure into an unhandled
  // rejection.
  callProc.catch(() => {});

  for (let window = 0; window < MAX_STILL_STARTING_WINDOWS; window += 1) {
    try {
      return await wrapWithTimeout(
        callProc,
        windowMillis,
        () => Object.assign(Error(`window elapsed`), { windowElapsed: true }),
      );
    } catch (err) {
      if (!(err as { windowElapsed?: boolean })?.windowElapsed) {
        throw err;
      }
    }
    const verdict = await probeBackend();
    if (verdict.kind === 'unreachable') {
      log.error(`'${what}' is pending and the background service answers no ping`, verdict.err);
      throw new BackendUnreachableError(what, verdict.err);
    } else if (verdict.kind === 'failed') {
      log.error(`'${what}' is pending and the background service reports a failed start: ${verdict.reason}`);
      throw new BackendUnreachableError(what, verdict.reason);
    } else if (verdict.kind === 'starting') {
      // Alive, just not there yet: opening databases on synced storage takes
      // as long as it takes, and cutting a live start short would turn a slow
      // launch into a broken one. Say so and keep waiting.
      log.info(`'${what}' waits on a service still starting (${describeStartingStatus(verdict.status)})`);
      opts?.onStillStarting?.(verdict.status);
    } else {
      // Ready, yet this call has not returned. One more window, and then it is
      // the call that is stuck rather than the start.
      log.warn(`'${what}' has not returned though the background service reports itself ready`);
      try {
        return await wrapWithTimeout(
          callProc,
          windowMillis,
          () => Object.assign(Error(`window elapsed`), { windowElapsed: true }),
        );
      } catch (err) {
        if (!(err as { windowElapsed?: boolean })?.windowElapsed) {
          throw err;
        }
        throw new BackendUnreachableError(what);
      }
    }
  }
  throw new BackendUnreachableError(what);
}
