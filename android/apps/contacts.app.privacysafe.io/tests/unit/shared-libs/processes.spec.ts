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
import { describe, expect, it } from 'vitest';
import { SingleProc } from '@shared/processes/single.ts';
import { NamedProcs } from '@shared/processes/named-procs.ts';
import { defer } from '@shared/processes/deferred.ts';
import { sleep } from '@shared/processes/sleep.ts';
import { callWithTimeout } from '@shared/processes/timeouts.ts';

/** Records start/end of each action, so interleaving becomes observable. */
function tracker() {
  const log: string[] = [];
  const action = (label: string, delay = 0) => async () => {
    log.push(`${label}:start`);
    await sleep(delay);
    log.push(`${label}:end`);
    return label;
  };
  return { log, action };
}

describe('defer', () => {

  it('resolves through the handle', async () => {
    const d = defer<number>();

    d.resolve(7);

    expect(await d.promise).toBe(7);
  });

  it('rejects through the handle', async () => {
    const d = defer<number>();

    d.reject(new Error('nope'));

    await expect(d.promise).rejects.toThrow('nope');
  });

  it('is frozen, so the handle cannot be tampered with', () => {
    expect(Object.isFrozen(defer<number>())).toBe(true);
  });

});

describe('SingleProc', () => {

  it('runs a single action and clears itself afterwards', async () => {
    const proc = new SingleProc();

    const result = await proc.start(async () => 'done');

    expect(result).toBe('done');
    expect(proc.getP()).toBeUndefined();
  });

  it('refuses a second concurrent start', async () => {
    const proc = new SingleProc();
    const first = proc.start(() => sleep(5));

    expect(() => proc.start(async () => 'second')).toThrow(/already in progress/);

    await first;
  });

  // This is the guarantee contacts-db and the settings writer rely on: writes
  // must not interleave, or one overwrites the other's file version.
  it('serialises chained actions instead of interleaving them', async () => {
    const proc = new SingleProc();
    const { log, action } = tracker();

    await Promise.all([
      proc.startOrChain(action('a', 10)),
      proc.startOrChain(action('b', 1)),
      proc.startOrChain(action('c', 1)),
    ]);

    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('clears the slot after a failing action, so later calls still run', async () => {
    const proc = new SingleProc();

    await expect(proc.start(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(proc.getP()).toBeUndefined();
    expect(await proc.start(async () => 'ok')).toBe('ok');
  });

});

describe('NamedProcs', () => {

  it('serialises actions sharing an id', async () => {
    const procs = new NamedProcs();
    const { log, action } = tracker();

    await Promise.all([
      procs.startOrChain('same', action('a', 10)),
      procs.startOrChain('same', action('b', 1)),
    ]);

    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  // Different keys are different files, so they must NOT be serialised against
  // each other — otherwise every avatar write would queue behind the db write.
  it('does not serialise actions with different ids', async () => {
    const procs = new NamedProcs();
    const { log, action } = tracker();

    await Promise.all([
      procs.startOrChain('one', action('a', 10)),
      procs.startOrChain('two', action('b', 1)),
    ]);

    expect(log.slice(0, 2)).toEqual(['a:start', 'b:start']);
    expect(log).toContain('a:end');
    expect(log).toContain('b:end');
  });

  it('refuses a second start under the same id', async () => {
    const procs = new NamedProcs();
    const first = procs.start('id', () => sleep(5));

    expect(() => procs.start('id', async () => 'second'))
    .toThrow(/Process with id "id" is already in progress/);

    await first;
  });

  it('forgets an id once its action settles', async () => {
    const procs = new NamedProcs();

    await procs.startOrChain('id', async () => 'ok');

    expect(procs.getP('id')).toBeUndefined();
  });

  it('forgets an id after a failing action', async () => {
    const procs = new NamedProcs();

    await expect(procs.startOrChain('id', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(procs.getP('id')).toBeUndefined();
  });

});

describe('callWithTimeout', () => {

  it('passes a fast result through', async () => {
    const result = await callWithTimeout(async () => 'fast', 50, () => new Error('too slow'));

    expect(result).toBe('fast');
  });

  it('rejects with the supplied error when the action is too slow', async () => {
    await expect(callWithTimeout(
      () => sleep(50).then(() => 'slow'), 5, () => new Error('too slow'),
    )).rejects.toThrow('too slow');
  });

  it('propagates the action error rather than the timeout error', async () => {
    await expect(callWithTimeout(async () => {
      throw new Error('action failed');
    }, 50, () => new Error('too slow'))).rejects.toThrow('action failed');
  });

  // The timeout branch only rejects when timeoutErr() returns something
  // truthy. Returning a falsy value leaves the promise pending forever — which
  // is what jasmine-utils relies on to merely log a timeout without failing.
  it('leaves the promise pending when the timeout error factory returns nothing', async () => {
    let settled = false;
    void callWithTimeout(() => sleep(50), 5, () => undefined)
    .then(() => { settled = true; }, () => { settled = true; });

    await sleep(25);

    expect(settled).toBe(false);
  });

});
