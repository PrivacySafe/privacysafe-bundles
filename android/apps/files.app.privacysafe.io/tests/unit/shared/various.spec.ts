import { describe, expect, it } from 'vitest';
import {
  formatPath,
  getFileExtension,
  getParentFolderPathFromEntityFullPath,
} from '../../../shared/utils/various.ts';
import { getEntityNameAndParent } from '../../../shared/utils/fs-utils/get-entity-name-and-parent.ts';

describe('formatPath', () => {
  it.each([
    ['', ''],
    ['.', ''],
    ['./', ''],
    ['/', ''],
    ['./docs/a.txt', 'docs/a.txt'],
    ['/docs/a.txt', 'docs/a.txt'],
    ['docs/a.txt', 'docs/a.txt'],
  ])('formatPath(%j) -> %j', (input, expected) => {
    expect(formatPath(input)).toBe(expected);
  });
});

describe('getParentFolderPathFromEntityFullPath', () => {
  it.each([
    ['a.txt', ''],
    ['docs/a.txt', 'docs'],
    ['docs/sub/a.txt', 'docs/sub'],
  ])('%j -> %j', (input, expected) => {
    expect(getParentFolderPathFromEntityFullPath(input)).toBe(expected);
  });
});

describe('getEntityNameAndParent', () => {
  it('splits a nested path', () => {
    expect(getEntityNameAndParent('docs/sub/a.txt')).toEqual({ parentFolder: 'docs/sub', entityName: 'a.txt' });
  });

  it('returns an empty parent for a root-level entity', () => {
    expect(getEntityNameAndParent('a.txt')).toEqual({ parentFolder: '', entityName: 'a.txt' });
  });
});

describe('getFileExtension', () => {
  it('returns the part after the last dot', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns an empty string for a name without a dot', () => {
    expect(getFileExtension('Photos')).toBe('');
  });

  it('lowercases the extension (used for file type detection)', () => {
    expect(getFileExtension('Photo.JPG')).toBe('jpg');
  });
});
