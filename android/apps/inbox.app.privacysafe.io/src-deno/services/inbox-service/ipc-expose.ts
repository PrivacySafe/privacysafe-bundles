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
import type { InboxSrv } from '../../types/inbox-srv.types.ts';
import type { AppInboxExternalSrv } from '../../../src/common/types/external-inbox.types.ts';
import {
  INBOX_SRV_EAGER_METHODS,
  INBOX_SRV_OBSERVABLE_METHODS,
  INBOX_SRV_REQ_REPLY_METHODS,
} from '../../types/inbox-srv.types.ts';
import { MultiConnectionIPCWrap } from '../../../shared/libs/ipc/ipc-service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

function facadeOver<T>(
  srv: Promise<T>,
  reqReplyMethods: (keyof T)[],
  observableMethods: (keyof T)[],
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const facade = {} as any;
  for (const m of reqReplyMethods) {
    facade[m] = async (...args: unknown[]) => ((await srv)[m] as AnyFn)(...args);
  }
  for (const m of observableMethods) {
    facade[m] = (...args: unknown[]) => {
      let detach: (() => void) | undefined = undefined;
      let cancelled = false;
      srv.then(s => {
        if (!cancelled) {
          detach = ((s[m] as AnyFn)(...args)) as () => void;
        }
      }, () => {});
      return () => {
        cancelled = true;
        detach?.();
      };
    };
  }
  return facade as T;
}

/**
 * Methods that exist for the specs and are published only on the test stand.
 *
 * handleIncomingSyncMsg takes a whole inbox envelope, sender included, so in a
 * production run it let anything that reaches this channel hand the service a
 * phantom "from the user" - past the one check of who sent it (audit of
 * 2026-11-26). The platform gives no `testStand` to a production run.
 */
const TEST_STAND_ONLY_METHODS: ReadonlySet<keyof InboxSrv> = new Set(['handleIncomingSyncMsg']);

function isTestStand(): boolean {
  return !!(w3n as { testStand?: unknown }).testStand;
}

/**
 * @param inbox the service, which the facade's deferred methods wait on.
 * @param eager methods answered without waiting for it. `watchStartup` reports
 * the very startup `inbox` is waiting on, so a deferred one would deliver its
 * events only after they stopped saying anything.
 */
export function exposeInboxServiceOnIPC(
  inbox: Promise<InboxSrv>,
  eager: Pick<InboxSrv, 'watchStartup'>,
): () => void {
  const srvWrapInternal = new MultiConnectionIPCWrap('AppInboxInternal');
  const deferredObservables = INBOX_SRV_OBSERVABLE_METHODS.filter(
    m => !INBOX_SRV_EAGER_METHODS.includes(m),
  );
  const reqReplyMethods = isTestStand()
    ? INBOX_SRV_REQ_REPLY_METHODS
    : INBOX_SRV_REQ_REPLY_METHODS.filter(m => !TEST_STAND_ONLY_METHODS.has(m));
  const facade = facadeOver(inbox, reqReplyMethods, deferredObservables);
  Object.assign(facade, eager);

  srvWrapInternal.exposeReqReplyMethods(facade, reqReplyMethods);
  srvWrapInternal.exposeObservableMethods(facade, INBOX_SRV_OBSERVABLE_METHODS);

  return srvWrapInternal.startIPC();
}

/**
 * Exposes, under the name 'AppInbox', the few methods that other apps may
 * call (see allowed callers in manifest.json). Like the internal one, it is
 * exposed at the very start of the component, over a facade.
 */
export function exposeInboxServiceToOtherApps(inbox: Promise<InboxSrv>): () => void {
  const methods: (keyof AppInboxExternalSrv)[] = ['prepareDraft'];
  const srvWrap = new MultiConnectionIPCWrap('AppInbox');
  const facade = facadeOver(inbox, methods, []) as AppInboxExternalSrv;
  srvWrap.exposeReqReplyMethods(facade, methods);
  return srvWrap.startIPC();
}

export { facadeOver };
