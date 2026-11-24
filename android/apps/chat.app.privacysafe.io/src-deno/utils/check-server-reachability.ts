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
// The component's own probe of the user's mail server, for the status line of
// the window (see src-main/common/utils/connectivity-status.ts). Ported from
// the inbox app.
//
// Not inbox.listMsgs, though the catch-up scan makes that request anyway: the
// platform swallows a failure to connect there and answers from its local
// index, so neither its success nor its failure says anything about the
// server. A pre-flight to the user's own address does reach the server - the
// same one the sync phantoms are delivered to - and fails with a `connect`
// exception when it cannot.
//
// One request at the start, then one a minute and only while the server stays
// out of reach: nowhere near the bursts of parallel sessions the ASMail server
// answers with 500.
import { makeLogger } from '../../shared-libs/logger.ts';
import type { ServerReachability } from '../../types/services.types.ts';

const log = makeLogger('ServerReachability');

/**
 * How long the probe may take before the server counts as unreachable, rather
 * than holding the status for the platform's own network timeouts.
 */
export const SERVER_PROBE_TIMEOUT_MS = 10000;

/** How often the probe is repeated while the server stays out of reach. */
export const SERVER_REPROBE_INTERVAL_MS = 60000;

let lastReachability: ServerReachability = 'unknown';

/**
 * What the probe last learned. Kept for a window that subscribes to the
 * events only after the probe has had its answer.
 */
export function getLastServerReachability(): ServerReachability {
  return lastReachability;
}

/** Rejects like a failure to connect once timeoutMs passes. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const exc: web3n.ConnectException = {
        runtimeException: true,
        type: 'connect',
        connectType: 'timeout',
      };
      reject(exc);
    }, timeoutMs);
  });
  // The request itself cannot be cancelled; its late outcome is dropped.
  promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Asks the server once and reports the outcome. Resolves to true when the
 * server answered, false when it could not be reached, and undefined when the
 * probe failed for another reason - which says nothing about the server and is
 * not reported.
 */
export async function probeServerReachability(
  ownAddr: string,
  onResult: (reachable: boolean) => void,
  timeoutMs = SERVER_PROBE_TIMEOUT_MS,
): Promise<boolean | undefined> {
  const delivery = w3n.mail?.delivery;
  if (!delivery) {
    return undefined;
  }
  let reachable: boolean;
  try {
    await withTimeout(delivery.preFlight(ownAddr), timeoutMs);
    reachable = true;
  } catch (err) {
    if ((err as web3n.ConnectException)?.type !== 'connect') {
      log.error('The probe of the server failed for a reason other than the connection', err);
      return undefined;
    }
    reachable = false;
  }
  lastReachability = reachable ? 'up' : 'down';
  onResult(reachable);
  return reachable;
}

/**
 * Probes the server now, and again every SERVER_REPROBE_INTERVAL_MS for as long
 * as it cannot be reached. Once it answers, the platform's inbox socket is what
 * tells the window about it.
 */
export function watchServerReachability(
  ownAddr: string,
  onResult: (reachable: boolean) => void,
  intervalMs = SERVER_REPROBE_INTERVAL_MS,
): void {
  const run = async (): Promise<void> => {
    const reachable = await probeServerReachability(ownAddr, onResult);
    if (reachable === false) {
      setTimeout(run, intervalMs);
    }
  };
  void run();
}
