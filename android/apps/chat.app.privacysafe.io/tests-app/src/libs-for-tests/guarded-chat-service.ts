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

import { chatService as appChatService } from '@main/common/services/external-services.ts';
import type { ChatSrv } from '@deno/types/index.ts';
import { skipSpecIfUnresponsive } from './jasmine-utils.js';

export const ASMAIL_SRV_DESCRIPTION = `the ASMail server that this chat operation needs`;
export const ASMAIL_OP_WAIT_MILLIS = 10000;

/**
 * The chat service methods that need an ASMail server: address pre-flights
 * and message sending sit on their paths. With that server unreachable they
 * either hang, or reject with a connect exception wrapped into an app-level
 * one. Everything else answers from local state.
 */
const GUARDED_METHODS: (string | symbol)[] = [
  'createOneToOneChat',
  'createGroupChat',
  'acceptChatInvitation',
  'updateGroupMembers',
  'updateGroupAdmins',
  'checkAddressExistenceForASMail',
];

/**
 * chatService for specs: the app's own service, except that GUARDED_METHODS
 * run through skipSpecIfUnresponsive - a server outage marks the spec pending
 * with a reason, instead of failing it (on a wrapped connect exception) or
 * letting it die on jasmine's timeout (on a hang). Specs using these methods
 * must keep their jasmine timeouts above ASMAIL_OP_WAIT_MILLIS, or the
 * timeout fires before the skip does.
 *
 * The underlying service is resolved on every access because
 * external-services assigns it only after asynchronous initialization.
 */
export const chatService: ChatSrv = new Proxy({} as ChatSrv, {
  get(_target, prop) {
    const field = appChatService[prop as keyof ChatSrv];
    if ((typeof field !== 'function') || !GUARDED_METHODS.includes(prop)) {
      return field;
    }
    const method = field as (...args: unknown[]) => Promise<unknown>;
    return (...args: unknown[]) => skipSpecIfUnresponsive(
      ASMAIL_SRV_DESCRIPTION, ASMAIL_OP_WAIT_MILLIS, () => method(...args),
    );
  },
});
