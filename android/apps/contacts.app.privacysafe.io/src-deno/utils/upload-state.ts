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
 * Reports whether the platform already has an upload in flight for this path.
 *
 * Two operations must not be issued against a path that is uploading:
 *
 *  - starting a second upload, which is rejected with fs-sync/alreadyUploading;
 *  - deleting the file, which makes the core reject its own background
 *    `removeCurrentVersion` with file/concurrentUpdate — a rejection that
 *    surfaces as unhandled, because our own deleteFile call has already
 *    resolved by then.
 *
 * This is an optimisation, NOT a guarantee: an upload can begin between the
 * check and the call, so callers still have to cope with the failure.
 */
export async function isUploadInFlight(
  fs: web3n.files.WritableFS, path: string,
): Promise<boolean> {
  return !!(await syncStatusOf(fs, path))?.uploading;
}

/**
 * Sync status, or undefined when the platform cannot report it.
 *
 * What that undefined MEANS is for the caller to decide, and the two callers
 * here decide differently. status() without skipServerCheck talks to the
 * server, so its failure usually means the server is out of reach: syncUpload
 * takes that as a reason not to start an upload at all, while isUploadInFlight
 * takes it as "no upload is known to be running" and lets the deletion through.
 */
export async function syncStatusOf(
  fs: web3n.files.WritableFS, path: string,
): Promise<web3n.files.SyncStatus | undefined> {
  try {
    return await fs.v?.sync?.status(path);
  } catch {
    return undefined;
  }
}

/**
 * States from which the platform refuses an upload unless an explicit version is
 * given: "Upload in conflicting and behind state of sync requires explicit
 * upload version."
 */
export function needsExplicitUploadVersion(
  state: web3n.files.SyncState | undefined,
): boolean {
  return ((state === 'conflicting') || (state === 'behind'));
}
