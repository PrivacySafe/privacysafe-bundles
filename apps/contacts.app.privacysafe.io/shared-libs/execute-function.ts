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

interface ExecuteFunctionPropsNoCatchError<P extends unknown[], V = unknown> {
  fn: (...payload: P) => V | Promise<V>;
  fnArgs: P;
  doesErrorPropagateStop: true;
  defaultValue: V | undefined;
  timeoutValue?: number;
  errorText?: string;
  actionIfError?: (err?: unknown) => void;
  actionIfSuccess?: () => void;
  actionInFinally?: () => void;
}

interface ExecuteFunctionPropsCatchError<P extends unknown[], V = unknown> {
  fn: (...payload: P) => V | Promise<V>;
  fnArgs: P;
  doesErrorPropagateStop?: false;
  defaultValue?: undefined;
  timeoutValue?: number;
  errorText?: string;
  actionIfError?: (err?: unknown) => void;
  actionIfSuccess?: () => void;
  actionInFinally?: () => void;
}

type ExecuteFunctionProps<P extends unknown[], V = unknown> =
  | ExecuteFunctionPropsCatchError<P, V>
  | ExecuteFunctionPropsNoCatchError<P, V>;

class ExecuteFunctionError extends Error {
  private data: { arguments: string };

  constructor(message: string, data?: { cause?: unknown; fnArgs?: unknown[] }) {
    super(message);
    this.cause = data?.cause;
    this.name = 'ExecuteFunctionError';
    this.data = {
      arguments: data?.fnArgs ? `(${data.fnArgs.join(', ')})` : '()',
    };
  }
}

export async function executeFunc<P extends unknown[], V = unknown>(
  {
    fn,
    fnArgs,
    defaultValue,
    doesErrorPropagateStop,
    timeoutValue,
    errorText,
    actionIfError,
    actionIfSuccess,
    actionInFinally,
  }: ExecuteFunctionProps<P, V>): Promise<V> {
  if (!fn || typeof fn !== 'function') {
    const error = new ExecuteFunctionError(`The argument 'fn' is not a function`, {
      cause: 'arguments',
    });
    console.error(error);
    throw error;
  }

  if (actionIfError && typeof actionIfError !== 'function') {
    const error = new ExecuteFunctionError(`The argument 'actionIfError' is not a function`, {
      cause: 'arguments',
    });
    console.error(error);
    throw error;
  }

  if (actionIfSuccess && typeof actionIfSuccess !== 'function') {
    const error = new ExecuteFunctionError(`The argument 'actionIfSuccess' is not a function`, {
      cause: 'arguments',
    });
    console.error(error);
    throw error;
  }

  if (actionInFinally && typeof actionInFinally !== 'function') {
    const error = new ExecuteFunctionError(`The argument 'actionInFinally' is not a function`, {
      cause: 'arguments',
    });
    console.error(error);
    throw error;
  }

  const fnName = fn?.name || '(anonymous)';
  const argsRegex = /\((.*?)\)/;
  const argsStr = fn.toString().match(argsRegex);
  // const args = argsStr && argsStr[1] ? argsStr[1].split(',').map(arg => arg.trim()) : [];

  let tOut: ReturnType<typeof setTimeout> | null = null;
  if (timeoutValue !== 0) {
    tOut = setTimeout(() => {
      const error = new ExecuteFunctionError(
        `The time to retrieve the function ${fnName}(${argsStr && argsStr[1]}) result has expired.`,
        {
          cause: 'timeout',
          fnArgs,
        },
      );

      if (doesErrorPropagateStop) {
        console.info(error);
        return defaultValue || undefined;
      } else {
        console.error(error);
        throw error;
      }
    }, timeoutValue || 5000);
  }

  try {
    const res = await fn(...(fnArgs || []));
    tOut && clearTimeout(tOut);
    tOut = null;

    if (actionIfSuccess) {
      actionIfSuccess();
    }

    return res;
  } catch (e) {
    if (!(e instanceof ExecuteFunctionError) && tOut) {
      clearTimeout(tOut);
      tOut = null;
    }

    const error = new ExecuteFunctionError(
      errorText || `The error while executing ${fnName}(${argsStr && argsStr[1]}) method. \n ${(e as Error).message}`,
      {
        cause: (e as Error).cause || 'internal',
        fnArgs,
      },
    );

    if (actionIfError) {
      actionIfError(e);
    }

    if (doesErrorPropagateStop) {
      tOut && clearTimeout(tOut);
      tOut = null;
      return defaultValue as V;
    }

    throw e instanceof ExecuteFunctionError ? e : error;
  } finally {
    if (actionInFinally) {
      actionInFinally();
    }
  }
}
