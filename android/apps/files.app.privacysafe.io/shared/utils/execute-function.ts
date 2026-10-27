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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { sleep } from '../../shared/utils/processes/sleep.ts';

type ExtractArgs<F> = F extends (signal: AbortSignal, ...args: infer P) => any
  ? P
  : F extends (...args: infer P) => any
    ? P
    : never;

interface BaseProps<F extends (...args: any[]) => any, V> {
  fn: F;
  fnArgs: ExtractArgs<F>;
  passSignal?: boolean;
  timeoutValue?: number;
  retryCount?: number;
  retryDelay?: number;
  errorText?: string;
  /** Receives the error thrown by `fn` itself (or the timeout error) of the last attempt. */
  actionIfError?: (err?: unknown) => void;
  /** Runs once after a successful attempt; it is awaited and is never a reason to retry `fn`. */
  actionIfSuccess?: () => void | Promise<void>;
  /** Runs once at the very end, both after success and after the last failed attempt. */
  actionInFinally?: () => void;
}

interface ExecuteFunctionPropsNoCatchError<
  F extends (...args: any[]) => any,
  V = Awaited<ReturnType<F>>,
> extends BaseProps<F, V> {
  doesErrorPropagateStop: true;
  defaultValue: V;
}

interface ExecuteFunctionPropsCatchError<
  F extends (...args: any[]) => any,
  V = Awaited<ReturnType<F>>,
> extends BaseProps<F, V> {
  doesErrorPropagateStop?: false;
  defaultValue?: undefined;
}

type ExecuteFunctionProps<F extends (...args: any[]) => any, V = Awaited<ReturnType<F>>> =
  | ExecuteFunctionPropsCatchError<F, V>
  | ExecuteFunctionPropsNoCatchError<F, V>;

class ExecuteFunctionError extends Error {
  public override cause: unknown;
  constructor(message: string, data?: { cause?: unknown; fnArgs?: unknown[] }) {
    super(message);
    this.cause = data?.cause;
    this.name = 'ExecuteFunctionError';
  }
}

function runHandlerSafely(name: string, handler: (() => void) | undefined): void {
  try {
    handler?.();
  } catch (err) {
    console.error(`[executeFunc] The ${name} handler has thrown an error.`, err);
  }
}

export async function executeFunc<F extends (...args: any[]) => any, V = Awaited<ReturnType<F>>>(
  props: ExecuteFunctionProps<F, V>,
): Promise<V> {
  const {
    fn,
    fnArgs,
    passSignal = false,
    defaultValue,
    doesErrorPropagateStop = false,
    timeoutValue = 5000,
    retryCount = 0,
    retryDelay = 1000,
    errorText = `An error occurred while executing the function.`,
    actionIfError,
    actionIfSuccess,
    actionInFinally,
  } = props;

  const argsArray = fnArgs as ExtractArgs<F>;
  const totalAttempts = retryCount + 1;
  let lastError: any;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const controller = new AbortController();
    let tOut: ReturnType<typeof setTimeout> | null = null;
    let result: Awaited<ReturnType<F>>;

    try {
      const executionPromise = (async () => {
        return passSignal ? fn(controller.signal, ...argsArray) : fn(...argsArray);
      })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        if (timeoutValue > 0) {
          tOut = setTimeout(() => {
            controller.abort();
            reject(
              new ExecuteFunctionError(`Attempt ${attempt}/${totalAttempts} timed out.`, {
                cause: 'timeout',
                fnArgs: argsArray,
              }),
            );
          }, timeoutValue);
        }
      });

      result = await Promise.race([executionPromise, timeoutPromise]);
    } catch (err) {
      lastError = err;

      if (attempt < totalAttempts) {
        console.warn(`[executeFunc] Attempt ${attempt} failed. Retrying in ${retryDelay}ms...`, err);
        if (retryDelay > 0) {
          await sleep(retryDelay);
        }
      }
      continue;
    } finally {
      if (tOut) {
        clearTimeout(tOut);
      }
    }

    // success: handlers run outside of the retry loop, so their errors never re-run `fn`
    try {
      await actionIfSuccess?.();
    } finally {
      runHandlerSafely('actionInFinally', actionInFinally);
    }
    return result as V;
  }

  const isTimeout = lastError instanceof ExecuteFunctionError && lastError.cause === 'timeout';
  const isAbort = lastError?.name === 'AbortError' || lastError?.name === 'CanceledError';

  const finalError = isTimeout
    ? lastError
    : new ExecuteFunctionError(isAbort ? 'Operation aborted' : errorText, {
        cause: lastError,
        fnArgs: argsArray,
      });

  console.error(`[executeFunc] All ${totalAttempts} attempts failed.`, finalError);
  runHandlerSafely('actionIfError', () => actionIfError?.(lastError));
  runHandlerSafely('actionInFinally', actionInFinally);

  if (!doesErrorPropagateStop) {
    throw finalError;
  }

  return defaultValue as V;
}
