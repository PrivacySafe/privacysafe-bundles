import { describe, expect, it } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { createFsService } from '../helpers/services.ts';

// Regression for plan 1.1: rename used to go through moveEntity(newPath: newName),
// which dropped the new name and moved the entity to the root.
describe('fsService.renameEntity', () => {
  it('renames a file inside a nested folder in place', async () => {
    const fs = new MemoryFS().addFile('docs/a.txt', 'A');
    const { srv, fsId } = createFsService({ fs });

    await srv.renameEntity({ fsId, entity: fs.entry('docs/a.txt'), newName: 'b.txt' });

    expect(fs.paths()).toEqual(['docs', 'docs/b.txt']);
  });

  it('renames a root-level file', async () => {
    const fs = new MemoryFS().addFile('a.txt');
    const { srv, fsId } = createFsService({ fs });

    await srv.renameEntity({ fsId, entity: fs.entry('a.txt'), newName: 'b.txt' });

    expect(fs.paths()).toEqual(['b.txt']);
  });

  it('renames a folder together with its content', async () => {
    const fs = new MemoryFS().addFile('docs/old/x.txt').addFile('docs/old/sub/y.txt');
    const { srv, fsId } = createFsService({ fs });

    await srv.renameEntity({ fsId, entity: fs.entry('docs/old'), newName: 'new' });

    expect(fs.paths()).toEqual(['docs', 'docs/new', 'docs/new/sub', 'docs/new/sub/y.txt', 'docs/new/x.txt']);
  });

  it('leaves both entities untouched when the new name is taken', async () => {
    const fs = new MemoryFS().addFile('docs/a.txt', 'A').addFile('docs/b.txt', 'B');
    const { srv, fsId } = createFsService({ fs });

    await expect(srv.renameEntity({ fsId, entity: fs.entry('docs/a.txt'), newName: 'b.txt' })).rejects.toThrow(
      'was not renamed',
    );

    expect(fs.paths()).toEqual(['docs', 'docs/a.txt', 'docs/b.txt']);
    expect(new TextDecoder().decode(await fs.readBytes('docs/b.txt'))).toBe('B');
  });
});
