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
import type { TreasureEvent } from '../../shared/@types/common.types.ts';

/**
 * How long a request to the storage server may take before the server counts
 * as unreachable.
 */
export const SERVER_REQUEST_TIMEOUT_MS = 10000;

/**
 * The exception withTimeout rejects with. Typed as a `connect` failure on
 * purpose: every caller already reads that as "the server cannot be reached",
 * which is exactly what a request that does not answer in time means.
 */
export interface ServerTimeoutException extends web3n.ConnectException {
  timeout: true;
}

/**
 * Settles as the given promise does, or rejects with a ServerTimeoutException
 * once timeoutMs passes. The request itself is not cancelled - the platform
 * offers no way to - and is left to finish in the background; its late result
 * or failure is swallowed here.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const exc: ServerTimeoutException = {
        runtimeException: true,
        type: 'connect',
        connectType: 'timeout',
        timeout: true,
      };
      reject(exc);
    }, timeoutMs);
  });
  promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Whether the storage server answers right now. Bounded by
 * SERVER_REQUEST_TIMEOUT_MS: a server that does not answer in time counts as
 * unreachable, rather than holding things up for the platform's network
 * timeouts. The outcome is reported as a server:reachability event when
 * emitEvent is given, so that the window can tell "online" from "the network
 * is up, the server is not".
 */
export async function checkServerConnection(
  fs: web3n.files.WritableFS,
  {
    emitEvent,
    timeoutMs = SERVER_REQUEST_TIMEOUT_MS,
  }: {
    emitEvent?: (event: TreasureEvent) => void;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const status = fs.v?.sync?.status('');
  if (!status) {
    return false;
  }

  try {
    const res = await withTimeout(status, timeoutMs);
    emitEvent?.({ event: 'server:reachability', payload: { reachable: true } });
    return !!res;
  } catch (err) {
    if ((err as web3n.ConnectException).type === 'connect') {
      emitEvent?.({ event: 'server:reachability', payload: { reachable: false } });
    } else {
      console.error('🔥 Error while checking server connection. ', err);
    }
    return false;
  }
}
