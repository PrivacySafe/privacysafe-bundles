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
import { makeServiceCaller } from '../../../shared-libs/ipc/ipc-service-caller.js';
import { toCanonicalAddress } from '../../../shared-libs/address-utils.ts';
import { sleep } from '../../../shared-libs/processes/sleep.ts';
import { makeLogger } from '../../../shared-libs/logger.ts';
import type { ContactsService, Person } from '../../../types/contact.types.ts';
import type { LocalDataStore } from '../../types/index.ts';

const log = makeLogger('BlacklistTracker');

/** Canonical addresses that entered or left the blacklist in one change. */
export interface BlacklistChanges {
  added: string[];
  removed: string[];
}

export interface BlacklistTracker {
  isBlacklisted(address: string): boolean;
  getBlacklist(): string[];
  /**
   * Registers who is told that the blacklist changed. Set it BEFORE start():
   * a change that arrives with no handler in place is not replayed.
   */
  setChangeHandler(handler: (changes: BlacklistChanges) => void): void;
  start(): void;
  stop(): void;
}

const RECONNECT_DELAYS_MILLIS = [3_000, 10_000, 30_000];

function canonicalize(address: string): string | null {
  try {
    return toCanonicalAddress(address);
  } catch {
    return null;
  }
}

export function createBlacklistTracker(localDataStoreSrv: LocalDataStore): BlacklistTracker {
  const blacklistedSet = new Set<string>();
  let stopWatch: (() => void) | undefined = undefined;
  let isStopped = false;
  let changeHandler: ((changes: BlacklistChanges) => void) | undefined = undefined;

  // Initialize immediately from cached blacklist in localDataStore
  const cached = localDataStoreSrv.getCachedBlacklist();
  /**
   * Whether the set below is a state this device has already reacted to.
   *
   * Without a cache there is nothing to compare the first list against, so it
   * is taken as the baseline and announced to nobody. With one, the first list
   * is a genuine delta - which is how a contact blocked while this app was
   * closed still gets its line in the chats.
   */
  let baselineTaken = !!cached;
  for (const addr of cached ?? []) {
    const c = canonicalize(addr);
    if (c) {
      blacklistedSet.add(c);
    }
  }
  if (blacklistedSet.size > 0) {
    log.info(`Initialized with ${blacklistedSet.size} cached blacklisted address(es)`);
  }

  function applyBlacklist(list: Person[]): void {
    // Taken before the set is touched: clearing it first is what used to make
    // every change look like a list that had always been this way.
    const before = new Set(blacklistedSet);

    blacklistedSet.clear();
    const emails: string[] = [];
    for (const person of list) {
      if (person.mail) {
        const c = canonicalize(person.mail);
        if (c) {
          blacklistedSet.add(c);
          emails.push(c);
        }
      }
    }
    log.info(`Blacklist updated: ${blacklistedSet.size} address(es)`);
    localDataStoreSrv.setCachedBlacklist(emails).catch(err => {
      log.error(`Failed to save cached blacklist to localDataStore:`, err);
    });

    if (!baselineTaken) {
      baselineTaken = true;
      return;
    }

    const added = [...blacklistedSet].filter(addr => !before.has(addr));
    const removed = [...before].filter(addr => !blacklistedSet.has(addr));
    if (added.length === 0 && removed.length === 0) {
      return;
    }

    log.info(`Blacklist delta: ${added.length} added, ${removed.length} removed`);
    if (!changeHandler) {
      return;
    }
    try {
      changeHandler({ added, removed });
    } catch (err) {
      // This runs inside the contacts watcher's next(): an exception here would
      // tear down the subscription that feeds the incoming-message filter.
      log.error(`Blacklist change handler failed:`, err);
    }
  }

  async function connectAndWatch(): Promise<void> {
    let attempt = 0;
    while (!isStopped) {
      try {
        if (!w3n.rpc?.otherAppsRPC) {
          log.warn(`w3n.rpc.otherAppsRPC is not available; cannot connect to contacts app`);
          return;
        }

        const srvConn = await w3n.rpc.otherAppsRPC('contacts.app.privacysafe.io', 'AppContacts');
        if (isStopped) {
          return;
        }

        const contactsSrv = makeServiceCaller<ContactsService>(
          srvConn,
          ['getContactBlacklist'],
          ['watchContactBlacklistChanging'],
        ) as ContactsService;

        // Initial fetch
        const initialList = await contactsSrv.getContactBlacklist();
        if (isStopped) {
          return;
        }
        applyBlacklist(initialList ?? []);

        // Start observable watch
        stopWatch = contactsSrv.watchContactBlacklistChanging({
          next: (list: Person[]) => {
            if (!isStopped) {
              applyBlacklist(list ?? []);
            }
          },
          error: (err: unknown) => {
            log.error(`Error in watchContactBlacklistChanging:`, err);
            // Reconnect on stream error if not stopped
            if (!isStopped) {
              stopWatch = undefined;
              retryConnection();
            }
          },
          complete: () => {
            log.info(`watchContactBlacklistChanging completed`);
          },
        });

        log.info(`Successfully subscribed to contacts blacklist watcher`);
        return;
      } catch (err) {
        const delay = RECONNECT_DELAYS_MILLIS[Math.min(attempt, RECONNECT_DELAYS_MILLIS.length - 1)];
        log.info(`Failed to connect to AppContacts (attempt ${attempt + 1}), retrying in ${delay}ms:`, err);
        attempt += 1;
        await sleep(delay);
      }
    }
  }

  function retryConnection() {
    if (!isStopped) {
      connectAndWatch().catch(err => {
        log.error(`Unhandled error in retryConnection:`, err);
      });
    }
  }

  return {
    isBlacklisted(address: string): boolean {
      const c = canonicalize(address);
      return c ? blacklistedSet.has(c) : false;
    },

    getBlacklist(): string[] {
      return Array.from(blacklistedSet);
    },

    setChangeHandler(handler: (changes: BlacklistChanges) => void): void {
      changeHandler = handler;
    },

    start(): void {
      if (isStopped) {
        return;
      }
      connectAndWatch().catch(err => {
        log.error(`Unhandled error in connectAndWatch:`, err);
      });
    },

    stop(): void {
      isStopped = true;
      if (stopWatch) {
        try {
          stopWatch();
        } catch {
          // ignore
        }
        stopWatch = undefined;
      }
    },
  };
}
