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
import type { ContactEvent } from '../../src/types/index.ts';
import { SERVER_REQUEST_TIMEOUT_MS, withTimeout } from './storage-connection.ts';

/**
 * Whether the storage server answers right now. Bounded by
 * SERVER_REQUEST_TIMEOUT_MS: a server that does not answer in time counts as
 * unreachable, rather than holding up the sync pass for the platform's network
 * timeouts. The outcome is reported as a server:reachability event when
 * emitStorageEvent is given, so that the window can tell "online" from "the
 * network is up, the server is not".
 */
export async function checkServerConnection(
  fs: web3n.files.WritableFS,
  {
    emitStorageEvent,
    timeoutMs = SERVER_REQUEST_TIMEOUT_MS,
  }: {
    emitStorageEvent?: (event: ContactEvent) => void;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const status = fs.v?.sync?.status('');
  if (!status) {
    return false;
  }

  try {
    const res = await withTimeout(status, timeoutMs);
    emitStorageEvent?.({ event: 'server:reachability', payload: { reachable: true } });
    return !!res;
  } catch (err) {
    if ((err as web3n.ConnectException).type === 'connect') {
      emitStorageEvent?.({ event: 'server:reachability', payload: { reachable: false } });
    } else {
      console.error('🔥 Error while checking server connection. ', err);
    }
    return false;
  }
}
