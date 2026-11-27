import { describe, expect, it, vi } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { TRASH, createFsService } from '../helpers/services.ts';

/** Puts an entity into the trash the same way deleteEntities does. */
async function trashed(fs: MemoryFS, path: string) {
  const { srv, fsId } = createFsService({ fs });
  const res = (await srv.deleteEntities({ fsId, entities: [fs.entry(path)] })) as Record<string, string>;
  const pathInTrash = res[path];
  const xattrs = fs.xattrsOf(pathInTrash)!;
  return fs.entry(pathInTrash, {
    parentFolder: xattrs.parentFolder as string,
    originalName: xattrs.originalName as string,
  });
}

describe('fsService.restoreEntities, mode "keep"', () => {
  it('restores a file to its original location', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/a.txt', 'A');
    const entity = await trashed(fs, 'docs/a.txt');
    const { srv, fsId } = createFsService({ fs });

    await srv.restoreEntities({ fsId, entities: [entity] });

    expect(fs.paths()).toEqual(['.trash-folder-test', 'docs', 'docs/a.txt']);
    expect(fs.xattrsOf('docs/a.txt')).toEqual({});
  });

  // Live test, round 2, item 19: on another device the trash was listed before the version
  // with the trash marks was adopted, and the file went to the root.
  it('takes the original location from the entity xattrs, not from an older listing', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('Dst/a.txt', 'A');
    const entity = await trashed(fs, 'Dst/a.txt');
    const { srv, fsId } = createFsService({ fs });

    await srv.restoreEntities({ fsId, entities: [{ ...entity, parentFolder: '', originalName: '' }] });

    expect(fs.has('Dst/a.txt')).toBe(true);
    expect(fs.has('a.txt')).toBe(false);
  });

  it('restores next to a same-name file under a "_copy" name', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/a.txt', 'old');
    const entity = await trashed(fs, 'docs/a.txt');
    fs.addFile('docs/a.txt', 'new');
    const { srv, fsId } = createFsService({ fs });

    await srv.restoreEntities({ fsId, entities: [entity] });

    expect(fs.paths()).toEqual(['.trash-folder-test', 'docs', 'docs/a.txt', 'docs/a_copy.txt']);
  });

  // Regression for plan 1.5: names without an extension used to get a trailing dot.
  it('restores a folder under its original name', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFolder('Photos');
    const entity = await trashed(fs, 'Photos');
    const { srv, fsId } = createFsService({ fs });

    await srv.restoreEntities({ fsId, entities: [entity] });

    expect(fs.has('Photos')).toBe(true);
  });

  // Regression for plan 1.5: the lowercased extension was not stripped from
  // 'Photo.JPG', so the restored name became 'Photo.JPG.jpg'.
  it('keeps an upper-case extension unchanged', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('Photo.JPG');
    const entity = await trashed(fs, 'Photo.JPG');
    const { srv, fsId } = createFsService({ fs });

    await srv.restoreEntities({ fsId, entities: [entity] });

    expect(fs.has('Photo.JPG')).toBe(true);
  });

  it('restores two same-name entities from one folder under different names', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/a.txt', 'first');
    const first = await trashed(fs, 'docs/a.txt');
    fs.addFile('docs/a.txt', 'second');
    const second = await trashed(fs, 'docs/a.txt');
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.restoreEntities({ fsId, entities: [first, second] });

    expect(Object.values(res!.restored).sort()).toEqual(['docs/a.txt', 'docs/a_copy.txt']);
    expect(fs.paths().filter(p => p.startsWith(`${TRASH}/`))).toEqual([]);
  });

  it('restores into a folder that no longer exists', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('gone/a.txt');
    const entity = await trashed(fs, 'gone/a.txt');
    await fs.deleteFolder('gone');
    const { srv, fsId } = createFsService({ fs });

    await srv.restoreEntities({ fsId, entities: [entity] });

    expect(fs.has('gone/a.txt')).toBe(true);
  });
});

describe('fsService.restoreEntities, mode "replace"', () => {
  // Regression for plan 1.4: the trashed entity itself used to be deleted
  // permanently instead of the conflicting one, so nothing was restored.
  it('replaces the conflicting entity with the restored one', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/report.pdf', 'trashed version');
    const entity = await trashed(fs, 'docs/report.pdf');
    fs.addFile('docs/report.pdf', 'newer version');
    const { srv, fsId } = createFsService({ fs });

    await srv.restoreEntities({ fsId, entities: [entity], mode: 'replace' });

    expect(new TextDecoder().decode(await fs.readBytes('docs/report.pdf'))).toBe('trashed version');
    expect(fs.has(entity.fullPath)).toBe(false);
  });

  it('replaces a conflicting folder with a restored one', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('Photos/old.jpg');
    const entity = await trashed(fs, 'Photos');
    fs.addFile('Photos/new.jpg');
    const { srv, fsId } = createFsService({ fs });

    await srv.restoreEntities({ fsId, entities: [entity], mode: 'replace' });

    expect(fs.paths().filter(p => p.startsWith('Photos'))).toEqual(['Photos', 'Photos/old.jpg']);
  });

  it('restores without conflicts the same way as "keep"', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/a.txt');
    const entity = await trashed(fs, 'docs/a.txt');
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.restoreEntities({ fsId, entities: [entity], mode: 'replace' });

    expect(res).toEqual({ restored: { [entity.fullPath]: 'docs/a.txt' }, replaced: {} });
  });
});

// Regression for plan 3.2: the original location of a trashed entity is read
// from xattrs, which other apps and devices can write.
describe('fsService.restoreEntities with untrusted xattrs', () => {
  it('restores into the root under the trash name when the stored location is invalid', async () => {
    const fs = new MemoryFS().addFile(`${TRASH}/a_1.txt`);
    const entity = fs.entry(`${TRASH}/a_1.txt`, { parentFolder: '../../outside', originalName: '../escape.txt' });
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.restoreEntities({ fsId, entities: [entity] });

    expect(res?.restored).toEqual({ [entity.fullPath]: 'a_1.txt' });
  });
});

// Live testing item 7: the trash marks may fail to be removed after the move back
// (the platform fails to write xattrs of some files); the restored entity must still
// be in the result, so that it is synced.
describe('fsService.restoreEntities when the trash marks cannot be removed', () => {
  it('still reports the restored entity', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('docs/a.txt', 'A');
    const entity = await trashed(fs, 'docs/a.txt');
    vi.spyOn(fs, 'updateXAttrs').mockRejectedValueOnce({ runtimeException: true, type: 'file', ioError: true });
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.restoreEntities({ fsId, entities: [entity] });

    expect(fs.has('docs/a.txt')).toBe(true);
    expect(Object.values(res?.restored ?? {})).toEqual(['docs/a.txt']);
  });
});

// Security audit 2026-11: the trash marks can be written by another device or app. In
// "replace" mode the entity at the stored location used to be removed for good, so a
// forged location erased the trash, the restored entity itself or any folder.
describe('fsService.restoreEntities with forged trash marks', () => {
  it('refuses to restore onto the trash folder itself', async () => {
    const fs = new MemoryFS().addFile(`${TRASH}/keep.txt`).addFile(`${TRASH}/x`);
    const entity = fs.entry(`${TRASH}/x`, { parentFolder: '', originalName: TRASH });
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.restoreEntities({ fsId, entities: [entity], mode: 'replace' });

    expect(res).toEqual({ restored: {}, replaced: {} });
    expect(fs.has(`${TRASH}/keep.txt`)).toBe(true);
    expect(fs.has(`${TRASH}/x`)).toBe(true);
  });

  it('restores into the root when the stored folder is in the trash', async () => {
    const fs = new MemoryFS().addFile(`${TRASH}/a.txt`);
    const entity = fs.entry(`${TRASH}/a.txt`, { parentFolder: TRASH, originalName: 'a.txt' });
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.restoreEntities({ fsId, entities: [entity], mode: 'replace' });

    expect(res?.restored).toEqual({ [`${TRASH}/a.txt`]: 'a.txt' });
    expect(fs.has('a.txt')).toBe(true);
  });

  it('moves the replaced entity to the trash instead of erasing it', async () => {
    const fs = new MemoryFS().addFile('Work/plan.txt', 'precious').addFile(`${TRASH}/bait`, 'bait');
    const entity = fs.entry(`${TRASH}/bait`, { parentFolder: '', originalName: 'Work' });
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.restoreEntities({ fsId, entities: [entity], mode: 'replace' });

    const kept = fs.paths().filter(p => p.startsWith(`${TRASH}/`) && p.endsWith('/plan.txt'));
    expect(kept).toHaveLength(1);
    expect(new TextDecoder().decode(await fs.readBytes(kept[0]))).toBe('precious');
    // the user is told where the replaced folder went
    expect(res?.replaced).toEqual({ Work: kept[0].slice(0, -'/plan.txt'.length) });
  });
});

// Live check of the audit fix: "replace" moved the newer file to the trash under a free name, and
// the user, looking at the trash, took it for the restored file that was renamed and stayed.
describe('fsService.restoreEntities, mode "replace": the result names the replaced entity', () => {
  it('reports the path in the trash of the replaced file', async () => {
    const fs = new MemoryFS().addFolder(TRASH).addFile('Dst/a.txt', 'old');
    const entity = await trashed(fs, 'Dst/a.txt');
    fs.addFile('Dst/a.txt', 'new');
    const { srv, fsId } = createFsService({ fs });

    const res = await srv.restoreEntities({ fsId, entities: [entity], mode: 'replace' });

    expect(res?.restored).toEqual({ [entity.fullPath]: 'Dst/a.txt' });
    const pathInTrash = res!.replaced['Dst/a.txt'];
    expect(pathInTrash.startsWith(`${TRASH}/a_`)).toBe(true);
    expect(new TextDecoder().decode(await fs.readBytes(pathInTrash))).toBe('new');
    expect(new TextDecoder().decode(await fs.readBytes('Dst/a.txt'))).toBe('old');
  });
});
