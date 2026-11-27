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
// What a backup file or another device may put into the storage (audit of
// 2026-11-26).
import { describe, expect, it } from 'vitest';
import {
  groupsProblem,
  isRasterImage,
  isSafeFileId,
  MAX_GROUPS,
  MAX_NAME_LENGTH,
  recordProblem,
  restoreEntryProblem,
} from '@deno/utils/record-input-checks.ts';
import { GROUPS_FILE_NAME, IMAGES_FOLDER } from '@shared/constants';

const enc = (s: string) => new TextEncoder().encode(s);
const json = (v: unknown) => enc(JSON.stringify(v));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const SVG = enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

function aRecord(over: Record<string, unknown> = {}) {
  return { id: 'Ab3_-xYz0123456789ab', type: 'password', resource: 'example.com', username: 'me', password: 'p', ...over };
}

describe('isSafeFileId', () => {

  it('takes the ids the app mints', () => {
    expect(isSafeFileId('Ab3_-xYz0123456789ab')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['a path', 'a/b'],
    ['a parent step', '../x'],
    ['a windows path', 'a\\b'],
    ['hidden', '.x'],
    ['a control character', 'a\nb'],
    ['the groups file', GROUPS_FILE_NAME],
    ['the images folder', IMAGES_FOLDER],
    ['the platform settings', 'confs.json'],
    ['too long', 'x'.repeat(129)],
    ['not a string', 42],
  ])('refuses %s', (_, id) => {
    expect(isSafeFileId(id)).toBe(false);
  });

});

describe('recordProblem', () => {

  it('takes a record stored under its own id', () => {
    expect(recordProblem(aRecord(), 'Ab3_-xYz0123456789ab')).toBeUndefined();
    expect(recordProblem(aRecord({ type: 'card', images: ['img1'] }), 'Ab3_-xYz0123456789ab')).toBeUndefined();
  });

  // Saving such a record would write it over another file.
  it('refuses a record whose id is not its file name', () => {
    expect(recordProblem(aRecord({ id: GROUPS_FILE_NAME }), 'Ab3_-xYz0123456789ab')).toMatch(/id/);
  });

  // Deleting such a record would delete a file outside the images folder.
  it('refuses image ids with a path', () => {
    expect(recordProblem(aRecord({ type: 'card', images: ['../rec'] }), 'Ab3_-xYz0123456789ab')).toMatch(/images/);
  });

  it('refuses links to other records that are paths', () => {
    expect(recordProblem(aRecord({ reference: GROUPS_FILE_NAME }), 'Ab3_-xYz0123456789ab')).toMatch(/reference/);
    expect(recordProblem(aRecord({ source: 'images/x' }), 'Ab3_-xYz0123456789ab')).toMatch(/source/);
  });

  it('refuses unknown types and fields of the wrong type', () => {
    expect(recordProblem(aRecord({ type: 'script' }), 'Ab3_-xYz0123456789ab')).toMatch(/type/);
    expect(recordProblem(aRecord({ password: { x: 1 } }), 'Ab3_-xYz0123456789ab')).toMatch(/password/);
    expect(recordProblem(aRecord({ name: 'a\nb' }), 'Ab3_-xYz0123456789ab')).toMatch(/name/);
    expect(recordProblem(aRecord({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }), 'Ab3_-xYz0123456789ab')).toMatch(/name/);
    expect(recordProblem([], 'Ab3_-xYz0123456789ab')).toMatch(/object/);
  });

});

describe('groupsProblem', () => {

  it('takes a list of groups, empty included', () => {
    expect(groupsProblem([])).toBeUndefined();
    expect(groupsProblem([{ id: 'work', name: 'Work', description: 'x' }])).toBeUndefined();
  });

  it('refuses what is not a bounded list of groups', () => {
    expect(groupsProblem({})).toBeDefined();
    expect(groupsProblem([{ id: '', name: 'x' }])).toBeDefined();
    expect(groupsProblem([{ id: 'x', name: 5 }])).toBeDefined();
    expect(groupsProblem(Array.from({ length: MAX_GROUPS + 1 }, (_, i) => ({ id: `g${i}`, name: 'g' }))))
      .toBeDefined();
  });

});

describe('isRasterImage', () => {

  it('takes the formats the app writes', () => {
    expect(isRasterImage(PNG)).toBe(true);
    expect(isRasterImage(JPEG)).toBe(true);
    expect(isRasterImage(WEBP)).toBe(true);
  });

  it('refuses SVG and anything else', () => {
    expect(isRasterImage(SVG)).toBe(false);
    expect(isRasterImage(new Uint8Array())).toBe(false);
  });

});

describe('restoreEntryProblem', () => {

  it('takes the files the app keeps', () => {
    expect(restoreEntryProblem(GROUPS_FILE_NAME, json([]))).toBeUndefined();
    expect(restoreEntryProblem('Ab3_-xYz0123456789ab', json(aRecord()))).toBeUndefined();
    expect(restoreEntryProblem(`${IMAGES_FOLDER}/img1`, PNG)).toBeUndefined();
    expect(restoreEntryProblem('confs.json', json({}))).toBeUndefined();
  });

  it('refuses anything else', () => {
    expect(restoreEntryProblem(`${IMAGES_FOLDER}/img1`, SVG)).toMatch(/raster/);
    expect(restoreEntryProblem('other/file', json({}))).toBeDefined();
    expect(restoreEntryProblem(`${IMAGES_FOLDER}/a/b`, PNG)).toBeDefined();
    expect(restoreEntryProblem('Ab3_-xYz0123456789ab', enc('not json'))).toMatch(/json/);
    expect(restoreEntryProblem(GROUPS_FILE_NAME, json({}))).toBeDefined();
    expect(restoreEntryProblem('confs.json', json([]))).toBeDefined();
  });

});
