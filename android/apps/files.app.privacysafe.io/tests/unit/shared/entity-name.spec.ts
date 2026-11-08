import { describe, expect, it } from 'vitest';
import {
  isSafeRelativePath,
  isSameOrInside,
  isValidEntityName,
  joinEntityName,
  joinEntityPath,
  pickFreeEntityName,
  splitEntityName,
} from '../../../shared/utils/fs-utils/entity-name.ts';

describe('splitEntityName', () => {
  it.each([
    ['report.pdf', false, { base: 'report', ext: 'pdf' }],
    ['archive.tar.gz', false, { base: 'archive.tar', ext: 'gz' }],
    ['Photo.JPG', false, { base: 'Photo', ext: 'JPG' }],
    ['README', false, { base: 'README', ext: '' }],
    ['.env', false, { base: '.env', ext: '' }],
    ['name.', false, { base: 'name.', ext: '' }],
    ['v1.0', true, { base: 'v1.0', ext: '' }],
  ])('%j (folder: %s)', (name, isFolder, expected) => {
    expect(splitEntityName(name, isFolder)).toEqual(expected);
  });
});

describe('joinEntityName', () => {
  it('omits the dot when there is no extension', () => {
    expect(joinEntityName('README', '')).toBe('README');
    expect(joinEntityName('report', 'pdf')).toBe('report.pdf');
  });
});

describe('joinEntityPath', () => {
  it('does not add a leading slash for the root folder', () => {
    expect(joinEntityPath('', 'a.txt')).toBe('a.txt');
    expect(joinEntityPath('docs', 'a.txt')).toBe('docs/a.txt');
  });
});

describe('pickFreeEntityName', () => {
  const takenBy =
    (...names: string[]) =>
    (candidate: string) =>
      names.includes(candidate);

  it('keeps a free name', async () => {
    expect(await pickFreeEntityName({ name: 'a.txt', isTaken: takenBy() })).toBe('a.txt');
  });

  it('adds the postfix before the extension', async () => {
    expect(await pickFreeEntityName({ name: 'a.txt', isTaken: takenBy('a.txt') })).toBe('a_copy.txt');
  });

  it('numbers further candidates', async () => {
    const isTaken = takenBy('a.txt', 'a_copy.txt', 'a_copy_2.txt');
    expect(await pickFreeEntityName({ name: 'a.txt', isTaken })).toBe('a_copy_3.txt');
  });

  it('appends the postfix to folder names that contain dots', async () => {
    expect(await pickFreeEntityName({ name: 'v1.0', isFolder: true, isTaken: takenBy('v1.0') })).toBe('v1.0_copy');
  });

  it('uses a custom postfix', async () => {
    expect(await pickFreeEntityName({ name: 'a.txt', postfix: '123', isTaken: takenBy('a.txt') })).toBe(
      'a_123.txt',
    );
  });
});

describe('isValidEntityName', () => {
  it.each(['a.txt', 'README', '.env', 'name with spaces', 'файл.pdf'])('accepts %j', name => {
    expect(isValidEntityName(name)).toBe(true);
  });

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', 'a\u0000b', undefined, 42])('rejects %j', name => {
    expect(isValidEntityName(name)).toBe(false);
  });
});

describe('isSafeRelativePath', () => {
  it.each(['', 'a', 'a/b/c.txt'])('accepts %j', path => {
    expect(isSafeRelativePath(path)).toBe(true);
  });

  it.each(['/a', 'a/', 'a//b', '../a', 'a/../b', './a', undefined])('rejects %j', path => {
    expect(isSafeRelativePath(path)).toBe(false);
  });
});

describe('isSameOrInside', () => {
  it('respects the "/" boundary', () => {
    expect(isSameOrInside('a/b', 'a')).toBe(true);
    expect(isSameOrInside('a', 'a')).toBe(true);
    expect(isSameOrInside('ab', 'a')).toBe(false);
    expect(isSameOrInside('anything', '')).toBe(true);
  });
});
