import { describe, expect, it } from 'vitest';
import { parseDefaultSaveLocation } from '../../../src-file-picker/common/utils/default-save-location.ts';
import {
  MAX_BUTTON_LABEL_LENGTH,
  MAX_DEFAULT_PATH_LENGTH,
  MAX_EXTENSION_LENGTH,
  MAX_FILTER_EXTENSIONS,
  MAX_FILTERS,
  MAX_TITLE_LENGTH,
  normalizeFilters,
  normalizeOptionalText,
  normalizeText,
} from '../../../src-file-picker/common/utils/request-params.ts';
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

// Security audit 2026-11: the texts of the calling app had no limits. A title of many lines
// covered the dialog, and bidi overrides disguised names.
describe('caller texts: limits', () => {
  it('makes a title one line of limited length', () => {
    const title = normalizeText(`Line 1\nLine 2\r\n${'x'.repeat(500)}`);

    expect(title).not.toMatch(/[\r\n]/);
    expect(title.length).toBe(MAX_TITLE_LENGTH);
    expect(title.startsWith('Line 1 Line 2 x')).toBe(true);
  });

  it('limits a button label', () => {
    expect(normalizeText('O'.repeat(100), MAX_BUTTON_LABEL_LENGTH)).toHaveLength(MAX_BUTTON_LABEL_LENGTH);
  });

  it('removes direction overrides and zero-width characters', () => {
    expect(normalizeText('Open\u202Efdp.exe\u200b')).toBe('Open fdp.exe');
  });

  it('drops a default path that is too long or has hidden characters', () => {
    expect(normalizeOptionalText('a'.repeat(MAX_DEFAULT_PATH_LENGTH + 1))).toBeUndefined();
    expect(normalizeOptionalText('invoice\u202Efdp.exe')).toBeUndefined();
    expect(normalizeOptionalText('docs/a.txt')).toBe('docs/a.txt');
  });

  it('limits filters and their extensions', () => {
    const many = Array.from({ length: MAX_FILTERS + 10 }, (_, i) => ({ name: `f${i}`, extensions: ['txt'] }));
    expect(normalizeFilters(many)).toHaveLength(MAX_FILTERS);

    const [filter] = normalizeFilters([
      {
        name: 'x',
        extensions: [
          ...Array.from({ length: MAX_FILTER_EXTENSIONS + 5 }, (_, i) => `e${i}`),
        ],
      },
    ])!;
    expect(filter.extensions).toHaveLength(MAX_FILTER_EXTENSIONS);

    expect(normalizeFilters([{ name: 'x', extensions: ['e'.repeat(MAX_EXTENSION_LENGTH + 1), 'pdf'] }])).toEqual([
      { name: 'x', extensions: ['pdf'] },
    ]);
  });

  it('does not propose a hidden name for saving', () => {
    expect(parseDefaultSaveLocation('.trash-folder-user')).toEqual({ folderPath: '', fileName: '' });
    expect(parseDefaultSaveLocation('docs/.env')).toEqual({ folderPath: '', fileName: '' });
  });
});
