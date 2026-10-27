import { describe, expect, it } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { createFavorites, createFsService } from '../helpers/services.ts';
import { USER_FS } from '../../../shared/constants/index.ts';

describe('fsService.moveEntities (same FS)', () => {
  it('moves several entities into the target folder', async () => {
    const fs = new MemoryFS().addFile('a.txt').addFolder('dir').addFile('dir/x.txt').addFolder('target');
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.moveEntities({
      fsId,
      entities: [fs.entry('a.txt'), fs.entry('dir')],
      targetFsId: fsId,
      targetFolder: 'target',
    });

    expect(fs.paths()).toEqual(['target', 'target/a.txt', 'target/dir', 'target/dir/x.txt']);
    expect(res).toEqual({ 'a.txt': 'target/a.txt', dir: 'target/dir' });
  });

  it('updates the path of a moved favorite folder', async () => {
    const fs = new MemoryFS().addFolder('fav').addFolder('target');
    const favorites = createFavorites([{ favId: 'f1', fsId: USER_FS, fullPath: 'fav' }]);
    const { srv, fsId } = createFsService({ fs, favorites });

    await srv.moveEntities({
      fsId,
      entities: [fs.entry('fav', { favoriteId: 'f1' })],
      targetFsId: fsId,
      targetFolder: 'target',
    });

    expect(favorites.current()).toEqual([{ favId: 'f1', fsId: USER_FS, fullPath: 'target/fav' }]);
  });

  // Regression for plan 1.8: the "_copy" target path used to be computed but not
  // passed to moveFsEntity, so the move failed with alreadyExists.
  it('moves next to a same-name entity under a "_copy" name', async () => {
    const fs = new MemoryFS().addFile('a.txt', 'moved').addFile('target/a.txt', 'existing');
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.moveEntities({
      fsId,
      entities: [fs.entry('a.txt')],
      targetFsId: fsId,
      targetFolder: 'target',
    });

    expect(res).toEqual({ 'a.txt': 'target/a_copy.txt' });
    expect(fs.paths()).toEqual(['target', 'target/a.txt', 'target/a_copy.txt']);
  });
});

describe('fsService.copyMoveEntities, move mode', () => {
  it('moves without leaving or duplicating the source', async () => {
    const fs = new MemoryFS().addFile('a.txt').addFolder('target');
    const { srv, fsId } = createFsService({ fs });

    await srv.copyMoveEntities({
      sourceFsId: fsId,
      entities: [fs.entry('a.txt')],
      targetFsId: fsId,
      target: fs.entry('target'),
      moveMode: true,
    });

    expect(fs.paths()).toEqual(['target', 'target/a.txt']);
  });
});

// Regression for plan 2.14: favorites inside a moved or renamed folder kept
// their old paths.
describe('favorites follow moved and renamed folders', () => {
  it('updates nested favorites when a folder is moved', async () => {
    const fs = new MemoryFS().addFolder('projects/app/src').addFolder('archive');
    const favorites = createFavorites([
      { favId: 'f1', fsId: USER_FS, fullPath: 'projects' },
      { favId: 'f2', fsId: USER_FS, fullPath: 'projects/app/src' },
      { favId: 'f3', fsId: USER_FS, fullPath: 'projects2' },
    ]);
    const { srv, fsId } = createFsService({ fs, favorites });

    await srv.moveEntities({ fsId, entities: [fs.entry('projects')], targetFsId: fsId, targetFolder: 'archive' });

    expect(favorites.current()).toEqual([
      { favId: 'f1', fsId: USER_FS, fullPath: 'archive/projects' },
      { favId: 'f2', fsId: USER_FS, fullPath: 'archive/projects/app/src' },
      { favId: 'f3', fsId: USER_FS, fullPath: 'projects2' },
    ]);
  });

  it('updates favorites when a folder is renamed', async () => {
    const fs = new MemoryFS().addFolder('docs/old/inner');
    const favorites = createFavorites([
      { favId: 'f1', fsId: USER_FS, fullPath: 'docs/old' },
      { favId: 'f2', fsId: USER_FS, fullPath: 'docs/old/inner' },
    ]);
    const { srv, fsId } = createFsService({ fs, favorites });

    await srv.renameEntity({ fsId, entity: fs.entry('docs/old'), newName: 'new' });

    expect(favorites.current().map(f => f.fullPath)).toEqual(['docs/new', 'docs/new/inner']);
  });

  it('keeps favorites when a rename fails', async () => {
    const fs = new MemoryFS().addFolder('a').addFolder('b');
    const favorites = createFavorites([{ favId: 'f1', fsId: USER_FS, fullPath: 'a' }]);
    const { srv, fsId } = createFsService({ fs, favorites });

    await expect(srv.renameEntity({ fsId, entity: fs.entry('a'), newName: 'b' })).rejects.toThrow();

    expect(favorites.current()).toEqual([{ favId: 'f1', fsId: USER_FS, fullPath: 'a' }]);
  });
});
