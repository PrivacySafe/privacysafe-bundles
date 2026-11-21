import { describe, expect, it, vi } from 'vitest';
import { executeFunc } from '../../../shared/utils/execute-function.ts';

describe('executeFunc', () => {
  // Regression for plan 2.1: handlers used to get a wrapper error without the
  // original fields, so `err.path.replace(...)` in a handler threw a TypeError,
  // skipped actionInFinally and ignored doesErrorPropagateStop.
  it('passes the original error to actionIfError', async () => {
    const original = { type: 'file', path: 'a.txt', notFound: true };
    const actionIfError = vi.fn();

    await executeFunc({
      fn: async () => {
        throw original;
      },
      fnArgs: [],
      timeoutValue: 0,
      doesErrorPropagateStop: true,
      defaultValue: undefined,
      actionIfError,
    });

    expect(actionIfError).toHaveBeenCalledWith(original);
  });

  it('still runs actionInFinally and honours doesErrorPropagateStop when actionIfError throws', async () => {
    const actionInFinally = vi.fn();

    const res = await executeFunc({
      fn: async () => {
        throw new Error('boom');
      },
      fnArgs: [],
      timeoutValue: 0,
      doesErrorPropagateStop: true,
      defaultValue: 'default',
      actionIfError: () => {
        throw new TypeError('handler bug');
      },
      actionInFinally,
    });

    expect(res).toBe('default');
    expect(actionInFinally).toHaveBeenCalledTimes(1);
  });

  it('throws a wrapper with the original error as cause without doesErrorPropagateStop', async () => {
    const original = new Error('boom');

    await expect(
      executeFunc({
        fn: async () => {
          throw original;
        },
        fnArgs: [],
        timeoutValue: 0,
      }),
    ).rejects.toMatchObject({ name: 'ExecuteFunctionError', cause: original });
  });

  it('retries a failing call and returns the first successful result', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValueOnce(42);

    const res = await executeFunc({ fn, fnArgs: [], timeoutValue: 0, retryCount: 2, retryDelay: 0 });

    expect(res).toBe(42);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Regression for plan 2.1: actionIfSuccess used to run inside the retry loop,
  // so its error re-ran `fn`.
  it('does not re-run fn when actionIfSuccess fails, and awaits it', async () => {
    const fn = vi.fn(async () => 'ok');
    const actionInFinally = vi.fn();
    let successDone = false;

    await expect(
      executeFunc({
        fn,
        fnArgs: [],
        timeoutValue: 0,
        retryCount: 2,
        retryDelay: 0,
        actionIfSuccess: async () => {
          await Promise.resolve();
          successDone = true;
          throw new Error('handler failed');
        },
        actionInFinally,
      }),
    ).rejects.toThrow('handler failed');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(successDone).toBe(true);
    expect(actionInFinally).toHaveBeenCalledTimes(1);
  });
});
