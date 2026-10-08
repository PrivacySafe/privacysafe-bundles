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
import { connectException, makeFakeFs } from '../../helpers/fake-fs.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkServerConnection', () => {

  it('reports a connection when the root has a sync status', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue({ state: 'synced' });

    expect(await checkServerConnection(fs)).toBe(true);
    expect(sync.status).toHaveBeenCalledWith('');
  });

  it('reports no connection when the status is absent', async () => {
    const { fs, sync } = makeFakeFs();
    sync.status.mockResolvedValue(undefined);

    expect(await checkServerConnection(fs)).toBe(false);
  });

  // Being offline is an expected state, not a fault, so it must stay out of the
  // error log — otherwise every offline start writes a scary entry.
  it('stays quiet about a connect exception', async () => {
    const { fs, sync } = makeFakeFs();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sync.status.mockRejectedValue(connectException());

    expect(await checkServerConnection(fs)).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs any other failure but still reports no connection', async () => {
    const { fs, sync } = makeFakeFs();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sync.status.mockRejectedValue(new Error('unexpected'));

    expect(await checkServerConnection(fs)).toBe(false);
    expect(error).toHaveBeenCalled();
  });

});
