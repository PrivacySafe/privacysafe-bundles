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
// Run against an in-memory storage rather than a script of expected calls, so
// what is asserted is the state the app would actually find on disk.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { treasureFileSrv } from '@deno/treasure-file-srv.ts';
import { GROUPS_FILE_NAME, IMAGES_FOLDER, RECENT_FILE_NAME } from '@shared/constants';
import { makeFakeFS, type FakeFS } from '../helpers/fake-fs';
import { installFakeW3n } from '../helpers/fake-w3n';
import type { TreasureFileSrv } from '@deno/srv.types.ts';
import type { TreasureRecord } from '@shared/@types';

function aRecord(over: Partial<TreasureRecord> = {}): TreasureRecord {
  return {
    id: 'new',
    type: 'password',
    resource: 'example.com',
    username: 'me',
    password: 'hunter2',
    ...over,
  } as TreasureRecord;
}

describe('treasureFileSrv', () => {

  let fake: ReturnType<typeof installFakeW3n>;
  let synced: FakeFS;
  let local: FakeFS;
  let srv: TreasureFileSrv;

  beforeEach(async () => {
    fake = installFakeW3n();
    synced = makeFakeFS();
    local = makeFakeFS();
    srv = await treasureFileSrv(synced.fs, local.fs);
  });

  afterEach(() => {
    fake.uninstall();
  });

  describe('records', () => {

    // A new record has no id of its own yet, so the service mints one and that
    // id becomes the name of its file.
    it('gives a new record an id, and names its file after it', async () => {
      const fileName = await srv.saveFile(aRecord());

      expect(fileName).not.toBe('new');
      expect(fileName).toHaveLength(20);
      expect(synced.has(fileName)).toBe(true);
      expect(synced.readJSON<TreasureRecord>(fileName).id).toBe(fileName);
    });

    it('keeps the id a record already has', async () => {
      const fileName = await srv.saveFile(aRecord({ id: 'rec-1' }));

      expect(fileName).toBe('rec-1');
      expect(synced.readJSON<TreasureRecord>('rec-1').id).toBe('rec-1');
    });

    it('gives two new records ids of their own', async () => {
      const first = await srv.saveFile(aRecord());
      const second = await srv.saveFile(aRecord());

      expect(first).not.toBe(second);
    });

    it('writes under the name it is given', async () => {
      await srv.saveFile(aRecord({ id: 'rec-1' }), 'named-file');

      expect(synced.has('named-file')).toBe(true);
      expect(synced.has('rec-1')).toBe(false);
    });

    it('reads a record back as it was written', async () => {
      const fileName = await srv.saveFile(aRecord({ id: 'rec-1' }));

      const read = await srv.getFile<TreasureRecord>(fileName);

      expect(read).toMatchObject({ id: 'rec-1', resource: 'example.com', password: 'hunter2' });
    });

    it('refuses to save nothing', async () => {
      await expect(srv.saveFile(undefined as unknown as TreasureRecord))
      .rejects.toThrow(/no data/i);
    });

    it('answers null for a record that is not there', async () => {
      await expect(srv.getFile<TreasureRecord>('absent')).resolves.toBeNull();
    });

  });

  describe('groups', () => {

    it('stores a list of groups under the groups file name', async () => {
      await srv.saveFile([{ id: 'g1', name: 'Work' }], GROUPS_FILE_NAME);

      expect(synced.readJSON(GROUPS_FILE_NAME)).toEqual([{ id: 'g1', name: 'Work' }]);
    });

    // The groups file is read on startup, and an app with no groups yet must
    // not be an error case.
    it('answers an empty list when there is no groups file yet', async () => {
      await expect(srv.getFile(GROUPS_FILE_NAME)).resolves.toEqual([]);
    });

    it('rewrites the groups file through updateFile', async () => {
      await srv.saveFile([{ id: 'g1', name: 'Work' }], GROUPS_FILE_NAME);

      await srv.updateFile([{ id: 'g2', name: 'Home' }], GROUPS_FILE_NAME);

      expect(synced.readJSON(GROUPS_FILE_NAME)).toEqual([{ id: 'g2', name: 'Home' }]);
    });

    // A list of groups has no id of its own and always lives in one file, so
    // the name can be left out for it.
    it('falls back to the groups file name for a list with no name given', async () => {
      await srv.updateFile([{ id: 'g1', name: 'Work' }]);

      expect(synced.readJSON(GROUPS_FILE_NAME)).toEqual([{ id: 'g1', name: 'Work' }]);
    });

    // A record, on the other hand, is addressed by its id; with neither that
    // nor a name there is nothing to write to.
    it('refuses a record with neither an id nor a file name', async () => {
      await expect(srv.updateFile({ resource: 'example.com' } as never))
      .rejects.toThrow(/filename argument is missing/);
    });

    it('writes a record under its own id when given no name', async () => {
      await srv.updateFile(aRecord({ id: 'rec-1' }));

      expect(synced.has('rec-1')).toBe(true);
    });

  });

  describe('images', () => {

    it('stores an image inside the images folder', async () => {
      const id = await srv.saveImage({ bytes: new Uint8Array([1, 2, 3]) });

      expect(synced.has(`${IMAGES_FOLDER}/${id}`)).toBe(true);
    });

    it('reads an image back byte for byte', async () => {
      const id = await srv.saveImage({ bytes: new Uint8Array([1, 2, 3, 250]) });

      const read = await srv.loadImage(id);

      expect(Array.from(read!)).toEqual([1, 2, 3, 250]);
    });

    it('overwrites the image of a given id', async () => {
      const id = await srv.saveImage({ bytes: new Uint8Array([1]) });

      await srv.saveImage({ bytes: new Uint8Array([2]), id });

      expect(Array.from((await srv.loadImage(id))!)).toEqual([2]);
      expect([...synced.files.keys()].filter(p => p.startsWith(IMAGES_FOLDER))).toHaveLength(1);
    });

  });

  describe('recent records', () => {

    // Recent lives in local storage: it is per-device, and is not synced.
    it('keeps the recent list out of the synced storage', async () => {
      await srv.saveRecentFile(['rec-1', 'rec-2']);

      expect(local.readJSON(RECENT_FILE_NAME)).toEqual(['rec-1', 'rec-2']);
      expect(synced.has(RECENT_FILE_NAME)).toBe(false);
    });

    it('reads the recent list back', async () => {
      await srv.saveRecentFile(['rec-1']);

      await expect(srv.loadRecentFile()).resolves.toEqual(['rec-1']);
    });

  });

  describe('deleting', () => {

    it('removes a file', async () => {
      await srv.saveFile(aRecord({ id: 'rec-1' }));

      await srv.deleteFile('rec-1');

      expect(synced.has('rec-1')).toBe(false);
    });

    // Deleting what is not there is how a restore tidies up, so it must not
    // raise.
    it('says nothing about a file that is not there', async () => {
      await expect(srv.deleteFile('absent')).resolves.toBeUndefined();
    });

    it('removes several files, and tolerates absent ones among them', async () => {
      await srv.saveFile(aRecord({ id: 'rec-1' }));
      await srv.saveFile(aRecord({ id: 'rec-2' }));

      await srv.deleteFiles(['rec-1', 'absent', 'rec-2']);

      expect(synced.has('rec-1')).toBe(false);
      expect(synced.has('rec-2')).toBe(false);
    });

  });

  // Writes go through one SingleProc, so concurrent saves cannot interleave and
  // leave a half-written file behind.
  it('serialises concurrent writes', async () => {
    const saves = Array.from({ length: 10 }, (_, i) =>
      srv.saveFile(aRecord({ id: `rec-${i}` })),
    );

    await Promise.all(saves);

    for (let i = 0; i < 10; i += 1) {
      expect(synced.readJSON<TreasureRecord>(`rec-${i}`).id).toBe(`rec-${i}`);
    }
  });

});
