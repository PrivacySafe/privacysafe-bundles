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
 * One line a minute saying this component is still running.
 *
 * The reason it exists: on 2026-09-10 the component stopped mid-call, and the
 * only thing that dated the stop to within 30 seconds was an unrelated line
 * that sync-phantoms happens to write while a call holds the journal. Outside
 * a call the component writes nothing periodically at all, so the same failure
 * on an ordinary day would have had no time attached to it whatsoever.
 *
 * A heartbeat cannot prevent the component from dying and does not try to. It
 * makes the death dated, and - through the details other modules register
 * here - says what the component was carrying at the time.
 */

import { makeLogger } from '../../shared-libs/logger.ts';
import { componentStatus } from './startup-progress.ts';

const log = makeLogger('Heartbeat');

/**
 * Dense while starting, sparse once up: the start is where we are blind, and a
 * component that hangs on opening its databases should say so several times
 * before anyone gives up on it. A minute afterwards costs ~1400 lines a day
 * and buys a death dated to within that minute.
 */
const HEARTBEAT_WHILE_STARTING_MILLIS = 15000;
const HEARTBEAT_WHEN_READY_MILLIS = 60000;

/**
 * What subsystems add to the line. Registered after they are built - the same
 * shape as setPhantomReleaseBusyCheck in index.ts - because the heartbeat has
 * to start before any of them exist.
 */
const details = new Map<string, () => string>();

export function addHeartbeatDetail(name: string, get: () => string): void {
  details.set(name, get);
}

function memoryPart(): string {
  // Guarded rather than called: the bundle is built with esbuild's `platform:
  // 'node'` and injects its own `Deno.env` mock (ci/build-deno.js), so the
  // shape of this global is not something to take on trust.
  try {
    const memoryUsage = (globalThis as {
      Deno?: { memoryUsage?: () => { rss: number; heapUsed: number; heapTotal: number } };
    }).Deno?.memoryUsage;
    if (typeof memoryUsage !== 'function') {
      return '';
    }
    const { rss, heapUsed, heapTotal } = memoryUsage();
    const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
    return `, rss ${mb(rss)}MB, heap ${mb(heapUsed)}/${mb(heapTotal)}MB`;
  } catch {
    return '';
  }
}

function uptimePart(millis: number): string {
  const totalSeconds = Math.round(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return (minutes > 0) ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function detailsPart(): string {
  const parts: string[] = [];
  for (const [name, get] of details) {
    try {
      const value = get();
      if (value) {
        parts.push(`${name} ${value}`);
      }
    } catch (err) {
      // A detail that throws must not cost the line that carries it: the point
      // of the heartbeat is that it keeps coming.
      parts.push(`${name} unavailable`);
      log.debug(`heartbeat detail '${name}' threw`, err);
    }
  }
  return (parts.length > 0) ? `, ${parts.join(', ')}` : '';
}

function beat(): void {
  const { uptimeMillis, ready, failed, stage, stageMillis } = componentStatus();
  const state = failed
    ? `failed (${failed})`
    : (ready ? 'ready' : `starting at '${stage ?? 'none'}' for ${Math.round((stageMillis ?? 0) / 1000)}s`);
  log.info(
    `uptime ${uptimePart(uptimeMillis)}, ${state}${memoryPart()}${detailsPart()}`,
  );
}

/**
 * Starts the heartbeat, returning a function that stops it. Called as the very
 * first thing the component does, before any capability is touched: a process
 * that dies while opening its own storage still gets to say that it started.
 */
export function startComponentHeartbeat(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  let stopped = false;

  const schedule = () => {
    if (stopped) {
      return;
    }
    const interval = componentStatus().ready
      ? HEARTBEAT_WHEN_READY_MILLIS
      : HEARTBEAT_WHILE_STARTING_MILLIS;
    timer = setTimeout(() => {
      try {
        beat();
      } catch {
        // Diagnostics may not break what they observe, and a heartbeat that
        // stops on its own first bad line is worse than no heartbeat: the gap
        // would read as a death.
      }
      schedule();
    }, interval);
  };

  schedule();

  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
