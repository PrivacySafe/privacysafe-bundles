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
 * Where this component is in its own start-up, and how long it has been there.
 *
 * Written after a production incident (2026-09-10) in which the component
 * stopped answering mid-call and every later start left no trace at all: the
 * first line the start-up used to write came only after the databases were
 * open, so a start that hung on storage was indistinguishable from a component
 * that never ran. Everything here exists to make that difference visible.
 *
 * Three readers, one source of truth:
 *   - the log, through `startupStage` below;
 *   - the heartbeat line (component-heartbeat.ts);
 *   - `ping()` on the IPC facade, which answers from this state rather than
 *     from the service being built, and is therefore the one call that can
 *     tell a slow start apart from a dead component.
 *
 * A leaf module on purpose: it imports the logger and nothing of the app.
 */

import { makeLogger } from '../../shared-libs/logger.ts';
import type { ComponentStatus } from '../../types/services.types.ts';

const log = makeLogger('ComponentStatus');

const startedAt = Date.now();

let ready = false;
let failed: string | undefined = undefined;

/**
 * Stages currently running, innermost last: stages nest (the `dataset` stage
 * contains `dataset/msgs-db`), and what a stuck start-up needs reported is the
 * innermost one - it names the actual call that is not coming back.
 */
const openStages: { name: string; since: number }[] = [];

export function componentStatus(): ComponentStatus {
  const now = Date.now();
  const innermost = openStages[openStages.length - 1];
  return {
    startedAt,
    uptimeMillis: now - startedAt,
    ready,
    ...(failed ? { failed } : {}),
    ...(innermost
      ? { stage: innermost.name, stageMillis: now - innermost.since }
      : {}),
  };
}

export function markComponentReady(): void {
  ready = true;
  failed = undefined;
}

export function markComponentFailed(err: unknown): void {
  ready = false;
  failed = errToText(err);
}

/**
 * Name of the stage that is running now, for a message that needs to say where
 * the component stands ('none' before the first stage and after the last).
 */
export function currentStageName(): string {
  return openStages[openStages.length - 1]?.name ?? 'none';
}

function errToText(err: unknown): string {
  if (!err) {
    return 'unknown error';
  } else if (typeof err === 'string') {
    return err;
  } else if (err instanceof Error) {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Runs one step of the start-up, logging when it begins, when it ends and how
 * long it took - and, while it has not ended, saying so again every
 * `warnEveryMillis`.
 *
 * It never interrupts the step. A slow start is legitimate: opening databases
 * on synced storage can take tens of seconds on a fresh user, and a timeout
 * here would turn a slow start into a broken one. The repeating warning is the
 * whole point - it is what turns "the log simply stops" into "the log keeps
 * saying which call has not returned for the last four minutes".
 *
 * At `info`, not `debug`: diagnostics are off in a production run, and a
 * `debug` line would have said nothing on exactly the run worth explaining.
 *
 * A stage need not be on the start's critical path. The inbox catch-up scan is
 * started and deliberately not awaited (inbox-dispatcher.ts), and it is wrapped
 * here all the same: the repeating warning is the only thing that says a
 * detached minute-long call is still out there. Such a stage stays open past
 * `markComponentReady()`, so `componentStatus()` can report a stage while
 * `ready` is true - which is the truth and reads as such (the heartbeat says
 * 'ready', and the GUI only asks for a stage name while it is not).
 */
export async function startupStage<T>(
  name: string, fn: () => Promise<T>, warnEveryMillis = 15000,
): Promise<T> {
  const since = Date.now();
  const stage = { name, since };
  openStages.push(stage);
  log.info(`start-up stage '${name}' begins`);
  const warnTimer = setInterval(() => {
    const seconds = Math.round((Date.now() - since) / 1000);
    log.warn(`start-up stage '${name}' has not finished in ${seconds}s`);
  }, warnEveryMillis);
  try {
    const res = await fn();
    log.info(`start-up stage '${name}' done in ${Date.now() - since}ms`);
    return res;
  } catch (err) {
    log.error(`start-up stage '${name}' failed after ${Date.now() - since}ms`, err);
    throw err;
  } finally {
    clearInterval(warnTimer);
    const i = openStages.indexOf(stage);
    if (i >= 0) {
      openStages.splice(i, 1);
    }
  }
}
