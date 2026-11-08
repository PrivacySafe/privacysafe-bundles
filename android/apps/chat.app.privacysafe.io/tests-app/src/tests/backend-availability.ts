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
 * That the window can tell a slow background component from a dead one.
 *
 * The distinction is the whole point of `ping()`: every other call goes
 * through a facade that waits for the real service, so "has not answered yet"
 * says nothing on its own. On 2026-09-10 a window connected successfully to a
 * component that had stopped hours earlier and sat on a spinner until the app
 * was restarted.
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { makeServiceCaller } from '@shared/ipc/ipc-service-caller';
import { chatService } from '@main/common/services/external-services.ts';
import {
  callBackend,
  isBackendUnreachable,
  probeBackend,
} from '@main/common/services/backend-availability.ts';
import type { ChatSrvOverIPC } from '@deno/types/index.ts';

declare const w3n: web3n.testing.CommonW3N;

/**
 * A connection of our own for the two test-only methods.
 *
 * They are deliberately absent from the app's own method list
 * (external-services.ts): that list is the production surface, and stand-only
 * hooks have no business in it. The component exposes them only when the
 * platform gives it a testStand (see ipc-expose.ts).
 */
let testSrv: ChatSrvOverIPC | undefined = undefined;

async function testHooks(): Promise<ChatSrvOverIPC> {
  if (!testSrv) {
    const conn = await w3n.rpc!.thisApp!('AppChatsInternal');
    testSrv = makeServiceCaller<ChatSrvOverIPC>(
      conn, ['ping', 'hangForTest', 'stopPingForTest'],
    ) as ChatSrvOverIPC;
  }
  return testSrv;
}

describe(`Backend availability`, () => {

  itCond(`ping answers at once, and says where the component is`, async () => {
    const startedAt = Date.now();
    const status = await chatService.ping();
    const tookMillis = Date.now() - startedAt;

    expect(tookMillis)
      .withContext(`ping touches no storage, so it answers without waiting on one`)
      .toBeLessThan(3000);
    expect(status.uptimeMillis)
      .withContext(`uptime should be a plausible positive number`)
      .toBeGreaterThan(0);
    // Not asserted as ready: the stage that decides it is opening databases on
    // synced storage, which legitimately takes tens of seconds on a fresh user,
    // and a spec that demanded 'ready' would be asserting the speed of the
    // stand rather than this property. (Until 2026-09-11 the inbox catch-up was
    // what kept a component 'starting' for a minute and a half; it no longer
    // holds the start, though it does still show up as an open stage.)
    expect(status.ready || !!status.stage)
      .withContext(`either it is ready, or it names the stage it is on`)
      .toBeTrue();
  });

  itCond(`ping answers while an ordinary call is stuck`, async () => {
    // The property everything else rests on. `hangForTest` occupies a call
    // for four seconds; if `ping` went through the same facade, it would be
    // stuck behind it and this would take just as long.
    const srv = await testHooks();
    const hanging = srv.hangForTest!(4000);
    try {
      const startedAt = Date.now();
      await srv.ping();
      // Well inside the four seconds the other call occupies: the claim is
      // that ping does not queue behind it, not that the stand is fast.
      expect(Date.now() - startedAt)
        .withContext(`ping must not queue behind a pending call`)
        .toBeLessThan(2500);
    } finally {
      await hanging;
    }
  }, 30000);

  itCond(`a call that outlives its window keeps waiting while the component answers`, async () => {
    // A slow-but-alive component must not be cut short: opening databases on
    // synced storage legitimately takes tens of seconds on a fresh user.
    //
    // The window is longer than the call is by half, and has to be: a component
    // that answers 'ready' grants a pending call one further window and then
    // calls it stuck (see callBackend) - patience without limit belongs to a
    // component that is still starting, not to one that says it is up. This
    // spec used to pass with a shorter window only because the component spent
    // the whole test run 'starting' behind its inbox catch-up (2026-09-11), so
    // it was exercising the other branch than the one it names.
    const srv = await testHooks();
    const startedAt = Date.now();
    await callBackend(
      'hangForTest', () => srv.hangForTest!(3000), { windowMillis: 2000 },
    );
    expect(Date.now() - startedAt)
      .withContext(`the call was awaited to its end rather than abandoned`)
      .toBeGreaterThanOrEqual(2900);
    // Each elapsed window costs a ping, and a ping is allowed to be slow on a
    // busy component - so this outlasts Jasmine's default.
  }, 30000);

  itCond(`a call is given up on when the component stops answering pings`, async () => {
    const srv = await testHooks();
    await srv.stopPingForTest!(true);
    try {
      const verdict = await probeBackend();
      expect(verdict.kind)
        .withContext(`a component that does not answer a ping is unreachable`)
        .toBe('unreachable');

      let caught: unknown;
      try {
        await callBackend(
          'hangForTest', () => srv.hangForTest!(30000), { windowMillis: 500 },
        );
      } catch (err) {
        caught = err;
      }
      expect(isBackendUnreachable(caught))
        .withContext(`the stuck call must end as 'unreachable', not hang forever`)
        .toBeTrue();
    } finally {
      await srv.stopPingForTest!(false);
    }
    // Deciding that a component is unreachable deliberately takes its time -
    // two unanswered pings of ten seconds with a pause between them - so this
    // spec needs far more than Jasmine's default five.
  }, 60000);

  itCond(`a call that returns is unaffected by all of the above`, async () => {
    const deviceId = await callBackend(
      'getAppDeviceId', async () => chatService.getAppDeviceId(),
    );
    expect(typeof deviceId).toBe('string');
    expect(deviceId.length).toBeGreaterThan(0);
  });

});
