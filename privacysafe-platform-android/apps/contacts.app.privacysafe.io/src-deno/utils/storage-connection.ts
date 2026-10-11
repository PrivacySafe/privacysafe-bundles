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
// Everything this service knows about the state of its connection to the
// storage server. Both functions here exist because fs.v.sync.whenConnected()
// cannot be relied on; waitForOnline below says why.
import { sleep } from '../../shared-libs/processes/sleep.ts';

/** How the platform names the storage service in a connectivity event. */
const STORAGE_SERVICE = 'storage';

/**
 * Resolves as soon as the platform reports the device online, or after
 * timeoutMs - whichever comes first.
 *
 * Why not fs.v.sync.whenConnected(): that awaits a ONE-SHOT latch inside the
 * storage session. The latch is cleared when the event socket reports
 * 'disconnected', and the socket is restarted only for connect and websocket
 * errors - a graceful close (code 1000) completes its stream instead, and is
 * never restarted, so whenConnected() then never resolves again for the whole
 * life of the process. Seen for real in the live test of 2026-08-22: the
 * network came back and the upload hold was never lifted.
 *
 * w3n.connectivity is an independent source of truth - the platform's own
 * net.isOnline() - and it also ticks on its own every 30s, so this wait cannot
 * outlive the connection coming back. The timeout covers the case of the
 * connectivity cap being absent, or its events never arriving.
 *
 * @return whether the platform actually reported the device online. False means
 * the wait ended on its timeout, which the caller needs in order to tell "still
 * offline" from "online, and the storage still refuses to work".
 */
export async function waitForOnline({ timeoutMs }: { timeoutMs: number }): Promise<boolean> {
  const connectivity = w3n.connectivity;
  if (!connectivity?.watch) {
    await sleep(timeoutMs);
    return false;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    return await new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      unsubscribe = connectivity.watch({
        next: event => {
          if (event.isOnline) {
            resolve(true);
          }
        },
        // Losing the events is not a reason to keep waiting: the caller retries
        // anyway, and a wait that cannot end is the very failure being avoided.
        error: () => resolve(false),
        complete: () => resolve(false),
      });
    });
  } finally {
    // Both assignments above have happened by now, even if watch() delivered an
    // event synchronously: this runs a microtask after the promise settles.
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    unsubscribe?.();
  }
}

/**
 * Calls onReconnected once after the storage event socket has been reported
 * broken and the device looks online again. Answers with an unsubscribe.
 *
 * TEMPORARY FALLBACK, and deliberately not a poll of the server. The right
 * mechanism is fs.watchTree, whose remote-change events come from that very
 * socket. When the socket dies in a way the platform does not restart, those
 * events stop for the rest of the process's life and two devices stop
 * converging altogether - so the break has to be noticed some other way. The
 * connectivity events used here are emitted by the very same platform code
 * that runs the socket, which is why a break is an EVENT here rather than
 * something guessed at by a timer.
 *
 * Delete this function, and its call site, once the platform restarts the
 * socket on its own; fs.watchTree is then sufficient again.
 */
export function watchStorageReconnection(onReconnected: () => void): () => void {
  const connectivity = w3n.connectivity;
  if (!connectivity?.watch) {
    return () => undefined;
  }

  let wasBroken = false;

  return connectivity.watch({
    next: event => {
      const { wsEvent } = event;
      const isBreak = !!wsEvent
      && (wsEvent.service === STORAGE_SERVICE)
      && ((wsEvent.type === 'disconnected') || (wsEvent.type === 'heartbeat-skip'));

      // A break is reported together with isOnline, which offline-driven breaks
      // and a graceful close in the middle of a live connection both do, so it
      // must not be read as a reconnection in the same breath.
      if (isBreak) {
        wasBroken = true;
        return;
      }

      if (wasBroken && event.isOnline) {
        wasBroken = false;
        onReconnected();
      }
    },
    error: err => w3n.log(
      'error', 'Error while watching the connectivity of the storage service', err,
    ),
  });
}
