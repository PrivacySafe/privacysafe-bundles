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
 * A logger with levels, the same as the one of the chat app.
 *
 * Everything goes through `w3n.log`, never `console`: with `logToPlatform` the
 * platform appends these lines to the app's own file,
 * `<data-dir>/util/logs/<UTC date>.files.app.privacysafe.io.log.txt`, whereas
 * console output reaches only the devtools of a window or the stdout of the
 * test stand, and is lost after the run.
 *
 * `debug()` costs a comparison when diagnostics are off, and diagnostics are
 * off by default. They are switched on by the launcher's app configuration,
 * and thus without rebuilding anything - see initDebugLogging() below.
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
 * directory hosts several accounts across sessions - without the address in
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
 * capability logs without it forever - never a startup failure.
 */
function initLogUserAddress(): void {
  if (logUserAddress) {
    return;
  }
  try {
    const addrPromise = w3n.mailerid?.getUserId?.();
    addrPromise
      ?.then(addr => {
        if (addr && !logUserAddress) {
          logUserAddress = addr;
        }
      })
      .catch(() => {
        // No identity - log lines just stay unprefixed.
      });
  } catch {
    // Same: identity lookup must never break logging or startup.
  }
}

/**
 * Reads the diagnostic switch from the launcher's app configuration.
 *
 * `allowShowingDevtool` is that switch: it is the app's existing "developer
 * mode" flag, the user can flip it in the launcher, and every component of
 * this app can read it (see `shell.fsResource` in manifest.json).
 *
 * An unreadable configuration means diagnostics stay off; it must not keep the
 * app from starting.
 */
export async function initDebugLogging(): Promise<boolean> {
  initLogUserAddress();
  try {
    const file = (await w3n.shell!.getFSResource!(LAUNCHER_APP, UI_SETTINGS_RESOURCE)) as web3n.files.ReadonlyFile;
    const { allowShowingDevtool } = await file.readJSON<{ allowShowingDevtool?: boolean }>();
    setDebugLogging(!!allowShowingDevtool);
  } catch {
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
 * Wall-clock time of the line, `HH:MM:SS.mmm`.
 *
 * Put into the message itself, not left to the platform: the platform stamps
 * an entry with seconds only, and the order of events across the background
 * component and the windows is what a sync problem raises questions about.
 */
function timeOfLine(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function emit(type: 'error' | 'info' | 'warning', scope: string, msg: string, details?: unknown): void {
  const userPrefix = logUserAddress ? `[${logUserAddress}] ` : '';
  const line = `${timeOfLine()} ${userPrefix}[${scope}] ${msg}`;
  try {
    w3n.log(type, line, details).catch(() => {
      // Nothing sensible to do about a failing log, and certainly not another log
    });
  } catch {
    // Same: a component without `logToPlatform` has no `w3n.log` at all.
  }
}

/**
 * A logger tagging its lines with the given scope, e.g. 'SyncService'.
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
