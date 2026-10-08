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
import { waitForOnline, watchStorageReconnection } from '@deno/utils/storage-connection.ts';
import { installFakeW3n } from '../../helpers/fake-w3n.ts';

const TIMEOUT_MS = 60000;

/** A storage websocket event of the given kind, as the platform reports it. */
function storageWsEvent(
  type: 'connected' | 'heartbeat' | 'heartbeat-skip' | 'disconnected', isOnline = true,
) {
  return { isOnline, wsEvent: { service: 'storage' as const, type } };
}

let w3n: ReturnType<typeof installFakeW3n>;

beforeEach(() => {
  w3n = installFakeW3n();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  w3n.uninstall();
  vi.restoreAllMocks();
});

describe('waitForOnline', () => {

  it('resolves as soon as the platform reports the device online', async () => {
    let isResolved = false;
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS }).then(() => {
      isResolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(isResolved).toBe(false);

    w3n.emitConnectivity({ isOnline: true });
    await wait;

    expect(isResolved).toBe(true);
  });

  // Offline ticks arrive every 30s from the platform's own interval, and they
  // must not be read as "carry on".
  it('keeps waiting while the events say offline', async () => {
    let isResolved = false;
    void waitForOnline({ timeoutMs: TIMEOUT_MS }).then(() => {
      isResolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    w3n.emitConnectivity({ isOnline: false });
    w3n.emitConnectivity({ isOnline: false });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);

    expect(isResolved).toBe(false);
  });

  // The cap on the wait is the whole point: an unbounded wait is the failure
  // mode being avoided here, so no signal at all must still end the wait.
  it('gives up on the timeout when no event arrives', async () => {
    let isResolved = false;
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS }).then(() => {
      isResolved = true;
    });

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await wait;

    expect(isResolved).toBe(true);
  });

  // The caller needs to tell "still offline" from "online, and the storage is
  // still refusing to work" - only the second is worth telling the user about.
  it('reports that the device was seen online', async () => {
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS });

    await vi.advanceTimersByTimeAsync(0);
    w3n.emitConnectivity({ isOnline: true });

    expect(await wait).toBe(true);
  });

  it('reports a timeout as not seen online', async () => {
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS });

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(await wait).toBe(false);
  });

  it('reports offline events as not seen online', async () => {
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS });

    await vi.advanceTimersByTimeAsync(0);
    w3n.emitConnectivity({ isOnline: false });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(await wait).toBe(false);
  });

  it('unsubscribes after resolving on an event', async () => {
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS });

    await vi.advanceTimersByTimeAsync(0);
    expect(w3n.connectivityObservers).toHaveLength(1);

    w3n.emitConnectivity({ isOnline: true });
    await wait;

    expect(w3n.connectivityObservers).toHaveLength(0);
  });

  it('unsubscribes after resolving on the timeout', async () => {
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS });

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await wait;

    expect(w3n.connectivityObservers).toHaveLength(0);
  });

  it('ends the wait when the connectivity stream itself fails', async () => {
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS });

    await vi.advanceTimersByTimeAsync(0);
    for (const obs of [...w3n.connectivityObservers]) {
      obs.error?.(new Error('watch is broken'));
    }
    await wait;

    expect(w3n.connectivityObservers).toHaveLength(0);
  });

  it('falls back to plain waiting without the connectivity cap', async () => {
    delete (w3n.w3n as { connectivity?: unknown }).connectivity;
    let isResolved = false;
    const wait = waitForOnline({ timeoutMs: TIMEOUT_MS }).then(() => {
      isResolved = true;
    });

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(isResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await wait;

    expect(isResolved).toBe(true);
  });

});

describe('watchStorageReconnection', () => {

  it('does not act on connectivity alone', () => {
    const onReconnected = vi.fn();
    watchStorageReconnection(onReconnected);

    w3n.emitConnectivity({ isOnline: true });
    w3n.emitConnectivity(storageWsEvent('heartbeat'));

    expect(onReconnected).not.toHaveBeenCalled();
  });

  it('asks for a sync pass once the storage link is back after a break', () => {
    const onReconnected = vi.fn();
    watchStorageReconnection(onReconnected);

    w3n.emitConnectivity(storageWsEvent('disconnected'));
    w3n.emitConnectivity({ isOnline: true });

    expect(onReconnected).toHaveBeenCalledOnce();
  });

  // A break is reported together with isOnline, and a graceful close of the
  // socket happens with the network perfectly alive - so the very event that
  // reports the break must not be read as the link being back.
  it('does not treat the breaking event itself as a reconnection', () => {
    const onReconnected = vi.fn();
    watchStorageReconnection(onReconnected);

    w3n.emitConnectivity(storageWsEvent('disconnected', true));

    expect(onReconnected).not.toHaveBeenCalled();
  });

  it('counts a skipped heartbeat as a break', () => {
    const onReconnected = vi.fn();
    watchStorageReconnection(onReconnected);

    w3n.emitConnectivity(storageWsEvent('heartbeat-skip'));
    w3n.emitConnectivity({ isOnline: true });

    expect(onReconnected).toHaveBeenCalledOnce();
  });

  it('ignores a break of another service', () => {
    const onReconnected = vi.fn();
    watchStorageReconnection(onReconnected);

    w3n.emitConnectivity({
      isOnline: true,
      wsEvent: { service: 'inbox', type: 'disconnected' },
    });
    w3n.emitConnectivity({ isOnline: true });

    expect(onReconnected).not.toHaveBeenCalled();
  });

  it('asks for one pass per break, not one per event', () => {
    const onReconnected = vi.fn();
    watchStorageReconnection(onReconnected);

    w3n.emitConnectivity(storageWsEvent('disconnected'));
    w3n.emitConnectivity({ isOnline: true });
    w3n.emitConnectivity({ isOnline: true });
    w3n.emitConnectivity({ isOnline: true });

    expect(onReconnected).toHaveBeenCalledOnce();
  });

  it('acts again on a second break', () => {
    const onReconnected = vi.fn();
    watchStorageReconnection(onReconnected);

    w3n.emitConnectivity(storageWsEvent('disconnected'));
    w3n.emitConnectivity({ isOnline: true });
    w3n.emitConnectivity(storageWsEvent('disconnected'));
    w3n.emitConnectivity({ isOnline: true });

    expect(onReconnected).toHaveBeenCalledTimes(2);
  });

  it('waits for connectivity, not just for the break to end', () => {
    const onReconnected = vi.fn();
    watchStorageReconnection(onReconnected);

    w3n.emitConnectivity(storageWsEvent('disconnected'));
    w3n.emitConnectivity({ isOnline: false });

    expect(onReconnected).not.toHaveBeenCalled();
  });

  it('answers with an unsubscribe', () => {
    const onReconnected = vi.fn();

    const unsubscribe = watchStorageReconnection(onReconnected);
    expect(w3n.connectivityObservers).toHaveLength(1);
    unsubscribe();

    expect(w3n.connectivityObservers).toHaveLength(0);
    w3n.emitConnectivity(storageWsEvent('disconnected'));
    w3n.emitConnectivity({ isOnline: true });
    expect(onReconnected).not.toHaveBeenCalled();
  });

  it('is a no-op without the connectivity cap', () => {
    delete (w3n.w3n as { connectivity?: unknown }).connectivity;
    const onReconnected = vi.fn();

    const unsubscribe = watchStorageReconnection(onReconnected);

    expect(() => unsubscribe()).not.toThrow();
    expect(onReconnected).not.toHaveBeenCalled();
  });

});
