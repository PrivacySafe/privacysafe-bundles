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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyConvergence,
  startConvergenceWatchdog,
} from '@deno/utils/convergence-watchdog.ts';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from '@deno/constants.ts';
import { makeEventCollector, makeFakeFs } from '../../helpers/fake-fs.ts';
import { installFakeW3n } from '../../helpers/fake-w3n.ts';

const INTERVAL_MS = 60000;
const STUCK_AFTER = 3;

type Status = web3n.files.SyncStatus;

function status(state: web3n.files.SyncState, isUploading = false): Status {
  return {
    state,
    ...(isUploading && { uploading: { localVersion: 2 } }),
  } as Status;
}

describe('classifyConvergence', () => {

  it('says converged when every path is on the server', () => {
    expect(classifyConvergence({
      statuses: [status('synced'), status('synced')],
      areUploadsHeld: false,
    })).toBe('converged');
  });

  it('asks for a pass when a path holds an unpublished version', () => {
    expect(classifyConvergence({
      statuses: [status('unsynced'), status('synced')],
      areUploadsHeld: false,
    })).toBe('resync');
  });

  it('asks for a pass when a path is in conflict', () => {
    expect(classifyConvergence({
      statuses: [status('synced'), status('conflicting')],
      areUploadsHeld: false,
    })).toBe('resync');
  });

  it('asks for a pass when a path is behind', () => {
    expect(classifyConvergence({
      statuses: [status('behind'), status('synced')],
      areUploadsHeld: false,
    })).toBe('resync');
  });

  // The root verification loop reports its own stuck state; a second voice on
  // the same single flag in the gui would only fight with it.
  it('stands aside while uploads are held', () => {
    expect(classifyConvergence({
      statuses: [status('unsynced'), status('conflicting')],
      areUploadsHeld: true,
    })).toBe('held');
  });

  // No status means status() itself failed, and status() is a request to the
  // server - so this is "cannot ask", not "failed to publish".
  it('reads a missing status as the server being out of reach', () => {
    expect(classifyConvergence({
      statuses: [undefined, status('synced')],
      areUploadsHeld: false,
    })).toBe('unreachable');
  });

  it('leaves an upload in flight alone', () => {
    expect(classifyConvergence({
      statuses: [status('unsynced', true), status('synced')],
      areUploadsHeld: false,
    })).toBe('uploading');
  });

});

describe('startConvergenceWatchdog', () => {

  let w3n: ReturnType<typeof installFakeW3n>;
  let fake: ReturnType<typeof makeFakeFs>;
  let collector: ReturnType<typeof makeEventCollector>;
  let statuses: Record<string, Status | undefined>;
  let areUploadsHeld: boolean;
  let runSyncPass: ReturnType<typeof vi.fn>;
  let stop: (() => void) | undefined;

  function start() {
    stop = startConvergenceWatchdog({
      fs: fake.fs,
      paths: [CONTACTS_DB_FILE, IMAGES_FOLDER],
      areUploadsHeld: () => areUploadsHeld,
      runSyncPass: runSyncPass as unknown as () => Promise<void>,
      emitStorageEvent: collector.emitStorageEvent,
      intervalMs: INTERVAL_MS,
      stuckAfterAttempts: STUCK_AFTER,
    });
  }

  /** Lets the watchdog's wait end, and its tick run to completion. */
  async function tick(times = 1) {
    for (let i = 0; i < times; i++) {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    }
  }

  function setStatuses(db: Status | undefined, images: Status | undefined) {
    statuses = { [CONTACTS_DB_FILE]: db, [IMAGES_FOLDER]: images };
  }

  beforeEach(() => {
    w3n = installFakeW3n();
    vi.useFakeTimers();
    fake = makeFakeFs();
    collector = makeEventCollector();
    areUploadsHeld = false;
    setStatuses(status('synced'), status('synced'));
    fake.sync.status.mockImplementation(async (path: string) => statuses[path]);
    runSyncPass = vi.fn(async () => undefined);
  });

  afterEach(async () => {
    stop?.();
    // Lets the parked loop notice that it was stopped, so no test leaves one
    // running into the next.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    stop = undefined;
    vi.useRealTimers();
    w3n.uninstall();
    vi.restoreAllMocks();
  });

  it('runs a pass when a version was never published', async () => {
    setStatuses(status('unsynced'), status('synced'));
    start();

    await tick();

    expect(runSyncPass).toHaveBeenCalledOnce();
  });

  it('runs no pass while everything is on the server', async () => {
    start();

    await tick(3);

    expect(runSyncPass).not.toHaveBeenCalled();
    expect(collector.events).toHaveLength(0);
  });

  it('runs no pass while the root is not verified', async () => {
    setStatuses(status('conflicting'), status('synced'));
    areUploadsHeld = true;
    start();

    await tick(3);

    expect(runSyncPass).not.toHaveBeenCalled();
  });

  it('runs no pass while the server cannot be reached', async () => {
    setStatuses(undefined, undefined);
    start();

    await tick(3);

    expect(runSyncPass).not.toHaveBeenCalled();
  });

  it('runs no pass while the platform is uploading', async () => {
    setStatuses(status('unsynced', true), status('synced'));
    start();

    await tick();

    expect(runSyncPass).not.toHaveBeenCalled();
  });

  it('keeps trying on every tick while the version stays unpublished', async () => {
    setStatuses(status('unsynced'), status('synced'));
    start();

    await tick(3);

    expect(runSyncPass).toHaveBeenCalledTimes(3);
  });

  it('stops asking once a pass publishes the version', async () => {
    setStatuses(status('unsynced'), status('synced'));
    runSyncPass.mockImplementation(async () => {
      setStatuses(status('synced'), status('synced'));
    });
    start();

    await tick(3);

    expect(runSyncPass).toHaveBeenCalledOnce();
  });

  // The point of the whole watchdog: after the platform abandons an upload the
  // file is left conflicting, and the NEXT pass writes it under the version the
  // other device has meanwhile published.
  it('tells the user only after the configured number of fruitless attempts', async () => {
    setStatuses(status('conflicting'), status('synced'));
    start();

    await tick(STUCK_AFTER - 1);
    expect(collector.events).toHaveLength(0);

    await tick();

    expect(collector.events).toContainEqual({
      event: 'sync:stuck',
      payload: { isStuck: true, reason: 'local-version-not-published' },
    });
  });

  // A dead upload takes its 'upload-done' with it, and that event is the only
  // thing that ever closes a path in the sync list - so without this the
  // progress bar keeps running under the warning for the rest of the session.
  it('clears the sync indicator when it gives up', async () => {
    setStatuses(status('conflicting'), status('synced'));
    start();

    await tick(STUCK_AFTER);

    expect(collector.names()).toEqual(['sync:clean', 'sync:stuck']);
  });

  it('tells the user once, not once per tick', async () => {
    setStatuses(status('conflicting'), status('synced'));
    start();

    await tick(STUCK_AFTER + 3);

    expect(collector.names()).toEqual(['sync:clean', 'sync:stuck']);
  });

  it('takes the warning back when the version finally lands', async () => {
    setStatuses(status('conflicting'), status('synced'));
    start();

    await tick(STUCK_AFTER);
    setStatuses(status('synced'), status('synced'));
    await tick();

    expect(collector.events.filter(e => e.event === 'sync:stuck')).toEqual([
      { event: 'sync:stuck', payload: { isStuck: true, reason: 'local-version-not-published' } },
      { event: 'sync:stuck', payload: { isStuck: false } },
    ]);
  });

  // The gui keeps one boolean for every source of a stuck sync, so clearing a
  // warning this watchdog never raised would wipe out the root verification's.
  it('never clears a warning it did not raise', async () => {
    start();

    await tick(3);

    expect(collector.events).toHaveLength(0);
  });

  // A watchdog that dies on the first bad tick is worse than none: the failure
  // it exists to survive is exactly the kind that repeats.
  it('keeps ticking after a pass throws', async () => {
    setStatuses(status('unsynced'), status('synced'));
    runSyncPass.mockRejectedValue(new Error('pass failed'));
    start();

    await tick(3);

    expect(runSyncPass).toHaveBeenCalledTimes(3);
    expect(w3n.w3n.log).toHaveBeenCalledWith(
      'error', 'A convergence watchdog tick failed', expect.any(Error),
    );
  });

  it('stops when asked to', async () => {
    setStatuses(status('unsynced'), status('synced'));
    start();

    await tick();
    expect(runSyncPass).toHaveBeenCalledOnce();

    stop!();
    await tick(3);

    expect(runSyncPass).toHaveBeenCalledOnce();
  });

});
