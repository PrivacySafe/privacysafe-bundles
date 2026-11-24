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
import { makeImageLoader } from '@deno/utils/load-image.ts';
import type { ServerReachability } from '@deno/srv.types.ts';
import { installFakeW3n } from '../../helpers/fake-w3n.ts';

const notFound = { runtimeException: true, type: 'file', code: 'ENOENT', notFound: true };
const timings = { pollMs: 1, downloadTimeoutMs: 50 };

interface FakeOpts {
  /** Sync status of the images folder. */
  folder?: string;
  /** Sync status of the image file; absent means the folder does not list it. */
  file?: string;
  /** What isRemoteVersionOnDisk answers before a download is started. */
  onDisk?: 'none' | 'partial' | 'complete';
  /** Whether a started download completes. */
  downloadCompletes?: boolean;
  startDownload?: () => Promise<unknown>;
  adoptRemote?: () => Promise<void>;
}

function makeFs(opts: FakeOpts = {}) {
  let downloaded = false;
  const startDownload = vi.fn(opts.startDownload ?? (async () => {
    downloaded = opts.downloadCompletes ?? true;
    return { downloadTaskId: 1 };
  }));
  const adoptRemote = vi.fn(opts.adoptRemote ?? (async () => undefined));
  const status = vi.fn(async (path: string) => {
    if (path === 'images') {
      return { state: opts.folder ?? 'synced', synced: { latest: 3 }, remote: { latest: 4 } };
    }
    if (!opts.file) {
      throw notFound;
    }
    return { state: opts.file, synced: { latest: 2 }, remote: { latest: 5 } };
  });
  const isRemoteVersionOnDisk = vi.fn(async () => (downloaded ? 'complete' : (opts.onDisk ?? 'none')));
  const fs = {
    v: { sync: { status, adoptRemote, startDownload, isRemoteVersionOnDisk } },
  } as unknown as web3n.files.WritableFS;
  return { fs, status, adoptRemote, startDownload, isDownloaded: () => downloaded };
}

/** An image read that fails until `readable()` says otherwise. */
function readerUntil(readable: () => boolean) {
  return vi.fn(async (id: string) => {
    if (!readable()) {
      throw notFound;
    }
    return new Uint8Array([id.length]);
  });
}

function loaderOf(
  fs: web3n.files.WritableFS,
  readImage: (id: string) => Promise<Uint8Array | undefined>,
  server: ServerReachability = 'up',
) {
  return makeImageLoader({
    fs, readImage, emitEvent: () => undefined, getServerReachability: () => server, timings,
  });
}

let w3n: ReturnType<typeof installFakeW3n>;

beforeEach(() => {
  w3n = installFakeW3n();
});

afterEach(() => {
  w3n.uninstall();
});

describe('makeImageLoader', () => {
  it('reads an image that is there, without asking about sync', async () => {
    const { fs, status } = makeFs();
    const load = loaderOf(fs, async () => new Uint8Array([1]));

    expect(await load('img')).toEqual({ state: 'loaded', bytes: new Uint8Array([1]) });
    expect(status).not.toHaveBeenCalled();
  });

  // The case seen early in a session: listed, but its bytes not downloaded.
  it('downloads the bytes of a listed image that are not on the disk, then reads it', async () => {
    const { fs, startDownload, isDownloaded } = makeFs({ file: 'synced', onDisk: 'none' });
    const load = loaderOf(fs, readerUntil(isDownloaded));

    expect(await load('img')).toEqual({ state: 'loaded', bytes: new Uint8Array([3]) });
    expect(startDownload).toHaveBeenCalledWith('images/img', 2);
  });

  it('downloads an image only once when it is asked for several times at once', async () => {
    const { fs, startDownload, isDownloaded } = makeFs({ file: 'synced', onDisk: 'none' });
    const load = loaderOf(fs, readerUntil(isDownloaded));

    const res = await Promise.all([load('img'), load('img')]);

    expect(res.map(r => r.state)).toEqual(['loaded', 'loaded']);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  // Adoption is left to the sync pass: the platform has no guard against two
  // adoptions over one object at once (P19 / N18).
  it('leaves a file that is behind to the sync pass, as pending', async () => {
    const { fs, adoptRemote, startDownload } = makeFs({ file: 'behind', onDisk: 'none' });
    const load = loaderOf(fs, () => Promise.reject(notFound));

    expect(await load('img')).toEqual({ state: 'pending' });
    expect(adoptRemote).not.toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
  });

  it('reports pending when the download is not done in time', async () => {
    const { fs } = makeFs({ file: 'synced', onDisk: 'none', downloadCompletes: false });
    const load = loaderOf(fs, () => Promise.reject(notFound));

    expect(await load('img')).toEqual({ state: 'pending' });
  });

  it('reports pending when the download cannot reach the server', async () => {
    const { fs } = makeFs({
      file: 'synced',
      startDownload: async () => {
        throw { runtimeException: true, type: 'connect' };
      },
    });
    const load = loaderOf(fs, () => Promise.reject(notFound));

    expect(await load('img')).toEqual({ state: 'pending' });
  });

  it('reports missing when the server refuses the download', async () => {
    const { fs } = makeFs({
      file: 'synced',
      startDownload: async () => {
        throw { runtimeException: true, type: 'file', notFound: true };
      },
    });
    const load = loaderOf(fs, () => Promise.reject(notFound));

    expect(await load('img')).toEqual({ state: 'missing' });
  });

  it('reports pending an image the folder does not list while the folder is behind', async () => {
    const { fs, adoptRemote } = makeFs({ folder: 'behind' });
    const load = loaderOf(fs, () => Promise.reject(notFound));

    expect(await load('img')).toEqual({ state: 'pending' });
    expect(adoptRemote).not.toHaveBeenCalled();
  });

  it('reports missing an image an up to date folder does not list', async () => {
    const { fs } = makeFs({ folder: 'synced' });
    const load = loaderOf(fs, () => Promise.reject(notFound));

    expect(await load('img')).toEqual({ state: 'missing' });
  });

  it('reports pending while the server has not answered', async () => {
    const { fs } = makeFs({ folder: 'synced' });
    const load = loaderOf(fs, () => Promise.reject(notFound), 'unknown');

    expect(await load('img')).toEqual({ state: 'pending' });
  });

  it('reports pending while the folder is in conflict', async () => {
    const { fs } = makeFs({ folder: 'conflicting' });
    const load = loaderOf(fs, () => Promise.reject(notFound));

    expect(await load('img')).toEqual({ state: 'pending' });
  });

  it('passes on any failure other than a missing file', async () => {
    const { fs } = makeFs();
    const load = loaderOf(fs, () => Promise.reject(new Error('disk')));

    await expect(load('img')).rejects.toThrow('disk');
  });
});
