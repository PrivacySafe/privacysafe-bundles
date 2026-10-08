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
  actionIfError?: (err?: unknown) => void;
  actionIfSuccess?: () => void;
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
  public cause: unknown;
  constructor(message: string, data?: { cause?: unknown; fnArgs?: unknown[] }) {
    super(message);
    this.cause = data?.cause;
    this.name = 'ExecuteFunctionError';
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

      const result = await Promise.race([executionPromise, timeoutPromise]);

      if (tOut) {
        clearTimeout(tOut);
      }
      actionIfSuccess?.();
      actionInFinally?.();
      return result;
    } catch (err) {
      if (tOut) {
        clearTimeout(tOut);
      }
      lastError = err;

      if (attempt < totalAttempts) {
        console.warn(`[executeFunc] Attempt ${attempt} failed. Retrying in ${retryDelay}ms...`, err);
        if (retryDelay > 0) {
          await sleep(retryDelay);
        }
      }
    }
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
  actionIfError?.(finalError);
  actionInFinally?.();

  if (!doesErrorPropagateStop) {
    throw finalError;
  }

  return defaultValue as V;
}
