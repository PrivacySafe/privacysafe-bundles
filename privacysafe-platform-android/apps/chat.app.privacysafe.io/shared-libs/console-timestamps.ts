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
 * Wall-clock timestamps on every console line of a window.
 *
 * The call window logs a few hundred lines per call (371 console call sites in
 * src-video alone) and none of them carried a time. That is fine for reading a
 * single line and useless for the questions a call actually raises, all of which
 * are about ORDER and INTERVAL across logs: did this tile appear before or after
 * the peer's re-join offer; how long did the answer take; is this retry the one
 * that fired 45s ago. The group-call analysis of 2026-08-13 stalled on exactly
 * that — two readings of one log, no way to tell them apart.
 *
 * Deliberately NOT a wrapper function around console.log. A wrapper is called
 * from here, so devtools attributes every line to this file and the
 * `host-channel.ts:2417` links — the other half of what makes these logs
 * readable — all disappear. Instead each method becomes an accessor that hands
 * back the NATIVE method with the timestamp already bound as its first argument:
 * the call then happens at the original call site, with the native function, so
 * the source link is exactly what it was.
 *
 * Two consequences of binding the stamp rather than formatting inside a wrapper:
 *
 * - The stamp is taken when `console.log` is *read*, i.e. immediately before the
 *   call. Sub-millisecond difference from the call itself; irrelevant here.
 * - Code that captures the method once (`const log = console.log`) freezes the
 *   stamp it captured. Nothing in this app does, and a stale stamp on such a
 *   line is still better than none.
 *
 * The platform's own console output (the `[DeliveryConfirm] …` lines that come
 * through `w3n.log`) shares this window's console, so it gets stamped too — and
 * loses nothing, since those lines are already attributed to a platform bundle.
 *
 * Not gated on the diagnostic switch: these lines are printed either way, and a
 * time is not extra output. The deno side stamps its own lines in logger.ts.
 */

/** Text-logging methods only: console.table/group/dir format their own output. */
const TIMESTAMPED_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

let installed = false;

/** `HH:MM:SS.mmm`, to line up with the platform's own `0813/144618.715053`. */
function timestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Prefixes every console line of this window with the wall-clock time, keeping
 * devtools' source links intact. Idempotent; call once, as early as possible.
 */
export function installConsoleTimestamps(): void {
  if (installed || (typeof console !== 'object') || !console) {
    return;
  }
  installed = true;
  for (const name of TIMESTAMPED_METHODS) {
    const native = console[name];
    if (typeof native !== 'function') {
      continue;
    }
    Object.defineProperty(console, name, {
      configurable: true,
      enumerable: true,
      get: () => native.bind(console, timestamp()),
      // Kept assignable: a library that installs its own console hook must not
      // die on a read-only property.
      set: () => {},
    });
  }
}
