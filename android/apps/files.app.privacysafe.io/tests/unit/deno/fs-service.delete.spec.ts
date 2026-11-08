import { describe, expect, it, vi } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { TRASH, createFavorites, createFsService } from '../helpers/services.ts';
import { USER_FS } from '../../../shared/constants/index.ts';

function inTrash(fs: MemoryFS): string[] {
  return fs.paths().filter(p => p.startsWith(`${TRASH}/`) && !p.slice(TRASH.length + 1).includes('/'));
}

describe('fsService.deleteEntities (to trash)', () => {
  // Regression for plan 1.2: `return` inside the loop processed only the first entity.
  it('moves every selected entity to the trash', async () => {
    const fs = new MemoryFS()
      .addFolder(TRASH)
      .addFile('docs/f1.txt')
      .addFile('docs/f2.txt')
      .addFile('docs/f3.txt');
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.deleteEntities({
      fsId,
      entities: ['docs/f1.txt', 'docs/f2.txt', 'docs/f3.txt'].map(p => fs.entry(p)),
    });

    expect(fs.paths().filter(p => p.startsWith('docs/'))).toEqual([]);
    expect(inTrash(fs)).toHaveLength(3);
    expect(Object.keys(res as Record<string, string>).sort()).toEqual([
      'docs/f1.txt',
      'docs/f2.txt',
      'docs/f3.txt',
    ]);
  });

  it('returns the trash paths for folders without favorites as well', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFolder('a').addFolder('b');
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.deleteEntities({ fsId, entities: [fs.entry('a'), fs.entry('b')] });

    expect(Object.keys(res as Record<string, string>).sort()).toEqual(['a', 'b']);
  });

  it('stores the original location in xattrs of the trashed entity', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/report.pdf');
    const { srv, fsId } = createFsService({ fs });

    const res = (await srv.deleteEntities({ fsId, entities: [fs.entry('docs/report.pdf')] })) as Record<
      string,
      string
    >;

    expect(fs.xattrsOf(res['docs/report.pdf'])).toMatchObject({
      parentFolder: 'docs',
      originalName: 'report.pdf',
    });
  });

  it('keeps a trashed entity next to a same-name one already in the trash', async () => {
    const fs = new MemoryFS().addFile(`${TRASH}/a.txt`, 'older').addFile('docs/a.txt', 'newer');
    const { srv, fsId } = createFsService({ fs });

    const res = (await srv.deleteEntities({ fsId, entities: [fs.entry('docs/a.txt')] })) as Record<string, string>;

    expect(res['docs/a.txt']).toMatch(new RegExp(`^${TRASH}/a_\\d+\\.txt$`));
    expect(fs.has(`${TRASH}/a.txt`)).toBe(true);
  });

  it('removes the favorites that live inside a trashed folder', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFolder('docs/fav');
    const favorites = createFavorites([{ favId: 'f1', fsId: USER_FS, fullPath: 'docs/fav' }]);
    const { srv, fsId } = createFsService({ fs, favorites });

    await srv.deleteEntities({ fsId, entities: [fs.entry('docs')] });

    expect(favorites.current()).toEqual([]);
  });

  // Regression for plan 2.14: the favorites filter used startsWith without a '/'
  // boundary, so deleting 'Docs' also dropped the favorite 'Docs2'.
  it('keeps favorites of sibling folders with a common name prefix', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFolder('Docs').addFolder('Docs2');
    const favorites = createFavorites([{ favId: 'f2', fsId: USER_FS, fullPath: 'Docs2' }]);
    const { srv, fsId } = createFsService({ fs, favorites });

    await srv.deleteEntities({ fsId, entities: [fs.entry('Docs')] });

    expect(favorites.current()).toEqual([{ favId: 'f2', fsId: USER_FS, fullPath: 'Docs2' }]);
  });

  it('keeps favorites with the same path in another storage', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFolder('Docs');
    const favorites = createFavorites([{ favId: 'f3', fsId: 'user-local', fullPath: 'Docs' }]);
    const { srv, fsId } = createFsService({ fs, favorites });

    await srv.deleteEntities({ fsId, entities: [fs.entry('Docs')] });

    expect(favorites.current()).toHaveLength(1);
  });
});

describe('fsService.deleteEntities (completely)', () => {
  it('removes all selected entities permanently', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('a.txt').addFolder('dir').addFile('dir/x.txt');
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.deleteEntities({
      fsId,
      entities: [fs.entry('a.txt'), fs.entry('dir')],
      completely: true,
    });

    expect(res).toBe(true);
    expect(fs.paths()).toEqual([TRASH]);
  });

  it('removes permanently when deleting from inside the trash', async () => {
    const fs = new MemoryFS().addFile(`${TRASH}/old.txt`);
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.deleteEntities({ fsId, entities: [fs.entry(`${TRASH}/old.txt`)] });

    expect(res).toBe(true);
    expect(fs.has(`${TRASH}/old.txt`)).toBe(false);
  });
});

// Regression for plan 4.6: a failure was logged and swallowed; the GUI reported
// success, and the other entities of the selection were not processed.
describe('fsService.deleteEntities with failures', () => {
  it('deletes the other entities and reports the failed ones', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/a.txt').addFile('docs/c.txt');
    const { srv, fsId } = createFsService({ fs });
    const missing = { ...fs.entry('docs/a.txt'), name: 'b.txt', fullPath: 'docs/b.txt' };

    const error = await srv
      .deleteEntities({ fsId, entities: [fs.entry('docs/a.txt'), missing, fs.entry('docs/c.txt')] })
      .catch(err => err);

    expect(error).toMatchObject({ name: 'PartialDeleteError', failedPaths: ['docs/b.txt'] });
    expect(Object.keys(error.result).sort()).toEqual(['docs/a.txt', 'docs/c.txt']);
    expect(fs.paths().filter(p => p.startsWith('docs/'))).toEqual([]);
  });

  it('reports a failed complete removal', async () => {
    const fs = new MemoryFS().addFile('a.txt');
    const { srv, fsId } = createFsService({ fs });
    const missing = { ...fs.entry('a.txt'), name: 'b.txt', fullPath: 'b.txt' };

    await expect(
      srv.deleteEntities({ fsId, entities: [fs.entry('a.txt'), missing], completely: true }),
    ).rejects.toMatchObject({ failedPaths: ['b.txt'] });
    expect(fs.has('a.txt')).toBe(false);
  });
});

// Regression for live testing item 7: the entity was moved to the trash, but its
// original location could not be stored there (the platform failed to write the
// xattrs). It stayed in the trash without a way back, and nothing was synced.
describe('fsService.deleteEntities when the original location cannot be stored', () => {
  const xattrsFailure = { runtimeException: true, type: 'file', code: 'EIO', ioError: true };

  it('moves the entity back and reports it', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/a.txt', 'A').addFile('docs/b.txt', 'B');
    vi.spyOn(fs, 'updateXAttrs').mockRejectedValueOnce(xattrsFailure);
    const { srv, fsId } = createFsService({ fs });

    const error = await srv
      .deleteEntities({ fsId, entities: [fs.entry('docs/a.txt'), fs.entry('docs/b.txt')] })
      .catch(err => err);

    expect(error).toMatchObject({
      name: 'PartialDeleteError',
      failedPaths: ['docs/a.txt'],
      movedBackPaths: ['docs/a.txt'],
    });
    expect(fs.has('docs/a.txt')).toBe(true);
    expect(Object.keys(error.result)).toEqual(['docs/b.txt']);
    expect(inTrash(fs)).toHaveLength(1);
  });

  it('reports the entity left in the trash when moving it back fails too', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/a.txt', 'A');
    vi.spyOn(fs, 'updateXAttrs').mockRejectedValueOnce(xattrsFailure);
    const move = fs.move.bind(fs);
    vi.spyOn(fs, 'move')
      .mockImplementationOnce(move)
      .mockRejectedValueOnce({ runtimeException: true, type: 'file', code: 'EIO', ioError: true });
    const { srv, fsId } = createFsService({ fs });

    const error = await srv.deleteEntities({ fsId, entities: [fs.entry('docs/a.txt')] }).catch(err => err);

    expect(error).toMatchObject({ failedPaths: ['docs/a.txt'], movedBackPaths: [] });
    // it is in the trash: the caller must sync it and the folders
    expect(error.result['docs/a.txt']).toMatch(new RegExp(`^${TRASH}/a`));
    expect(fs.has(error.result['docs/a.txt'])).toBe(true);
  });

  it('does not undo the removal when only the favorite mark cannot be removed', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFolder('docs/fav', { favoriteId: 'f1' });
    vi.spyOn(fs, 'listXAttrs').mockRejectedValueOnce(xattrsFailure);
    const { srv, fsId } = createFsService({ fs });

    const res = (await srv.deleteEntities({ fsId, entities: [fs.entry('docs/fav')] })) as Record<string, string>;

    expect(fs.has('docs/fav')).toBe(false);
    expect(fs.has(res['docs/fav'])).toBe(true);
  });
});
