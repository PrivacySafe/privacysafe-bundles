import { describe, expect, it } from 'vitest';
import { parseDefaultSaveLocation } from '../../../src-file-picker/common/utils/default-save-location.ts';
import { normalizeFilters, normalizeText } from '../../../src-file-picker/common/utils/request-params.ts';
import { filterPickerFilesByType } from '../../../src-file-picker/common/utils/filter-file-types.ts';

describe('parseDefaultSaveLocation', () => {
  it.each([
    ['report.pdf', { folderPath: '', fileName: 'report.pdf' }],
    ['docs/report.pdf', { folderPath: 'docs', fileName: 'report.pdf' }],
    ['/docs/report.pdf', { folderPath: 'docs', fileName: 'report.pdf' }],
    ['docs\\sub\\report.pdf', { folderPath: 'docs/sub', fileName: 'report.pdf' }],
    ['docs/', { folderPath: 'docs', fileName: '' }],
    ['', { folderPath: '', fileName: '' }],
    ['/', { folderPath: '', fileName: '' }],
  ])('%j', (input, expected) => {
    expect(parseDefaultSaveLocation(input)).toEqual(expected);
  });

  // Regression for the picker plan, item 3: OS paths were turned into folders of
  // the synced storage, and the folders were then created by the first write.
  it.each([
    ['C:\\Users\\me\\a.txt', 'a.txt'],
    ['~/Documents/a.txt', 'a.txt'],
    ['\\\\server\\share\\a.txt', 'a.txt'],
  ])('keeps only the file name of the OS path %j', (input, fileName) => {
    expect(parseDefaultSaveLocation(input)).toEqual({ folderPath: '', fileName });
  });

  it.each(['../a.txt', 'docs/../a.txt', '.trash-folder-user/a.txt', 'docs/.hidden/a.txt'])(
    'does not go through %j',
    input => {
      expect(parseDefaultSaveLocation(input)).toEqual({ folderPath: '', fileName: 'a.txt' });
    },
  );

  it('rejects "." and ".." as a file name', () => {
    expect(parseDefaultSaveLocation('docs/..')).toEqual({ folderPath: '', fileName: '' });
  });
});

// Regression for the picker plan, item 4: a malformed filter from the calling
// app threw in a computed value, the listing was not rendered and the request hung.
describe('normalizeFilters', () => {
  it('keeps well-formed filters', () => {
    const filters = [{ name: 'Images', extensions: ['png', 'jpg'] }];
    expect(normalizeFilters(filters)).toEqual(filters);
  });

  it('drops malformed filters and non-string extensions', () => {
    expect(
      normalizeFilters([
        { name: 'no extensions' },
        { name: 'bad', extensions: 'png' },
        null,
        { name: 'mixed', extensions: ['pdf', 42, '', ' '] },
      ]),
    ).toEqual([{ name: 'mixed', extensions: ['pdf'] }]);
  });

  it('returns undefined for nothing usable', () => {
    expect(normalizeFilters(undefined)).toBeUndefined();
    expect(normalizeFilters('png')).toBeUndefined();
    expect(normalizeFilters([{ name: 'x' }])).toBeUndefined();
  });

  it('produces filters the listing filter accepts', () => {
    const files = [
      { id: 'a.png', name: 'a.png', isFolder: false },
      { id: 'b.txt', name: 'b.txt', isFolder: false },
    ];
    const filters = normalizeFilters([{ name: 'x' }, { name: 'img', extensions: ['png'] }]);
    expect(() => filterPickerFilesByType(files as never, filters)).not.toThrow();
  });
});

describe('normalizeText', () => {
  it('turns non-strings into an empty string', () => {
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText({ toString: () => 'x' })).toBe('');
    expect(normalizeText('Save')).toBe('Save');
  });
});
