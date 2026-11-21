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
import type { ContactEvent } from '../../src/types/index.ts';
import {
  isUploadInFlight, needsExplicitUploadVersion, syncStatusOf,
} from './upload-state.ts';

/**
 * Paths already reported as unpublishable, so that a watchdog asking once a
 * minute does not fill the log with the same line.
 */
const reportedStuckUploads = new Set<string>();

export async function syncUpload({ fs, path, opts, emitStorageEvent, immediately }: {
  fs: web3n.files.WritableFS;
  path: string;
  opts?: web3n.files.OptionsToUploadLocal;
  emitStorageEvent: (event: ContactEvent) => void;
  immediately?: boolean;
}): Promise<{ uploadVersion: number; uploadTaskId: number } | number | undefined> {
  // Checked before the sync:start event, so that a skipped upload leaves no
  // unpaired entry in the sync indicator.
  //
  // No status at all is read as "the server cannot be reached", and that is the
  // truest answer available: status() without skipServerCheck is a request TO
  // THE SERVER, so offline it is rejected with `connect` and syncStatusOf
  // answers undefined. It beats asking the platform whether the device is
  // online, which reports a link rather than a reachable server.
  //
  // Starting an upload in that state is what must be avoided: the platform
  // parks such a task on its connectivity latch and the awaited call NEVER
  // settles - not resolved, not rejected - until the connection is back. That
  // left the sync indicator running for the whole offline period, and it hangs
  // the IPC calls that await it, addImage and deleteImage among them.
  //
  // Nothing is lost by skipping. The local version stays `unsynced`, and it is
  // uploaded by whichever comes first: the pass that watchStorageReconnection
  // starts when the link returns, the remote-change handlers once the platform
  // has its event socket back, or initialSyncProcess at the next start.
  const status = await syncStatusOf(fs, path);
  if (!status || status.uploading) {
    return undefined;
  }

  // The platform refuses an upload from a conflicting or behind state unless it
  // is told which version to write. Guessing one here would publish local state
  // over a remote divergence that was never absorbed, so the upload is left to
  // the handler whose job that is - handleDbFileSyncStatus and
  // handleImagesFolderSyncStatus, which run at startup and on remote-change.
  // Seen for real: an `images` folder in conflicting state made addImage's own
  // folder upload fail, and with it the avatar the user was saving.
  if (!opts?.uploadVersion && needsExplicitUploadVersion(status?.state)) {
    return undefined;
  }

  // A path already known to be unpublishable still gets its attempt - it costs
  // nothing and leaves room for the platform to recover - but it must not keep
  // announcing a transfer that will not happen. Without this the watchdog's
  // once-a-minute pass made the progress bar blink for the rest of the session.
  const isKnownStuck = reportedStuckUploads.has(path);

  function announce(event: 'sync:start' | 'sync:end'): void {
    if (isKnownStuck) {
      return;
    }
    emitStorageEvent({ event, payload: { path: path || 'root' } });
  }

  try {
    announce('sync:start');

    if (immediately) {
      const res = await fs.v?.sync?.upload(path, opts);
      announce('sync:end');
      reportedStuckUploads.delete(path);
      return res;
    }

    const res = await fs.v?.sync?.startUpload(path, opts);
    // It went through after all: the platform has let go of whatever was
    // blocking this path, so the next failure deserves to be reported afresh.
    reportedStuckUploads.delete(path);
    return res;
  } catch (err) {
    if ((err as web3n.ConnectException).type === 'connect') {
      announce('sync:end');
      return undefined;
    }

    // An upload of this path was started between the check above and this call.
    // Its own completion event closes the indicator, and the newest local
    // version is picked up by whoever schedules the next upload — for the
    // contacts db that is the debounced uploader, which re-arms on every save.
    // The platform's own doc for startUpload says it should report this in the
    // RETURN value rather than by throwing, so this branch stands in for a
    // contract the implementation does not keep.
    if ((err as web3n.files.FSSyncException).type === 'fs-sync'
    && (err as web3n.files.FSSyncException).alreadyUploading) {
      // ... unless nothing is actually uploading. Then this is not a race but
      // a failed upload task the platform never took out of its map: it
      // removes a task only on the success path, so after ANY failure every
      // later upload of that file is refused with alreadyUploading for the
      // life of the platform process. Nothing here can clear it - what this
      // branch can do is stop pretending an upload was scheduled, close the
      // indicator that would otherwise spin forever, and say so once.
      if (!(await isUploadInFlight(fs, path))) {
        if (!isKnownStuck) {
          reportedStuckUploads.add(path);
          await w3n.log(
            'warning',
            `The platform refuses to upload '${path || 'root'}': it reports an`
            + ` upload in flight while its own status says there is none. An`
            + ` upload of this file failed earlier, and the platform kept the`
            + ` dead task, so nothing can publish it until the app is`
            + ` restarted - see plans/platform-findings-2026-09-13.md.`,
          );
        }
        announce('sync:end');
      }
      return undefined;
    }

    if ((err as web3n.files.FSSyncException).type === 'fs-sync' && (err as web3n.files.FSSyncException).childNeverUploaded) {
      setTimeout(() => {
        syncUpload({ fs, path, opts, emitStorageEvent, immediately });
      }, 10000);
      return undefined;
    }

    emitStorageEvent({
      event: 'sync:end',
      payload: {
        path: path || 'root',
        ...(!!err && { error: (err as web3n.files.FSSyncException).message || JSON.stringify(err) }),
      },
    });

    throw err;
  }
}
