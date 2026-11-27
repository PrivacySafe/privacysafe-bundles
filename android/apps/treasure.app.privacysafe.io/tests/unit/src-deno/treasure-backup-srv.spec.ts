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
// A restore from a crafted archive (audit of 2026-11-26): what the archive
// holds goes into the synced storage, so only files of the app's own shape may.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { treasureBackupSrv } from '@deno/treasure-backup-srv.ts';
import { treasureFileSrv } from '@deno/treasure-file-srv.ts';
import { GROUPS_FILE_NAME, IMAGES_FOLDER } from '@shared/constants';
import { makeFakeFS, type FakeFS } from '../helpers/fake-fs';
import { installFakeW3n } from '../helpers/fake-w3n';

const enc = (s: string) => new TextEncoder().encode(s);
const json = (v: unknown) => enc(JSON.stringify(v));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG = enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

const REC = 'Ab3_-xYz0123456789ab';
const OTHER = 'Zz9_-xYz0123456789ab';

function aRecord(id: string, over: Record<string, unknown> = {}) {
  return { id, type: 'card', resource: 'r', images: [], ...over };
}

describe('treasureBackupSrv.restoreBackupArchive', () => {

  let fake: ReturnType<typeof installFakeW3n>;
  let synced: FakeFS;
  let restore: (bytes: Uint8Array) => Promise<boolean>;

  beforeEach(async () => {
    fake = installFakeW3n();
    synced = makeFakeFS({
      [GROUPS_FILE_NAME]: [{ id: 'mine', name: 'Mine' }],
      [OTHER]: aRecord(OTHER),
      [`${IMAGES_FOLDER}/kept`]: PNG,
    });
    const local = makeFakeFS();
    const fileSrv = await treasureFileSrv(synced.fs, local.fs);
    const srv = await treasureBackupSrv({ fs: synced.fs, fsLocal: local.fs, fileSrv, emitEvent: () => undefined });
    restore = srv.restoreBackupArchive;
  });

  afterEach(() => {
    fake.uninstall();
  });

  it('writes the files of the app\'s own shape', async () => {
    await restore(zipSync({
      [GROUPS_FILE_NAME]: json([]),
      [REC]: json(aRecord(REC, { images: ['img1'] })),
      [`${IMAGES_FOLDER}/img1`]: PNG,
    }));

    expect(synced.readJSON(GROUPS_FILE_NAME)).toEqual([]);
    expect(synced.has(REC)).toBe(true);
    expect(synced.has(`${IMAGES_FOLDER}/img1`)).toBe(true);
    // A restore replaces: what the archive does not hold is gone.
    expect(synced.has(OTHER)).toBe(false);
  }, 20000);

  it('skips what is not, and keeps the file at its path', async () => {
    await restore(zipSync({
      [REC]: json(aRecord(REC)),
      // Not json of a list of groups.
      [GROUPS_FILE_NAME]: enc('<img src=x onerror=alert(1)>'),
      // A record claiming to be another file.
      [OTHER]: json(aRecord(GROUPS_FILE_NAME)),
      // A document that can carry script, in place of an image.
      [`${IMAGES_FOLDER}/kept`]: SVG,
      // Somewhere the app keeps nothing.
      'elsewhere/file': json({}),
    }));

    expect(synced.readJSON(GROUPS_FILE_NAME)).toEqual([{ id: 'mine', name: 'Mine' }]);
    expect(synced.readJSON<{ id: string }>(OTHER).id).toBe(OTHER);
    expect(synced.files.get(`${IMAGES_FOLDER}/kept`)).toEqual(PNG);
    expect(synced.has('elsewhere/file')).toBe(false);
    expect(synced.has(REC)).toBe(true);
  }, 20000);

  // Otherwise a restore of such an archive would only delete what the user has.
  it('refuses an archive with nothing usable, and deletes nothing', async () => {
    await expect(restore(zipSync({ 'elsewhere/file': json({}) }))).rejects.toThrow(/nothing/);

    expect(synced.has(OTHER)).toBe(true);
    expect(synced.has(`${IMAGES_FOLDER}/kept`)).toBe(true);
  });

});
