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
*/
// SingleProc is what keeps the file service from writing two things at once,
// so the ordering guarantees here are the ones the storage relies on.
import { describe, expect, it, vi } from 'vitest';
import { SingleProc } from '@shared/processes/single';
import { NamedProcs } from '@shared/processes/named-procs';
import { defer } from '@shared/processes/deferred';
import { sleep } from '@shared/processes/sleep';

describe('defer', () => {

  it('resolves from the outside', async () => {
    const d = defer<string>();

    d.resolve('done');

    await expect(d.promise).resolves.toBe('done');
  });

  it('rejects from the outside', async () => {
    const d = defer<string>();

    d.reject(new Error('nope'));

    await expect(d.promise).rejects.toThrow('nope');
  });

  // Frozen so that nothing can swap the resolve out from under a waiter.
  it('is frozen', () => {
    const d = defer<string>();

    expect(Object.isFrozen(d)).toBe(true);
  });

});

describe('SingleProc', () => {

  it('reports no process when idle', () => {
    expect(new SingleProc().getP()).toBeUndefined();
  });

  it('reports the promise while a process runs', async () => {
    const proc = new SingleProc();
    const d = defer<string>();

    const started = proc.start(() => d.promise);
    expect(proc.getP()).toBeDefined();

    d.resolve('done');
    await expect(started).resolves.toBe('done');
    expect(proc.getP()).toBeUndefined();
  });

  it('refuses a second start while one is running', async () => {
    const proc = new SingleProc();
    const d = defer<undefined>();
    const started = proc.start(() => d.promise);

    expect(() => proc.start(async () => undefined)).toThrow(/already in progress/);

    d.resolve();
    await started;
  });

  // What the file service depends on: two writes must not interleave.
  it('runs chained actions one after another', async () => {
    const proc = new SingleProc();
    const order: string[] = [];

    const first = proc.startOrChain(async () => {
      order.push('first-start');
      await sleep(20);
      order.push('first-end');
    });
    const second = proc.startOrChain(async () => {
      order.push('second-start');
      await sleep(1);
      order.push('second-end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('does not start a chained action before the first one is asked for', async () => {
    const proc = new SingleProc();
    const later = vi.fn(async () => undefined);
    const d = defer<undefined>();

    const first = proc.startOrChain(() => d.promise);
    proc.startOrChain(later);

    expect(later).not.toHaveBeenCalled();

    d.resolve();
    await first;
    await proc.getP();

    expect(later).toHaveBeenCalledTimes(1);
  });

  it('frees itself after a failure, so the next action can still run', async () => {
    const proc = new SingleProc();

    await expect(proc.start(async () => {
      throw new Error('write failed');
    })).rejects.toThrow('write failed');

    expect(proc.getP()).toBeUndefined();
    await expect(proc.start(async () => 'second')).resolves.toBe('second');
  });

  it('takes over an already started promise', async () => {
    const proc = new SingleProc();

    await expect(proc.addStarted(Promise.resolve('done'))).resolves.toBe('done');
    expect(proc.getP()).toBeUndefined();
  });

});

describe('NamedProcs', () => {

  it('knows nothing of an id that never ran', () => {
    expect(new NamedProcs().getP('absent')).toBeUndefined();
  });

  // Two records saving at once must not be serialised against each other, only
  // against themselves.
  it('keeps processes of different ids apart', async () => {
    const procs = new NamedProcs();
    const order: string[] = [];
    const slow = defer<undefined>();

    const a = procs.startOrChain('a', async () => {
      await slow.promise;
      order.push('a');
    });
    const b = procs.startOrChain('b', async () => {
      order.push('b');
    });

    await b;
    expect(order).toEqual(['b']);

    slow.resolve();
    await a;
    expect(order).toEqual(['b', 'a']);
  });

  it('chains processes sharing an id', async () => {
    const procs = new NamedProcs();
    const order: string[] = [];

    const first = procs.startOrChain('same', async () => {
      await sleep(20);
      order.push('first');
    });
    const second = procs.startOrChain('same', async () => {
      order.push('second');
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first', 'second']);
  });

  it('forgets an id once its process is done', async () => {
    const procs = new NamedProcs();

    await procs.startOrChain('id', async () => undefined);

    expect(procs.getP('id')).toBeUndefined();
  });

  it('forgets an id whose process failed', async () => {
    const procs = new NamedProcs();

    await expect(procs.startOrChain('id', async () => {
      throw new Error('nope');
    })).rejects.toThrow('nope');

    expect(procs.getP('id')).toBeUndefined();
  });

});
