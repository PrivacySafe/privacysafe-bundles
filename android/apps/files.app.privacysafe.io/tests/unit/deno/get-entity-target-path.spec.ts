import { describe, expect, it } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { getEntityTargetPath } from '../../../src_deno/services/fs-service.utils/get-entity-target-path.ts';

describe('getEntityTargetPath', () => {
  it('keeps the name when the target folder has no same-name entity', async () => {
    const fs = new MemoryFS().addFile('a.txt').addFolder('target');

    const path = await getEntityTargetPath({
      fs: fs.asWritableFS(),
      entity: fs.entry('a.txt'),
      targetFolder: 'target',
    });

    expect(path).toBe('target/a.txt');
  });

  it('adds the postfix before the extension on collision', async () => {
    const fs = new MemoryFS().addFile('a.txt').addFile('target/a.txt');

    const path = await getEntityTargetPath({
      fs: fs.asWritableFS(),
      entity: fs.entry('a.txt'),
      targetFolder: 'target',
    });

    expect(path).toBe('target/a_copy.txt');
  });

  it('adds the postfix to a folder name on collision', async () => {
    const fs = new MemoryFS().addFolder('dir').addFolder('target/dir');

    const path = await getEntityTargetPath({
      fs: fs.asWritableFS(),
      entity: fs.entry('dir'),
      targetFolder: 'target',
    });

    expect(path).toBe('target/dir_copy');
  });

  it('targets the root without a leading slash', async () => {
    const fs = new MemoryFS().addFile('docs/a.txt');

    const path = await getEntityTargetPath({
      fs: fs.asWritableFS(),
      entity: fs.entry('docs/a.txt'),
      targetFolder: '',
    });

    expect(path).toBe('a.txt');
  });

  // Regression for plan 1.5: a file without an extension used to get a trailing dot.
  it('handles a file without an extension on collision', async () => {
    const fs = new MemoryFS().addFile('README').addFile('target/README');

    const path = await getEntityTargetPath({
      fs: fs.asWritableFS(),
      entity: fs.entry('README'),
      targetFolder: 'target',
    });

    expect(path).toBe('target/README_copy');
  });

  // Regression for plan 1.7/1.8: only one fallback name used to be tried.
  it('picks a free name when the "_copy" name is taken too', async () => {
    const fs = new MemoryFS().addFile('a.txt').addFile('target/a.txt').addFile('target/a_copy.txt');

    const path = await getEntityTargetPath({
      fs: fs.asWritableFS(),
      entity: fs.entry('a.txt'),
      targetFolder: 'target',
    });

    expect(fs.has(path)).toBe(false);
  });
});
