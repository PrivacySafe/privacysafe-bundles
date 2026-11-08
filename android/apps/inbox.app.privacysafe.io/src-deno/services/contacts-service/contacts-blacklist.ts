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
// Who the user has blocked, as this component understands it.
//
// The list itself belongs to the contacts app, which is also what replicates it
// between the user's devices; this is a reader of it, kept warm so that the
// incoming filter can answer before any of that is reachable.
import { makeServiceCaller } from '../../../shared/libs/ipc/ipc-service-caller.js';
import { canonicalAddressOrUndefined } from '../../../shared/utils/address-utils.ts';
import { sleep } from '../../../shared/utils/processes/sleep.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';
import type { AppContacts, PersonView } from '../../../src/common/types/index.ts';
import type { DBProvider } from '../../dataset/index.ts';

const log = makeLogger('BlacklistTracker');

export interface BlacklistTracker {
  isBlacklisted(address: string): boolean;
  getBlacklist(): string[];
  start(): void;
  stop(): void;
}

const RECONNECT_DELAYS_MILLIS = [3_000, 10_000, 30_000];

export function createBlacklistTracker(db: DBProvider): BlacklistTracker {
  const blacklistedSet = new Set<string>();
  let stopWatch: (() => void) | undefined = undefined;
  let isStopped = false;

  // Filled in BEFORE any RPC, and that is the whole point of the cache: reaching
  // the contacts app takes seconds of retries, while the catch-up scan of the
  // inbox starts at once. An empty filter for those seconds means mail from a
  // blocked sender stored and announced.
  for (const addr of db.getCachedBlacklist()) {
    const canonical = canonicalAddressOrUndefined(addr);
    if (canonical) {
      blacklistedSet.add(canonical);
    }
  }
  if (blacklistedSet.size > 0) {
    log.info(`Started warm, with ${blacklistedSet.size} cached blacklisted address(es).`);
  }

  function applyBlacklist(list: PersonView[]): void {
    blacklistedSet.clear();
    const addresses: string[] = [];
    for (const person of list) {
      const canonical = canonicalAddressOrUndefined(person?.mail);
      if (canonical) {
        blacklistedSet.add(canonical);
        addresses.push(canonical);
      }
    }
    log.info(`Blacklist updated: ${blacklistedSet.size} address(es).`);
    db.setCachedBlacklist(addresses).catch(err => {
      log.error(`Failed to cache the blacklist.`, err);
    });
  }

  async function connectAndWatch(): Promise<void> {
    let attempt = 0;
    while (!isStopped) {
      try {
        if (!w3n.rpc?.otherAppsRPC) {
          log.warn(`No otherAppsRPC capability; staying on the cached blacklist.`);
          return;
        }

        const srvConn = await w3n.rpc.otherAppsRPC('contacts.app.privacysafe.io', 'AppContacts');
        if (isStopped) {
          return;
        }

        const contactsSrv = makeServiceCaller<AppContacts>(
          srvConn,
          ['getContactBlacklist'],
          ['watchContactBlacklistChanging'],
        ) as AppContacts;

        applyBlacklist((await contactsSrv.getContactBlacklist()) ?? []);
        if (isStopped) {
          return;
        }

        stopWatch = contactsSrv.watchContactBlacklistChanging({
          next: list => {
            if (!isStopped) {
              applyBlacklist(list ?? []);
            }
          },
          error: (err: unknown) => {
            log.error(`Error in watchContactBlacklistChanging.`, err);
            if (!isStopped) {
              stopWatch = undefined;
              retryConnection();
            }
          },
          complete: () => {
            log.info(`watchContactBlacklistChanging completed.`);
          },
        });

        log.info(`Subscribed to the contacts app's blacklist.`);
        return;
      } catch (err) {
        const delay = RECONNECT_DELAYS_MILLIS[Math.min(attempt, RECONNECT_DELAYS_MILLIS.length - 1)];
        log.info(
          `Attempt ${attempt + 1} to reach the contacts app failed; retrying in ${delay}ms.`,
          err,
        );
        attempt += 1;
        await sleep(delay);
      }
    }
  }

  function retryConnection(): void {
    if (!isStopped) {
      connectAndWatch().catch(err => log.error(`Unhandled error while reconnecting.`, err));
    }
  }

  return {
    isBlacklisted(address: string): boolean {
      const canonical = canonicalAddressOrUndefined(address);
      return canonical ? blacklistedSet.has(canonical) : false;
    },

    getBlacklist(): string[] {
      return Array.from(blacklistedSet);
    },

    start(): void {
      if (isStopped) {
        return;
      }
      connectAndWatch().catch(err => log.error(`Unhandled error while connecting.`, err));
    },

    stop(): void {
      isStopped = true;
      if (stopWatch) {
        try {
          stopWatch();
        } catch {
          // The connection may already be gone; nothing to undo either way.
        }
        stopWatch = undefined;
      }
    },
  };
}
