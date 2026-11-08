/*
 Copyright (C) 2016 - 2019, 2021 3NSoft Inc.

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

import { WeakReference, makeWeakRefFor } from './weakref';

// XXX WeakReference shields choice between inbuilt and napi implementations of
// weaks. But inbuilt uses FinalizationRegistry, which is better used in cache
// directly. Take a look at following code:
// let registry = new FinalizationRegistry(key => { ... removes WeakRef });
// registry.register(val, key, val);
// ... on delete do: registry.unregister(val);
// Note that our WeakReference wrap has its own FinalizationRegistry, making it
// heavier.
export class WeakCache<TKey, TVal> {
  private readonly wRefs = new Map<TKey, WeakReference<TVal>>();

  constructor() {
    Object.freeze(this);
  }

  get(key: TKey): TVal | undefined {
    const wRef = this.wRefs.get(key);
    if (wRef) {
      const v = wRef.get();
      if (v === undefined) {
        this.wRefs.delete(key);
      } else {
        return v;
      }
    }
    return; // explicit return of undefined
  }

  has(key: TKey): boolean {
    return this.get(key) !== undefined;
  }

  set(key: TKey, val: TVal): void {
    const wRef = makeWeakRefFor(val);
    wRef.addCallback(this.makeCB(key, wRef));
    this.wRefs.set(key, wRef);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private makeCB(key: TKey, wRef: WeakReference<TVal>): Function {
    return () => {
      if (wRef === this.wRefs.get(key)) {
        this.wRefs.delete(key);
      }
    };
  }

  delete(key: TKey): void {
    this.wRefs.delete(key);
  }

  clear(): void {
    this.wRefs.clear();
  }
}
Object.freeze(WeakCache.prototype);
Object.freeze(WeakCache);
