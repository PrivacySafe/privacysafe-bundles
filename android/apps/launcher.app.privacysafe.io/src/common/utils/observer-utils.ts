/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty, prefer-const */
import { defer, Deferred } from './processes/deferred';

type Observer<T> = web3n.Observer<T>;

export class ObserversSet<T> implements Observer<T> {
  private readonly observers = new Set<Observer<T>>();

  add(obs: Observer<T>): void {
    this.observers.add(obs);
  }

  readonly next = (value: T): void => {
    for (const obs of this.observers) {
      try {
        obs.next?.(value);
      } catch (err) {}
    }
  };

  readonly error = (err: any): void => {
    for (const obs of this.observers) {
      try {
        obs.error?.(err);
      } catch (err) {}
    }
    this.observers.clear();
  };

  readonly complete = (): void => {
    for (const obs of this.observers) {
      try {
        obs.complete?.();
      } catch (err) {}
    }
    this.observers.clear();
  };

  delete(obs: Observer<T>): void {
    this.observers.delete(obs);
  }

  isEmpty(): boolean {
    return this.observers.size === 0;
  }
}

export function observerToGeneratorPipe<T>(): {
  obs: Observer<T>;
  generator: AsyncGenerator<Awaited<T | undefined>, void, unknown>;
} {
  let deferred: Deferred<T> | undefined = undefined;
  const buffer: T[] = [];
  let done: { err?: any } | undefined = undefined;
  const generator = (async function* pipeFromObserver() {
    while (buffer.length > 0 || !done) {
      let ev = buffer.shift();
      if (ev === undefined) {
        deferred = defer();
        yield deferred.promise;
      } else {
        yield ev;
      }
    }
  })();
  const obs: Observer<T> = {
    next: ev => {
      if (deferred) {
        deferred.resolve(ev);
        deferred = undefined;
      } else {
        buffer.push(ev);
      }
    },
    error: err => {
      if (deferred) {
        deferred.reject(err);
        deferred = undefined;
      } else {
        done = { err };
      }
    },
    complete: () => {
      if (deferred) {
        generator.return();
        setTimeout(() => deferred?.resolve(undefined as any), 1);
      } else {
        done = {};
      }
    },
  };
  return { obs, generator };
}
