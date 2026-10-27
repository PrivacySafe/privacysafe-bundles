import { describe, expect, it } from 'vitest';
import { isValidFileName } from '../../../src-file-picker/common/utils/validate-filename.ts';

describe('isValidFileName', () => {
  it.each(['', '  ', '.', '..', 'a/b', 'a\\b', 'a\u0001b', 'x'.repeat(256)])('rejects %j in any storage', name => {
    expect(isValidFileName(name, { strict: false })).toBe(false);
    expect(isValidFileName(name, { strict: true })).toBe(false);
  });

  // Regression for the picker plan, item 7: names valid in 3N storages (and
  // created by the Storage app) could not be picked to be overwritten.
  it.each(['what?.txt', 'a:b.txt', 'CON', 'nul.txt', 'x'.repeat(255)])('accepts %j in a 3N storage', name => {
    expect(isValidFileName(name, { strict: false })).toBe(true);
  });

  it.each(['what?.txt', 'a:b.txt', 'a<b', 'CON', 'nul.txt'])('rejects %j on a device (OS) storage', name => {
    expect(isValidFileName(name, { strict: true })).toBe(false);
  });

  it('is strict by default', () => {
    expect(isValidFileName('what?.txt')).toBe(false);
    expect(isValidFileName('report.txt')).toBe(true);
  });
});
