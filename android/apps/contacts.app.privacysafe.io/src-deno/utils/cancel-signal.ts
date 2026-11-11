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

/**
 * Cancellation of a long operation of the component, in place of
 * AbortController: on Android the component runs in a bare V8 isolate
 * (androidx.javascriptengine) whose preload brings core-js, and core-js has no
 * AbortController - `new AbortController()` throws there. Used on every OS, so
 * that the code path is one. Only what the backup and share code needs.
 */
export interface CancelSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, opts?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface CancelController {
  readonly signal: CancelSignal;
  abort(): void;
}

export function makeCancelController(): CancelController {
  let aborted = false;
  const listeners = new Set<() => void>();

  const signal: CancelSignal = {
    get aborted() {
      return aborted;
    },
    addEventListener(_type, listener) {
      if (!aborted) {
        listeners.add(listener);
      }
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };

  return {
    signal,
    abort() {
      if (aborted) {
        return;
      }
      aborted = true;
      // Every listener is called once, as with `{ once: true }`.
      const toCall = [...listeners];
      listeners.clear();
      for (const listener of toCall) {
        try {
          listener();
        } catch {
          // One listener's failure does not keep the others from the news.
        }
      }
    },
  };
}
