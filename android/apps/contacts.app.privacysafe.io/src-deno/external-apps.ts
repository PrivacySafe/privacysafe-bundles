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
import { makeServiceCaller } from '../shared-libs/ipc/ipc-service-caller.js';
import type { AppChatsExternalSrv, AppInboxExternalSrv } from '../src/types/index.ts';

export const CHAT_APP_DOMAIN = 'chat.app.privacysafe.io';
export const INBOX_APP_DOMAIN = 'inbox.app.privacysafe.io';

/**
 * Connections to services of other apps, made on first use. A connection that
 * failed, or whose call failed, is dropped, so that the next call connects
 * again: the other app may have been restarted, updated or installed since.
 */
function lazyService<T>(
  appDomain: string,
  service: string,
  methods: (keyof T)[],
): { get: () => Promise<T>; reset: () => void } {
  let conn: Promise<T> | undefined = undefined;

  function get(): Promise<T> {
    if (conn) {
      return conn;
    }

    const connecting = w3n.rpc!.otherAppsRPC!(appDomain, service)
      .then(srvConn => makeServiceCaller<T>(srvConn, methods) as T);
    connecting.catch(() => {
      if (conn === connecting) {
        conn = undefined;
      }
    });
    conn = connecting;
    return connecting;
  }

  function reset(): void {
    conn = undefined;
  }

  return { get, reset };
}

const chatSrv = lazyService<AppChatsExternalSrv>(
  CHAT_APP_DOMAIN,
  'AppChats',
  ['getOneToOneChatStatus', 'prepareOutgoingDraft'],
);

const inboxSrv = lazyService<AppInboxExternalSrv>(
  INBOX_APP_DOMAIN,
  'AppInbox',
  ['prepareDraft'],
);

async function callOn<T, R>(
  srv: { get: () => Promise<T>; reset: () => void },
  call: (s: T) => Promise<R>,
): Promise<R> {
  try {
    return await call(await srv.get());
  } catch (err) {
    srv.reset();
    throw err;
  }
}

export function callChatApp<R>(call: (s: AppChatsExternalSrv) => Promise<R>): Promise<R> {
  return callOn(chatSrv, call);
}

export function callInboxApp<R>(call: (s: AppInboxExternalSrv) => Promise<R>): Promise<R> {
  return callOn(inboxSrv, call);
}
