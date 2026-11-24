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
import {
  connectToContactsService,
  connectWithRetries,
  SERVICE_CONNECT_ATTEMPTS,
} from '@main/common/services/connect-with-retries';

const timeout = () => new Error('Timeout in connecting to service AppContactsInternal');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as Record<string, unknown>).w3n;
});

describe('connectWithRetries', () => {

  it('makes three attempts', () => {
    expect(SERVICE_CONNECT_ATTEMPTS).toBe(3);
  });

  it('returns the first connection that succeeds', async () => {
    const connect = vi.fn()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce('conn');
    const onFailedAttempt = vi.fn();

    const result = connectWithRetries(connect, { onFailedAttempt });
    await vi.runAllTimersAsync();

    expect(await result).toBe('conn');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(onFailedAttempt).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('gives up after the last attempt with its error', async () => {
    const last = timeout();
    const connect = vi.fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(last);
    const onFailedAttempt = vi.fn();

    const result = connectWithRetries(connect, { onFailedAttempt });
    const settled = result.catch(err => err);
    await vi.runAllTimersAsync();

    expect(await settled).toBe(last);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(onFailedAttempt).toHaveBeenCalledTimes(2);
  });

  it('connects to the internal service and logs the retries', async () => {
    const thisApp = vi.fn()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce('conn');
    const log = vi.fn(async () => undefined);
    (globalThis as unknown as Record<string, unknown>).w3n = { rpc: { thisApp }, log };

    const result = connectToContactsService();
    await vi.runAllTimersAsync();

    expect(await result).toBe('conn');
    expect(thisApp).toHaveBeenCalledWith('AppContactsInternal');
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('attempt 1 of 3'), expect.any(Error));
  });

  it('tells the user under the start-up animation that it tries again', async () => {
    document.body.innerHTML = '<div class="app-init"></div>';
    const thisApp = vi.fn()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce('conn');
    (globalThis as unknown as Record<string, unknown>).w3n = {
      rpc: { thisApp },
      log: vi.fn(async () => undefined),
      shell: { getFSResource: vi.fn(async () => ({ readJSON: async () => ({ lang: 'en' }) })) },
    };

    const result = connectToContactsService();
    await vi.runAllTimersAsync();
    await result;

    expect(document.querySelector('.app-init-status')?.textContent).toContain('attempt 2 of 3');
    document.body.innerHTML = '';
  });

});
