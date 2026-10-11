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
import { chatService } from '@main/common/services/external-services';
import { makeBatchingLogRelay, shouldRelayLogs } from '@shared/log-relay';
import { setLogRelay } from '@shared/logger';
import { wrapWithTimeout } from '@shared/processes/timeouts';

/** Long enough never to fire on a working component, short enough to matter. */
const LOG_RELAY_TIMEOUT_MILLIS = 10_000;

/**
 * Sends this window's log lines to the background component, which prints them
 * into the output the whole run is read from (see ChatSrv.logFromGui).
 *
 * Called once the services are up: `chatService` is the channel, and the relay
 * asks for it on every flush rather than capturing it, so a batch written
 * before the connection existed still goes out with the first one after.
 *
 * Does nothing outside the test stand - see shouldRelayLogs() for why.
 */
export function startMainWindowLogRelay(): void {
  if (!shouldRelayLogs(w3n as { testStand?: unknown })) {
    return;
  }
  const { relay, flush } = makeBatchingLogRelay(() => (
    chatService
      ? lines => {
        // Not awaited, and its failure is swallowed: this is the log path, and
        // making the code that logs wait on IPC would change the timing of
        // exactly what is being observed.
        //
        // Timed out all the same: against a background component that has
        // stopped answering, every batch would otherwise leave a promise
        // pending for the life of the window.
        wrapWithTimeout(
          chatService.logFromGui(lines),
          LOG_RELAY_TIMEOUT_MILLIS,
          () => Error(`Relaying log lines to the background component timed out`),
        ).catch(() => {});
      }
      : undefined
  ));
  setLogRelay(relay);
  // A best effort on the way out: the send is asynchronous, so a window closing
  // may still lose the last batch - which is why the batch window is short.
  globalThis.addEventListener?.('beforeunload', () => flush());
}
