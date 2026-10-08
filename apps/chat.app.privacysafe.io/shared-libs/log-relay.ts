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
 * Carrying a window's log lines to the background component, which prints them
 * where the whole run can be read at once.
 *
 * The three parts of this app log to three different places: the background
 * component's lines reach the test stand's stdout, while each window's reach
 * only the devtools console of that window - and the call window exists only
 * for as long as the call does, so its lines are gone with it unless somebody
 * saved them in time. That is why the live run of 2026-08-16 could say nothing
 * about what the call window did. The platform's own log file is no help
 * either: it holds core entries only, not a line of this app's.
 *
 * A line is relayed exactly as the logger composed it (see makeLogger): the
 * time, the user address and the scope are already in the string, and the sink
 * must not stamp it again - the delivery time of a relayed line says nothing,
 * whereas the order of events across the three parts is the entire point.
 */

export type LogLevel = 'error' | 'info' | 'warning';

/**
 * Whether this run should relay a window's lines to the background at all.
 *
 * Only on the test stand, and the reason is in the header above: the relay is
 * there to put the three parts of the app into one readable stream, and that
 * stream exists only on the stand. In a production run every window has
 * `logToPlatform` of its own, so both copies of a line land in the same file -
 * proven on 2026-09-11, where each call-window line appears twice, once plain
 * and once as `[GUI:video] ...`.
 *
 * The duplicate is not just noise. It travels through the background component,
 * which writes it out with one awaited `w3n.log` per line into the same channel
 * to the core that the component's main thread was found blocked in when it
 * froze mid-call. Diagnostics must not be among the things loading the thing
 * they are there to explain.
 *
 * Takes w3n rather than reading the global, so that a spec can state both
 * answers without a platform under it.
 */
export function shouldRelayLogs(
  w3nLike: { testStand?: unknown } | undefined,
): boolean {
  return !!w3nLike?.testStand;
}

/** One relayed line. Everything in it is already a string, and so sendable. */
export interface GuiLogLine {
  level: LogLevel;
  /** Composed by makeLogger: `HH:MM:SS.mmm [user] [Scope] message`. */
  line: string;
  /** Whatever the call site passed as details, flattened for the wire. */
  details?: string;
}

/**
 * Details as a string, because the relay crosses IPC and an Error does not.
 *
 * Errors keep their stack: an error line without one is the half that never
 * says where it came from. Anything else goes through JSON, and a value that
 * JSON cannot take (a cycle, a BigInt) falls back on String() rather than
 * throwing - a logger must not fail on what it is asked to log.
 */
export function stringifyLogDetails(details: unknown): string | undefined {
  if (details === undefined || details === null) {
    return undefined;
  }
  if (typeof details === 'string') {
    return details;
  }
  if (details instanceof Error) {
    return details.stack || `${details.name}: ${details.message}`;
  }
  try {
    return JSON.stringify(details);
  } catch {
    try {
      return String(details);
    } catch {
      return '<details that cannot be turned into a string>';
    }
  }
}

/**
 * Lines waiting to be sent, with a hard bound on how many.
 *
 * Bounded because this is diagnostics: a window whose relay cannot reach the
 * background - it is starting up, the connection is gone, the background is
 * busy - must not grow a queue instead. Past the bound the OLDEST lines go, and
 * the count of them is reported in their place, so that a gap in the log reads
 * as a gap and not as silence.
 *
 * Pure and separate from any timer, so the rules above are covered by spec.
 */
export interface LogRelayBuffer {
  add(entry: GuiLogLine): void;
  /**
   * Everything buffered, in order, leaving the buffer empty. When lines were
   * dropped since the last take, a line saying so comes first.
   */
  take(): GuiLogLine[];
  readonly size: number;
}

export function makeLogRelayBuffer(limit: number): LogRelayBuffer {
  const entries: GuiLogLine[] = [];
  let dropped = 0;

  return {
    add(entry: GuiLogLine): void {
      entries.push(entry);
      while (entries.length > limit) {
        entries.shift();
        dropped += 1;
      }
    },
    take(): GuiLogLine[] {
      if (entries.length === 0) {
        return [];
      }
      const taken = entries.splice(0, entries.length);
      if (dropped > 0) {
        taken.unshift({
          level: 'warning',
          line: `${dropped} log line(s) dropped: the relay buffer of ${limit} was full`,
        });
        dropped = 0;
      }
      return taken;
    },
    get size(): number {
      return entries.length;
    },
  };
}

/** How many lines a window keeps while waiting to send them. */
export const LOG_RELAY_BUFFER_LIMIT = 200;

/**
 * How long lines wait to travel together.
 *
 * A call window writes far more lines than there should be IPC calls, and a
 * relay that sent each one as it happened would compete with the very
 * signalling it is there to explain. Short enough that a window closing loses
 * at most this much - the flush on the way out takes care of the rest.
 */
export const LOG_RELAY_FLUSH_MILLIS = 250;

/**
 * A relay function for setLogRelay(), batching lines behind `send`.
 *
 * `send` may be missing at first and appear later (the call window has no
 * channel to the background until the background subscribes to it): lines
 * written meanwhile wait in the buffer and go out with the first batch, up to
 * the bound above.
 */
export function makeBatchingLogRelay(
  send: () => ((lines: GuiLogLine[]) => void) | undefined,
  limit = LOG_RELAY_BUFFER_LIMIT,
  flushMillis = LOG_RELAY_FLUSH_MILLIS,
): {
  relay: (level: LogLevel, line: string, details?: unknown) => void;
  flush: () => void;
} {
  const buffer = makeLogRelayBuffer(limit);
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  function flush(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const sink = send();
    if (!sink || (buffer.size === 0)) {
      return;
    }
    const lines = buffer.take();
    try {
      sink(lines);
    } catch {
      // Swallowed on purpose, and the lines are not put back: a relay that
      // threw into its caller would take down the code it is watching, and one
      // that retried forever would keep the failed batch instead of the newer
      // lines that explain what is going on now.
    }
  }

  return {
    relay(level, line, details) {
      buffer.add({ level, line, details: stringifyLogDetails(details) });
      if (timer === undefined) {
        timer = setTimeout(flush, flushMillis);
      }
    },
    flush,
  };
}
