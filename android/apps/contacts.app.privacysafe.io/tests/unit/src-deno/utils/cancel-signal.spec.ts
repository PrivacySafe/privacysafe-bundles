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
import { describe, expect, it, vi } from 'vitest';
import { makeCancelController } from '@deno/utils/cancel-signal.ts';

describe('makeCancelController', () => {
  it('is not aborted until abort() is called', () => {
    const ctrl = makeCancelController();
    expect(ctrl.signal.aborted).toBe(false);
    ctrl.abort();
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('calls each listener once, and none that was removed', () => {
    const ctrl = makeCancelController();
    const kept = vi.fn();
    const removed = vi.fn();
    ctrl.signal.addEventListener('abort', kept, { once: true });
    ctrl.signal.addEventListener('abort', removed, { once: true });
    ctrl.signal.removeEventListener('abort', removed);
    ctrl.abort();
    ctrl.abort();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it('a failing listener does not keep the others from being called', () => {
    const ctrl = makeCancelController();
    const after = vi.fn();
    ctrl.signal.addEventListener('abort', () => { throw new Error('boom'); });
    ctrl.signal.addEventListener('abort', after);
    ctrl.abort();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('does not use AbortController, which the Android isolate lacks', () => {
    const saved = globalThis.AbortController;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).AbortController = undefined;
    try {
      const ctrl = makeCancelController();
      ctrl.abort();
      expect(ctrl.signal.aborted).toBe(true);
    } finally {
      globalThis.AbortController = saved;
    }
  });
});
