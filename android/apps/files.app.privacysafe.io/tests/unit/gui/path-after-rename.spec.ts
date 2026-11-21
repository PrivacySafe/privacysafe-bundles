import { describe, expect, it } from 'vitest';
import { getWindowPathAfterRename } from '../../../src/utils/path-after-rename.ts';

// UI fixes, У1: a window showing a renamed folder stayed on the old path, and an upload
// into it created a new folder with the old name.
describe('getWindowPathAfterRename', () => {
  it('follows the renamed folder that the window shows', () => {
    expect(getWindowPathAfterRename({ windowPath: 'Docs2', parentPath: '', oldName: 'Docs2', newName: 'Docs' })).toBe(
      'Docs',
    );
  });

  it('follows a renamed ancestor of the shown folder', () => {
    expect(
      getWindowPathAfterRename({ windowPath: 'Docs2/a/b', parentPath: '', oldName: 'Docs2', newName: 'Docs' }),
    ).toBe('Docs/a/b');
    expect(
      getWindowPathAfterRename({ windowPath: 'x/Docs2/a', parentPath: 'x', oldName: 'Docs2', newName: 'Docs' }),
    ).toBe('x/Docs/a');
  });

  it('does not touch a folder with a similar name prefix', () => {
    expect(
      getWindowPathAfterRename({ windowPath: 'Docs22', parentPath: '', oldName: 'Docs2', newName: 'Docs' }),
    ).toBeNull();
  });

  it('does not touch a window in another branch of the tree', () => {
    expect(
      getWindowPathAfterRename({ windowPath: 'y/Docs2', parentPath: 'x', oldName: 'Docs2', newName: 'Docs' }),
    ).toBeNull();
    expect(getWindowPathAfterRename({ windowPath: '', parentPath: '', oldName: 'Docs2', newName: 'Docs' })).toBeNull();
  });

  it('keeps the path relative to the base path of the trash', () => {
    expect(
      getWindowPathAfterRename({
        windowPath: 'Docs2/a',
        basePath: '.trash',
        parentPath: '.trash',
        oldName: 'Docs2',
        newName: 'Docs',
      }),
    ).toBe('Docs/a');
  });

  it('ignores a rename outside of the base path', () => {
    expect(
      getWindowPathAfterRename({
        windowPath: 'Docs2',
        basePath: '.trash',
        parentPath: '',
        oldName: 'Docs2',
        newName: 'Docs',
      }),
    ).toBeNull();
  });

  it('accepts paths with leading slashes and dots', () => {
    expect(
      getWindowPathAfterRename({ windowPath: '/Docs2/a', parentPath: './', oldName: 'Docs2', newName: 'Docs' }),
    ).toBe('Docs/a');
  });
});
