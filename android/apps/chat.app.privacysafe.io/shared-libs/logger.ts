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
 * A logger with levels, for code that runs in hot paths.
 *
 * Two things it is for:
 *
 *  - `debug()` costs a comparison when diagnostics are off, and diagnostics are
 *    off by default. Signalling, track handling and delivery progress produce a
 *    line per event, and those lines were unconditional console output;
 *  - everything goes through `w3n.log`, never `console`, so that a production
 *    build can drop console entirely (esbuild `drop: ['console']` for the Deno
 *    bundle) without losing the diagnostics that are worth keeping.
 *
 * Diagnostics are switched on by the launcher's app configuration, and thus
 * without rebuilding anything - see initDebugLogging() below.
 *
 * Calls do not need awaiting: a logger that made a caller wait on the platform
 * log would change the timing of what it observes. Failures of the platform log
 * itself are swallowed, for the same reason.
 */

const LAUNCHER_APP = 'launcher.app.privacysafe.io';
const UI_SETTINGS_RESOURCE = 'ui-settings';

let debugEnabled = false;

export function isDebugLogging(): boolean {
  return debugEnabled;
}

export function setDebugLogging(on: boolean): void {
  debugEnabled = on;
}

/**
 * The user address every log line is prefixed with once known.
 *
 * The platform's util/logs files are per data directory, and a test-stand
 * directory hosts several accounts across sessions — without the address in
 * the line itself, errors cannot be attributed to the account that produced
 * them.
 */
let logUserAddress = '';

export function setLogUserAddress(addr: string): void {
  logUserAddress = addr;
}

/**
 * Fetches the user address for log lines from whatever identity capability
 * this component has. Fire-and-forget: lines logged before the address
 * arrives simply go without the prefix, and a component with no identity
 * capability logs without it forever — never a startup failure.
 */
function initLogUserAddress(): void {
  if (logUserAddress) {
    return;
  }
  try {
    const addrPromise = w3n.mailerid?.getUserId?.() ?? w3n.mail?.getUserId?.();
    addrPromise?.then(addr => {
      if (addr && !logUserAddress) {
        logUserAddress = addr;
      }
    }).catch(() => {
      // No identity — log lines just stay unprefixed.
    });
  } catch {
    // Same: identity lookup must never break logging or startup.
  }
}

/**
 * Reads the diagnostic switch from the launcher's app configuration.
 *
 * `allowShowingDevtool` is that switch: it is the app's existing "developer
 * mode" flag, the user can flip it in the launcher, and every instance of this
 * app - the background one and every window - can read it. Introducing a
 * separate flag would need a place for the user to set it, which is exactly
 * what this one already has.
 *
 * An unreadable configuration means diagnostics stay off; it must not keep the
 * app from starting.
 */
export async function initDebugLogging(): Promise<boolean> {
  initLogUserAddress();
  try {
    const file = (await w3n.shell!.getFSResource!(
      LAUNCHER_APP,
      UI_SETTINGS_RESOURCE,
    )) as web3n.files.ReadonlyFile;
    const { allowShowingDevtool } = await file.readJSON<{ allowShowingDevtool?: boolean }>();
    setDebugLogging(!!allowShowingDevtool);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    setDebugLogging(false);
  }
  return debugEnabled;
}

export interface Logger {
  /** Silent unless diagnostics are on. For per-event lines in hot paths. */
  debug(msg: string, details?: unknown): void;
  info(msg: string, details?: unknown): void;
  warn(msg: string, details?: unknown): void;
  error(msg: string, err?: unknown): void;
}

/**
 * Wall-clock time of the line, in the same `HH:MM:SS.mmm` shape the call
 * windows use (shared-libs/console-timestamps.ts).
 *
 * Put into the message itself, not left to the platform: what a call raises
 * questions about is the ORDER of events across the background process and the
 * call window, and the test-stand's aggregated output carries no time of its
 * own — so a heartbeat resend and the tile it explains could not be lined up.
 */
function timeOfLine(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Where a window's lines go besides its own devtools console: see log-relay.ts.
 *
 * Unset in the background component, which needs no relay - its `w3n.log` lines
 * already reach the place everything is read from. That is also what keeps the
 * relay from feeding itself: only a window ever sets one.
 */
let logRelay: LogRelay | undefined = undefined;

export type LogRelay = (
  type: 'error' | 'info' | 'warning', line: string, details?: unknown,
) => void;

export function setLogRelay(relay: LogRelay | undefined): void {
  logRelay = relay;
}

function emit(type: 'error' | 'info' | 'warning', scope: string, msg: string, details?: unknown): void {
  const userPrefix = logUserAddress ? `[${logUserAddress}] ` : '';
  const line = `${timeOfLine()} ${userPrefix}[${scope}] ${msg}`;
  w3n.log(type, line, details).catch(() => {
    // Nothing sensible to do about a failing log, and certainly not another log
  });
  if (logRelay) {
    // The composed line, not its parts: the relay's job is to carry it, and the
    // side that prints it must not stamp it a second time.
    try {
      logRelay(type, line, details);
    } catch {
      // Same rule as above, and more so: the relay is diagnostics, and
      // diagnostics may not break what they observe.
    }
  }
}

/**
 * A logger tagging its lines with the given scope, e.g. 'CallInChat'.
 */
export function makeLogger(scope: string): Logger {
  return {
    debug(msg, details) {
      if (debugEnabled) {
        emit('info', scope, msg, details);
      }
    },
    info(msg, details) {
      emit('info', scope, msg, details);
    },
    warn(msg, details) {
      emit('warning', scope, msg, details);
    },
    error(msg, err) {
      emit('error', scope, msg, err);
    },
  };
}
