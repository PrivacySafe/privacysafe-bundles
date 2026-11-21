/*
 Copyright (C) 2024-2026 3NSoft Inc.

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
import { makeServiceCaller } from '@shared/libs/ipc/ipc-service-caller';
import { sleep } from '@shared/utils/processes/sleep';
import { makeLogger } from '@shared/utils/logger';
import type { AppContacts } from '@common/types';
import type { InboxSrv } from '@deno/types/inbox-srv.types';
import {
  INBOX_SRV_OBSERVABLE_METHODS,
  INBOX_SRV_REQ_REPLY_METHODS,
} from '@deno/types/inbox-srv.types';

const log = makeLogger('ExternalServices');

export let inboxSrv: InboxSrv;

const CONTACTS_CONNECT_RETRY_DELAYS_MILLIS = [3_000, 10_000];
const OWN_BACKEND_CONNECT_RETRY_DELAYS_MILLIS = [1_000, 3_000, 10_000];

let contactsConn: Promise<AppContacts> | undefined = undefined;

async function connectToContactsApp(): Promise<AppContacts> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= CONTACTS_CONNECT_RETRY_DELAYS_MILLIS.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(CONTACTS_CONNECT_RETRY_DELAYS_MILLIS[attempt - 1]);
    }
    try {
      const srvConn = await w3n.rpc!.otherAppsRPC!('contacts.app.privacysafe.io', 'AppContacts');
      return makeServiceCaller<AppContacts>(
        srvConn,
        [
          'getContact',
          'getContactByMail',
          'getContactList',
          'upsertContact',
          'getContactBlacklist',
          'changeContactBlockingSettings',
          'prepareSharedContactsImport',
        ],
        ['watchContactBlacklistChanging'],
      ) as AppContacts;
    } catch (err) {
      lastErr = err;
      log.info(
        `Attempt ${attempt + 1} to connect to the contacts app failed` +
          `${attempt < CONTACTS_CONNECT_RETRY_DELAYS_MILLIS.length ? '; will try again' : ''}`,
        err,
      );
    }
  }
  throw lastErr;
}

export function contactsSrv(): Promise<AppContacts> {
  if (!contactsConn) {
    contactsConn = connectToContactsApp().catch(err => {
      contactsConn = undefined;
      throw err;
    });
  }
  return contactsConn;
}

/**
 * The window is nothing without this connection - it is where messages, folders
 * and files all come from - and a single attempt is a single point of failure:
 * the platform is spawning the background component at the same time, and one
 * refusal used to leave the splash animating forever.
 */
async function connectToOwnBackend(): Promise<web3n.rpc.client.RPCConnection> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= OWN_BACKEND_CONNECT_RETRY_DELAYS_MILLIS.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(OWN_BACKEND_CONNECT_RETRY_DELAYS_MILLIS[attempt - 1]);
    }
    try {
      return await w3n.rpc!.thisApp!('AppInboxInternal');
    } catch (err) {
      lastErr = err;
      log.info(
        `Attempt ${attempt + 1} to connect to this app's background component failed` +
          `${attempt < OWN_BACKEND_CONNECT_RETRY_DELAYS_MILLIS.length ? '; will try again' : ''}`,
        err,
      );
    }
  }
  throw lastErr;
}

export async function initializationServices() {
  const srvConn = await connectToOwnBackend();
  inboxSrv = makeServiceCaller<InboxSrv>(
    srvConn,
    INBOX_SRV_REQ_REPLY_METHODS,
    INBOX_SRV_OBSERVABLE_METHODS,
  ) as InboxSrv;

  contactsSrv().catch(err =>
    log.error(`Contacts app is not reachable; names will show as addresses`, err),
  );
}
