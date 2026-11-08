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
import { executeFunc } from '@shared/execute-function.ts';

// Every case passes timeoutValue: 0 unless it is specifically about the
// timeout, because any other value arms a real timer whose callback throws
// from inside setTimeout — see the last suite.
const noTimeout = { timeoutValue: 0 } as const;

describe('executeFunc', () => {

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the result of the wrapped function', async () => {
    const result = await executeFunc({
      fn: (a: number, b: number) => a + b,
      fnArgs: [2, 3],
      ...noTimeout,
    });

    expect(result).toBe(5);
  });

  it('awaits an async wrapped function', async () => {
    const result = await executeFunc({
      fn: async (v: string) => `${v}!`,
      fnArgs: ['ok'],
      ...noTimeout,
    });

    expect(result).toBe('ok!');
  });

  it('calls actionIfSuccess and actionInFinally on success', async () => {
    const actionIfSuccess = vi.fn();
    const actionInFinally = vi.fn();
    const actionIfError = vi.fn();

    await executeFunc({
      fn: () => 'ok', fnArgs: [], actionIfSuccess, actionInFinally, actionIfError, ...noTimeout,
    });

    expect(actionIfSuccess).toHaveBeenCalled();
    expect(actionInFinally).toHaveBeenCalled();
    expect(actionIfError).not.toHaveBeenCalled();
  });

  it('rethrows a wrapped error by default, running the error hooks', async () => {
    const actionIfError = vi.fn();
    const actionInFinally = vi.fn();

    await expect(executeFunc({
      fn: () => { throw new Error('inner boom'); },
      fnArgs: [], actionIfError, actionInFinally, ...noTimeout,
    })).rejects.toThrow(/inner boom/);

    expect(actionIfError).toHaveBeenCalled();
    expect(actionInFinally).toHaveBeenCalled();
  });

  it('uses errorText for the wrapped error message when given', async () => {
    await expect(executeFunc({
      fn: () => { throw new Error('inner boom'); },
      fnArgs: [], errorText: 'could not load contacts', ...noTimeout,
    })).rejects.toThrow('could not load contacts');
  });

  it('swallows the error and returns defaultValue when propagation is stopped', async () => {
    const actionIfError = vi.fn();

    const result = await executeFunc({
      fn: () => { throw new Error('inner boom'); },
      fnArgs: [],
      doesErrorPropagateStop: true,
      defaultValue: 'fallback',
      actionIfError,
      ...noTimeout,
    });

    expect(result).toBe('fallback');
    expect(actionIfError).toHaveBeenCalled();
  });

  it('passes the original error, not the wrapper, to actionIfError', async () => {
    const inner = new Error('inner boom');
    let seen: unknown;

    await executeFunc({
      fn: () => { throw inner; },
      fnArgs: [],
      doesErrorPropagateStop: true,
      defaultValue: undefined,
      actionIfError: err => { seen = err; },
      ...noTimeout,
    });

    expect(seen).toBe(inner);
  });

  describe('argument validation', () => {

    it('rejects a non-function fn', async () => {
      await expect(executeFunc({
        fn: undefined as unknown as () => void, fnArgs: [], ...noTimeout,
      })).rejects.toThrow(/'fn' is not a function/);
    });

    for (const hook of ['actionIfError', 'actionIfSuccess', 'actionInFinally'] as const) {
      it(`rejects a non-function ${hook}`, async () => {
        await expect(executeFunc({
          fn: () => 'ok', fnArgs: [], [hook]: 'nope', ...noTimeout,
        } as never)).rejects.toThrow(new RegExp(`'${hook}' is not a function`));
      });
    }

  });

  describe('timeout handling', () => {

    it('arms no timer at all when timeoutValue is 0', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      await executeFunc({ fn: () => 'ok', fnArgs: [], timeoutValue: 0 });

      expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('clears the armed timer once the function resolves', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await executeFunc({ fn: () => 'ok', fnArgs: [], timeoutValue: 5000 });

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    // Documents a real defect that no caller can work around: on expiry the
    // callback either `return`s a value into setTimeout (discarded) or throws
    // from inside the timer, where nothing can catch it. Either way the
    // promise returned by executeFunc is NEVER settled by the timeout, so a
    // hanging fn hangs forever and `timeoutValue` only ever produces a log
    // line. Asserted via the propagation-stopping branch, which logs instead
    // of throwing and so cannot take the test runner down with it.
    it('does not settle the promise when the timeout expires', async () => {
      vi.useFakeTimers();
      let settled = false;
      const pending = executeFunc({
        fn: () => new Promise(() => { /* never settles */ }),
        fnArgs: [],
        doesErrorPropagateStop: true,
        defaultValue: 'fallback',
        timeoutValue: 10,
      }).then(() => { settled = true; }, () => { settled = true; });

      await vi.advanceTimersByTimeAsync(50);

      expect(settled).toBe(false);
      expect(console.info).toHaveBeenCalled();

      vi.useRealTimers();
      void pending;
    });

  });

});
