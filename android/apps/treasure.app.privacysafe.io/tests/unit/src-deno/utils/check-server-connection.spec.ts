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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkServerConnection } from '@deno/utils/check-server-connection.ts';
import type { TreasureEvent } from '@shared/@types';

function fsWithStatus(status: () => Promise<unknown>): web3n.files.WritableFS {
  return { v: { sync: { status } } } as unknown as web3n.files.WritableFS;
}

function collectEvents() {
  const events: TreasureEvent[] = [];
  return { events, emitEvent: (event: TreasureEvent) => events.push(event) };
}

const connectException = { runtimeException: true, type: 'connect' } as web3n.ConnectException;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('checkServerConnection', () => {
  it('says yes, and reports the server reachable, when it answers', async () => {
    const { events, emitEvent } = collectEvents();
    const ok = await checkServerConnection(fsWithStatus(async () => ({ state: 'synced' })), { emitEvent });
    expect(ok).toBe(true);
    expect(events).toEqual([{ event: 'server:reachability', payload: { reachable: true } }]);
  });

  it('says no, and reports the server unreachable, on a connect failure', async () => {
    const { events, emitEvent } = collectEvents();
    const ok = await checkServerConnection(
      fsWithStatus(() => Promise.reject(connectException)),
      { emitEvent },
    );
    expect(ok).toBe(false);
    expect(events).toEqual([{ event: 'server:reachability', payload: { reachable: false } }]);
  });

  it('says no, without a reachability verdict, on any other failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { events, emitEvent } = collectEvents();
    const ok = await checkServerConnection(
      fsWithStatus(() => Promise.reject(new Error('boom'))),
      { emitEvent },
    );
    expect(ok).toBe(false);
    expect(events).toEqual([]);
  });

  it('counts a server that does not answer in time as unreachable', async () => {
    vi.useFakeTimers();
    const { events, emitEvent } = collectEvents();
    const pending = checkServerConnection(
      fsWithStatus(() => new Promise(() => undefined)),
      { emitEvent, timeoutMs: 1000 },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe(false);
    expect(events).toEqual([{ event: 'server:reachability', payload: { reachable: false } }]);
  });

  it('works without an event sink', async () => {
    expect(await checkServerConnection(fsWithStatus(async () => ({ state: 'synced' })))).toBe(true);
  });

  it('says no when the fs has no sync api', async () => {
    expect(await checkServerConnection({} as web3n.files.WritableFS)).toBe(false);
  });
});
