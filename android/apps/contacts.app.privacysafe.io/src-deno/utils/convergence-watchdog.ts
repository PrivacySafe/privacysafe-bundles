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
// Notices that a local version was never published, and runs the sync pass
// again until it is.
//
// TEMPORARY, and the only reason it exists is that an upload can die without
// telling anyone. The platform's UploadEvent has no failure variant at all -
// only started / progress / disconnected / done - and an upload begun with
// startUpload() rejects a promise nobody holds, so the failure surfaces as an
// "Unhandled rejection of promise" in the PLATFORM's log and never reaches the
// app. Seen for real in the live test of 2026-09-13: the server answered 495
// (mismatched object version) to a perfectly ordinary two-device conflict, the
// client library threw on parsing that reply, the upload task was abandoned,
// and the two devices never converged again.
//
// Delete this file and its call site once uploads either retry themselves or
// report their failure; see plans/platform-findings-2026-09-13.md.
import { syncStatusOf } from './upload-state.ts';
import { waitForOnline } from './storage-connection.ts';
import type { ContactEvent } from '../../src/types/index.ts';

/**
 * What a single look at the sync statuses says should happen.
 *
 * The two "not our business" answers are kept apart from `uploading` on
 * purpose: only the latter is a tick worth counting towards telling the user
 * that nothing is being published.
 */
export type ConvergenceVerdict =
  /** Every watched path is on the server. */
  | 'converged'
  /** The root is not verified yet, and verifying it reports its own stuck state. */
  | 'held'
  /** The server cannot be reached, which is not a failure to publish. */
  | 'unreachable'
  /** The platform has an upload in flight; let it finish. */
  | 'uploading'
  /** Something is not published and nothing is publishing it. */
  | 'resync';

export function classifyConvergence({ statuses, areUploadsHeld }: {
  statuses: (web3n.files.SyncStatus | undefined)[];
  areUploadsHeld: boolean;
}): ConvergenceVerdict {
  if (areUploadsHeld) {
    return 'held';
  }

  // Read exactly as syncUpload reads it: status() without skipServerCheck is a
  // request TO THE SERVER, so no status means the server is out of reach.
  if (statuses.some(status => !status)) {
    return 'unreachable';
  }

  if (statuses.some(status => !!status!.uploading)) {
    return 'uploading';
  }

  if (statuses.every(status => status!.state === 'synced')) {
    return 'converged';
  }

  return 'resync';
}

/** One line per path, for the log entry that accompanies a stuck report. */
function describeStatuses(
  paths: string[], statuses: (web3n.files.SyncStatus | undefined)[],
): string {
  return paths
    .map((path, i) => {
      const status = statuses[i];
      const state = status
        ? `${status.state}${status.uploading ? ', uploading' : ''}`
        : 'unknown';
      return `${path || 'root'}: ${state}`;
    })
    .join('; ');
}

/**
 * Starts watching whether local versions actually reach the server, and answers
 * with a function that stops the watch.
 *
 * The pass is what gets re-run, not the upload. After a dead upload the file is
 * left `unsynced` or `conflicting`, and syncUpload deliberately refuses a
 * conflicting or behind state without an explicit version - only the handler
 * knows which version to write. Re-running the pass is also what fixes the
 * failure at hand: the handler reads the status afresh, sees the version the
 * other device published, and writes the merge under the NEXT number instead of
 * the one the server rejected.
 */
export function startConvergenceWatchdog({
  fs, paths, areUploadsHeld, runSyncPass, emitStorageEvent, intervalMs,
  stuckAfterAttempts,
}: {
  fs: web3n.files.WritableFS;
  paths: string[];
  areUploadsHeld: () => boolean;
  runSyncPass: () => Promise<void>;
  emitStorageEvent: (event: ContactEvent) => void;
  intervalMs: number;
  stuckAfterAttempts: number;
}): () => void {
  let isStopped = false;
  let unpublishedTicks = 0;
  let isReportedStuck = false;

  async function statuses(): Promise<(web3n.files.SyncStatus | undefined)[]> {
    const res: (web3n.files.SyncStatus | undefined)[] = [];
    for (const path of paths) {
      res.push(await syncStatusOf(fs, path));
    }
    return res;
  }

  /**
   * Clears the warning only if this watchdog is the one that raised it: the GUI
   * keeps a single boolean for every source of a stuck sync, and
   * verifyRootWhenConnected uses it too.
   */
  function settle(): void {
    unpublishedTicks = 0;
    if (!isReportedStuck) {
      return;
    }
    isReportedStuck = false;
    emitStorageEvent({ event: 'sync:stuck', payload: { isStuck: false } });
  }

  async function noteUnpublished(
    seen: (web3n.files.SyncStatus | undefined)[],
  ): Promise<void> {
    unpublishedTicks += 1;
    if (isReportedStuck || (unpublishedTicks < stuckAfterAttempts)) {
      return;
    }

    isReportedStuck = true;
    await w3n.log(
      'warning',
      `Local changes are still not published after ${unpublishedTicks} attempts`
      + ` - ${describeStatuses(paths, seen)}`,
    );
    // The indicator goes first: an upload that died takes its 'upload-done'
    // with it, and that event is the only thing that ever closes a path in the
    // sync list - so the progress bar would keep running under the warning for
    // the rest of the session.
    emitStorageEvent({
      event: 'sync:clean',
      payload: { reason: 'Local changes could not be published.' },
    });
    emitStorageEvent({
      event: 'sync:stuck',
      payload: { isStuck: true, reason: 'local-version-not-published' },
    });
  }

  async function tick(): Promise<void> {
    const verdict = classifyConvergence({
      statuses: await statuses(),
      areUploadsHeld: areUploadsHeld(),
    });

    if ((verdict === 'held') || (verdict === 'unreachable')) {
      return;
    }

    if (verdict === 'converged') {
      settle();
      return;
    }

    // A pass is only worth running when nothing else is publishing: it ends
    // with the sweep of unused image files, which has no business running once
    // a minute for nothing.
    if (verdict === 'resync') {
      await runSyncPass();
    }

    const seen = await statuses();
    if (classifyConvergence({
      statuses: seen, areUploadsHeld: areUploadsHeld(),
    }) === 'converged') {
      settle();
      return;
    }

    await noteUnpublished(seen);
  }

  void (async () => {
    while (!isStopped) {
      // Both the pause and an early wake-up on the link returning. A plain
      // interval would keep firing offline, where there is nothing to publish
      // to and no failure to report.
      await waitForOnline({ timeoutMs: intervalMs });
      if (isStopped) {
        return;
      }

      // A loop that can die is worse than no loop: every failure stays inside
      // the tick.
      try {
        await tick();
      } catch (err) {
        await w3n.log('error', 'A convergence watchdog tick failed', err);
      }
    }
  })();

  return () => {
    isStopped = true;
  };
}
