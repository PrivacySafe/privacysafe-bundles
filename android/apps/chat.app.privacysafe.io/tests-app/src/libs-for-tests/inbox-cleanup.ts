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
 * Empties a test user's inbox of what earlier runs left in it, before this
 * run's background component starts.
 *
 * Nothing else ever does. Sync phantoms - about a thousand per run - are put
 * up for removal fifteen days later (LIFETIME_DAYS_IN_AUXILIARY_DB), and that
 * schedule lives in the local database, which run-tests-on.sh deletes with the
 * rest of the data folder. So on the server they stay for good, and every run
 * starts from a fresh folder - watermark 0 - and reads the whole pile again:
 * 735 -> 876 -> 967 -> 1107 messages for the first user over four runs on
 * 2026-10-06, a catch-up still going after 540s, and specs that list the inbox
 * (a restore does) timing out behind it. Measured: of a merge restore's 176s,
 * 176.7s was `inbox.listMsgs()`.
 *
 * Done here, ahead of initializeServices(): the background component is a
 * service started by the window's first connection to it (the test manifest
 * drops launchOnSystemStartup), so nothing is reading the inbox yet and there
 * is no race with its catch-up.
 */

import { INBOX_SCAN_FLOOR_MS } from '@shared/constants/inbox';

declare const w3n: web3n.testing.CommonW3N & { mail: web3n.asmail.Service };

/**
 * Messages delivered this recently are left alone: another test user's window
 * may start a moment earlier than this one and already be talking to us.
 */
const KEEP_DELIVERED_WITHIN_MILLIS = 30_000;

/** Removals in flight at once: enough to be quick, few enough not to provoke the server's 500s. */
const REMOVAL_CONCURRENCY = 4;

export async function removeInboxLeftoversOfEarlierRuns(): Promise<void> {
  const startedAt = Date.now();
  const cutoff = startedAt - KEEP_DELIVERED_WITHIN_MILLIS;
  let listing: web3n.asmail.MsgInfo[];
  try {
    // The floor the catch-up scan lists from: listMsgs(0) throws ENOENT.
    listing = await w3n.mail.inbox.listMsgs(INBOX_SCAN_FLOOR_MS);
  } catch (err) {
    w3n.testStand.log('warning', `Inbox cleanup: could not list the inbox; carrying on without it`, err);
    return;
  }
  const leftovers = listing
    .filter(({ deliveryTS }) => (deliveryTS < cutoff))
    .map(({ msgId }) => msgId);
  if (leftovers.length === 0) {
    w3n.testStand.log('info', `Inbox cleanup: nothing left by earlier runs`);
    return;
  }

  let removed = 0;
  let failed = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < leftovers.length) {
      const msgId = leftovers[next];
      next += 1;
      try {
        await w3n.mail.inbox.removeMsg(msgId);
        removed += 1;
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: REMOVAL_CONCURRENCY }, worker));

  w3n.testStand.log(
    'info',
    `Inbox cleanup: removed ${removed} of ${leftovers.length} message(s) left by earlier runs`
      + `${failed ? `, ${failed} failed` : ''}, in ${Date.now() - startedAt}ms`,
  );
}
