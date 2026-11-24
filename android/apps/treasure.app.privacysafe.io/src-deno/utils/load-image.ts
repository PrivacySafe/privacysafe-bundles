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
import { IMAGES_FOLDER } from '../../shared/constants.ts';
import { sleep } from '../../shared/processes/sleep.ts';
import type { ImageLoadResult, TreasureEvent } from '../../shared/@types/common.types.ts';
import type { ServerReachability } from '../srv.types.ts';

function isNotFound(err: unknown): boolean {
  return !!(err as web3n.files.FileException)?.notFound;
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

interface FetchOutcome {
  note: string;
  settled: boolean;
}

export interface ImageLoaderTimings {
  /** How often the on-disk state of a downloading image is checked. */
  pollMs: number;
  /** How long a download is waited for before the image is reported pending. */
  downloadTimeoutMs: number;
}

const DEFAULT_TIMINGS: ImageLoaderTimings = { pollMs: 300, downloadTimeoutMs: 30000 };

/**
 * Loads a stored image, fetching what it needs from the server when the image
 * cannot be read locally yet.
 *
 * When the image is listed in the images folder but its bytes are not on
 * this device, the download of its version is started here and waited for:
 * the startup sync pass gets to each file only after walking every file of the
 * app. A second download of the same version is safe, the platform hands back
 * the one already running.
 *
 * Nothing is ever adopted here, neither the file nor the folder. The startup
 * sync pass and the remote-change handler adopt them, and the platform has no
 * guard against two adoptions, downloads and writes running over one object
 * at once: that can silently spoil a version (P19 / N18 in
 * ../platform-issues/platform-issues-2026-11-23.md). An image that needs an
 * adoption is reported pending instead, and the window tries it again once
 * that synchronization ends.
 *
 * An image is reported missing only when there is no doubt about it: an up to
 * date folder of an answering server does not list it, or the server refused
 * its bytes. Otherwise it is pending.
 */
export function makeImageLoader({
  fs,
  readImage,
  emitEvent,
  getServerReachability,
  timings = DEFAULT_TIMINGS,
}: {
  fs: web3n.files.WritableFS;
  readImage: (imageId: string) => Promise<Uint8Array | undefined>;
  emitEvent: (event: TreasureEvent) => void;
  getServerReachability: () => ServerReachability;
  timings?: ImageLoaderTimings;
}): (imageId: string) => Promise<ImageLoadResult> {
  // A card shows several images at once, and the same image is often asked for
  // by the table and the card together.
  const fileFetches = new Map<string, Promise<FetchOutcome>>();

  async function statusOf(path: string): Promise<{ status?: web3n.files.SyncStatus; notListed: boolean }> {
    try {
      return { status: await fs.v?.sync?.status(path), notListed: false };
    } catch (err) {
      return { notListed: isNotFound(err) };
    }
  }

  async function waitUntilOnDisk(path: string, version: number): Promise<boolean> {
    const deadline = Date.now() + timings.downloadTimeoutMs;
    while (Date.now() < deadline) {
      if ((await fs.v?.sync?.isRemoteVersionOnDisk(path, version)) === 'complete') {
        return true;
      }
      await sleep(timings.pollMs);
    }
    return false;
  }

  /**
   * Gets the bytes of a listed image onto the disk, and says what it found and
   * did, for the log. `settled` tells that a read failing after this is no
   * longer worth waiting on: the bytes are on the disk, or the server refused
   * them. A download not done in time, or not possible for want of a
   * connection, is not settled.
   */
  async function fetchFile(path: string, status: web3n.files.SyncStatus): Promise<FetchOutcome> {
    try {
      if (status.state === 'behind' || status.state === 'conflicting') {
        return { note: `left to the sync pass to adopt (${status.state})`, settled: false };
      }
      const version = status.synced?.latest ?? status.local?.latest;
      if (!version) {
        return { note: `no version to fetch (${status.state})`, settled: false };
      }

      const onDisk = await fs.v?.sync?.isRemoteVersionOnDisk(path, version);
      if (onDisk === 'complete') {
        return { note: `v${version} already on disk`, settled: true };
      }

      emitEvent({ event: 'sync:start', payload: { path, type: 'download' } });
      try {
        await fs.v?.sync?.startDownload(path, version);
        const done = await waitUntilOnDisk(path, version);
        return done
          ? { note: `v${version} downloaded (was ${onDisk})`, settled: true }
          : { note: `v${version} download not done in time (was ${onDisk})`, settled: false };
      } finally {
        emitEvent({ event: 'sync:end', payload: { path, type: 'download' } });
      }
    } catch (err) {
      const isConnect = (err as web3n.ConnectException)?.type === 'connect';
      return { note: `fetch failed: ${describe(err)}`, settled: !isConnect };
    }
  }

  function fetchFileOnce(path: string, status: web3n.files.SyncStatus): Promise<FetchOutcome> {
    let fetching = fileFetches.get(path);
    if (!fetching) {
      fetching = fetchFile(path, status).finally(() => fileFetches.delete(path));
      fileFetches.set(path, fetching);
    }
    return fetching;
  }

  async function read(imageId: string): Promise<ImageLoadResult | undefined> {
    try {
      const bytes = await readImage(imageId);
      return bytes ? { state: 'loaded', bytes } : { state: 'missing' };
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
      return undefined;
    }
  }

  return async imageId => {
    const first = await read(imageId);
    if (first) {
      return first;
    }

    const path = `${IMAGES_FOLDER}/${imageId}`;
    const file = await statusOf(path);
    let fetched: FetchOutcome | undefined;
    if (file.status) {
      fetched = await fetchFileOnce(path, file.status);
    }
    const done = fetched ? fetched.note : 'not listed in the images folder';

    const second = await read(imageId);
    if (second) {
      return second;
    }

    const fileAfter = await statusOf(path);
    const { status: folder } = await statusOf(IMAGES_FOLDER);
    const serverReachability = getServerReachability();
    const isServerUp = serverReachability === 'up';
    const isUnlisted = fileAfter.notListed && !!folder
      && (folder.state !== 'behind') && (folder.state !== 'conflicting');
    const isMissing = isServerUp && (isUnlisted || !!fetched?.settled);
    w3n.log(
      'warning',
      `Image ${imageId} could not be read; reported as ${isMissing ? 'missing' : 'pending'}. `
        + `Done: ${done}. File: ${fileAfter.status ? JSON.stringify(fileAfter.status) : (fileAfter.notListed ? 'not listed' : 'no status')}. `
        + `Folder: ${folder ? JSON.stringify(folder) : 'no status'}. Server: ${serverReachability}.`,
    );
    return isMissing ? { state: 'missing' } : { state: 'pending' };
  };
}
