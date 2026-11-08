import { describe, expect, it } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { findSaveCollision, saveFileFlags } from '../../../src-file-picker/common/utils/folder-operations.ts';

// Regression for the picker plan, item 2: collisions were looked up in the
// shown listing only (no hidden files, case-sensitive), and the file was then
// opened without flags, so an existing file was overwritten without a question.
describe('findSaveCollision', () => {
  it('finds hidden files that the picker does not show', async () => {
    const fs = new MemoryFS('home', 'device').addFile('me/.bashrc');

    expect(await findSaveCollision(fs.asWritableFS(), 'me', '.bashrc')).toEqual({
      name: '.bashrc',
      isFolder: false,
      isLink: false,
    });
  });

  it('ignores case on a device FS', async () => {
    const fs = new MemoryFS('home', 'device').addFile('docs/report.txt');

    expect(await findSaveCollision(fs.asWritableFS(), 'docs', 'Report.txt')).toMatchObject({ name: 'report.txt' });
  });

  it('respects case on a 3N storage', async () => {
    const fs = new MemoryFS('home', 'synced').addFile('docs/report.txt');

    expect(await findSaveCollision(fs.asWritableFS(), 'docs', 'Report.txt')).toBeUndefined();
  });

  it('reports folders and links', async () => {
    const fs = new MemoryFS().addFolder('docs/sub').addLink('docs/shortcut');

    expect(await findSaveCollision(fs.asWritableFS(), 'docs', 'sub')).toMatchObject({ isFolder: true });
    expect(await findSaveCollision(fs.asWritableFS(), 'docs', 'shortcut')).toMatchObject({ isLink: true });
  });

  it('looks in the root folder', async () => {
    const fs = new MemoryFS().addFile('a.txt');

    expect(await findSaveCollision(fs.asWritableFS(), '', 'a.txt')).toMatchObject({ name: 'a.txt' });
  });

  it('finds nothing in a folder that does not exist', async () => {
    expect(await findSaveCollision(new MemoryFS().asWritableFS(), 'missing', 'a.txt')).toBeUndefined();
  });
});

describe('saveFileFlags', () => {
  it('creates a new file exclusively and overwrites only when confirmed', () => {
    expect(saveFileFlags(false)).toEqual({ create: true, exclusive: true });
    expect(saveFileFlags(true)).toEqual({ create: false, truncate: true });
  });
});
