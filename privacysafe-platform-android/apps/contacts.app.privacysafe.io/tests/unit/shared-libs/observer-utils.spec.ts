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
import { ObserversSet } from '@shared/observer-utils.ts';

describe('ObserversSet', () => {

  it('starts empty', () => {
    expect(new ObserversSet<number>().isEmpty()).toBe(true);
  });

  it('fans a value out to every observer', () => {
    const set = new ObserversSet<number>();
    const first = vi.fn();
    const second = vi.fn();
    set.add({ next: first });
    set.add({ next: second });

    set.next(7);

    expect(first).toHaveBeenCalledWith(7);
    expect(second).toHaveBeenCalledWith(7);
  });

  it('stops delivering to a deleted observer', () => {
    const set = new ObserversSet<number>();
    const obs = { next: vi.fn() };
    set.add(obs);

    set.delete(obs);
    set.next(7);

    expect(obs.next).not.toHaveBeenCalled();
    expect(set.isEmpty()).toBe(true);
  });

  it('ignores a repeated add of the same observer', () => {
    const set = new ObserversSet<number>();
    const obs = { next: vi.fn() };

    set.add(obs);
    set.add(obs);
    set.next(7);

    expect(obs.next).toHaveBeenCalledTimes(1);
  });

  it('tolerates observers that have no next handler', () => {
    const set = new ObserversSet<number>();
    set.add({});

    expect(() => set.next(7)).not.toThrow();
  });

  // The contacts service pushes every ContactEvent through this set. A single
  // misbehaving subscriber must not stop the others from being notified, or a
  // thrown error in one window would silently freeze another window's list.
  it('keeps notifying the remaining observers when one throws', () => {
    const set = new ObserversSet<number>();
    const healthy = vi.fn();
    set.add({ next: () => { throw new Error('bad subscriber'); } });
    set.add({ next: healthy });

    expect(() => set.next(7)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(7);
  });

  it('notifies and then drops every observer on error', () => {
    const set = new ObserversSet<number>();
    const onError = vi.fn();
    set.add({ error: onError });

    set.error(new Error('stream broke'));

    expect(onError).toHaveBeenCalled();
    expect(set.isEmpty()).toBe(true);
  });

  it('notifies and then drops every observer on completion', () => {
    const set = new ObserversSet<number>();
    const onComplete = vi.fn();
    set.add({ complete: onComplete });

    set.complete();

    expect(onComplete).toHaveBeenCalled();
    expect(set.isEmpty()).toBe(true);
  });

  it('delivers nothing after completion', () => {
    const set = new ObserversSet<number>();
    const obs = { next: vi.fn(), complete: vi.fn() };
    set.add(obs);

    set.complete();
    set.next(7);

    expect(obs.next).not.toHaveBeenCalled();
  });

  it('exposes next/error/complete as bound methods', () => {
    const set = new ObserversSet<number>();
    const obs = { next: vi.fn() };
    set.add(obs);

    // The service hands `emitStorageEvent` around as a bare function, so the
    // methods must not depend on the call-site `this`.
    const { next } = set;
    next(7);

    expect(obs.next).toHaveBeenCalledWith(7);
  });

});
