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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkServerConnection } from '@deno/utils/check-server-connection.ts';
import { syncStatusOf } from '@deno/utils/upload-state.ts';
import { SERVER_REQUEST_TIMEOUT_MS } from '@deno/utils/storage-connection.ts';
import { connectException, makeEventCollector, makeFakeFs } from '../../helpers/fake-fs.ts';
import { installFakeW3n } from '../../helpers/fake-w3n.ts';

let w3n: ReturnType<typeof installFakeW3n>;

beforeEach(() => {
  w3n = installFakeW3n();
});

afterEach(() => {
  vi.useRealTimers();
  w3n.uninstall();
  vi.restoreAllMocks();
});

describe('checkServerConnection', () => {

  it('says yes, and reports the server reachable, when it answers', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.status.mockResolvedValue({ state: 'synced' });

    const res = await checkServerConnection(fs, { emitStorageEvent: collector.emitStorageEvent });

    expect(res).toBe(true);
    expect(collector.events).toEqual([{ event: 'server:reachability', payload: { reachable: true } }]);
  });

  it('says no, and reports the server unreachable, when offline', async () => {
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.status.mockRejectedValue(connectException());

    const res = await checkServerConnection(fs, { emitStorageEvent: collector.emitStorageEvent });

    expect(res).toBe(false);
    expect(collector.events).toEqual([{ event: 'server:reachability', payload: { reachable: false } }]);
  });

  // The network is up, the server does not answer: the sync pass must not be
  // held up for the platform's network timeouts.
  it('gives up on a server that does not answer in time', async () => {
    vi.useFakeTimers();
    const { fs, sync } = makeFakeFs();
    const collector = makeEventCollector();
    sync.status.mockReturnValue(new Promise(() => undefined));

    const pending = checkServerConnection(fs, {
      emitStorageEvent: collector.emitStorageEvent, timeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await pending).toBe(false);
    expect(collector.events).toEqual([{ event: 'server:reachability', payload: { reachable: false } }]);
  });

  it('says no for a storage without the sync api', async () => {
    const { fs } = makeFakeFs();
    (fs as unknown as { v: undefined }).v = undefined;

    expect(await checkServerConnection(fs)).toBe(false);
  });

});

describe('syncStatusOf', () => {

  it('answers undefined for a server that does not answer in time', async () => {
    vi.useFakeTimers();
    const { fs, sync } = makeFakeFs();
    sync.status.mockReturnValue(new Promise(() => undefined));

    const pending = syncStatusOf(fs, 'contacts-db');
    await vi.advanceTimersByTimeAsync(SERVER_REQUEST_TIMEOUT_MS);

    expect(await pending).toBeUndefined();
  });

});
