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

const PING_TIMEOUT = 'ping-timeout';

/**
 * Watches that the storage service (the Deno component) still answers.
 * When its connection to the platform breaks, calls neither fail nor return,
 * so the GUI would wait forever. The service is pinged periodically; after
 * `maxFailures` failed or unanswered pings in a row, or on `reportFailure()`
 * (e.g. the event subscription failed), `onUnavailable` is called once.
 * Nothing is reported before start() and after stop().
 */
export function createServiceHealthCheck({
  ping,
  onUnavailable,
  interval = 30000,
  timeout = 15000,
  maxFailures = 2,
}: {
  ping: () => Promise<unknown>;
  onUnavailable: (reason: unknown) => void;
  interval?: number;
  timeout?: number;
  maxFailures?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let isReported = false;
  let isStopped = true;

  function report(reason: unknown) {
    // after stop() the app is closing, and its closed connections are not a failure
    if (isReported || isStopped) {
      return;
    }
    isReported = true;
    stop();
    onUnavailable(reason);
  }

  async function check() {
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ping(),
        new Promise((_, reject) => {
          timeoutTimer = setTimeout(() => reject(PING_TIMEOUT), timeout);
        }),
      ]);
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures >= maxFailures) {
        report(err);
      }
    } finally {
      clearTimeout(timeoutTimer);
    }

    if (!isStopped) {
      timer = setTimeout(check, interval);
    }
  }

  function start() {
    if (!isStopped || isReported) {
      return;
    }
    isStopped = false;
    timer = setTimeout(check, interval);
  }

  function stop() {
    isStopped = true;
    clearTimeout(timer);
  }

  return {
    start,
    stop,
    reportFailure: report,
  };
}
