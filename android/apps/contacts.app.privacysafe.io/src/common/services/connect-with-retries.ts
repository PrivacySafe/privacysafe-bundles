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
// Connecting the window to the service of this app, with a few attempts.
//
// The service exposes its ipc only at the end of its start, and part of the
// start waits for the server. With the server slow or unreachable the first
// connection times out while the service is still coming up, and a second one a
// little later finds it ready. The number of attempts is small on purpose: when
// the data center is down for hours, no number of retries helps, and the user
// should be told rather than kept waiting.

import { showServiceWaitStatus } from './startup-status';

export const SERVICE_CONNECT_ATTEMPTS = 3;

/** Pause between attempts; the attempt itself already waits for its timeout. */
export const SERVICE_CONNECT_PAUSE_MS = 1000;

export async function connectWithRetries<T>(
  connect: () => Promise<T>,
  {
    attempts = SERVICE_CONNECT_ATTEMPTS,
    pauseMs = SERVICE_CONNECT_PAUSE_MS,
    onFailedAttempt,
  }: {
    attempts?: number;
    pauseMs?: number;
    /** Called after every failed attempt but the last one. */
    onFailedAttempt?: (attempt: number, err: unknown) => void | Promise<void>;
  } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connect();
    } catch (err) {
      if (attempt >= attempts) {
        throw err;
      }
      await onFailedAttempt?.(attempt, err);
      await new Promise(resolve => setTimeout(resolve, pauseMs));
    }
  }
}

/**
 * Connection to the internal service of this app, with retries. Every failed
 * attempt is logged and, while the window waits, told to the user under the
 * start-up animation: each attempt waits for the full timeout of the platform,
 * and the animation alone does not say why it runs for so long.
 */
export function connectToContactsService(): Promise<web3n.rpc.client.RPCConnection> {
  return connectWithRetries(() => w3n.rpc!.thisApp!('AppContactsInternal'), {
    onFailedAttempt: async (attempt, err) => {
      await showServiceWaitStatus(attempt + 1, SERVICE_CONNECT_ATTEMPTS).catch(() => undefined);
      await w3n.log(
        'info',
        `Contacts service is not reachable yet (attempt ${attempt} of ${SERVICE_CONNECT_ATTEMPTS}), retrying`,
        err,
      );
    },
  });
}
