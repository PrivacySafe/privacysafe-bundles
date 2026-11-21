import { describe, expect, it } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { TRASH, createFsService } from '../helpers/services.ts';
import type { ListingEntryExtended } from '../../../shared/types/index.ts';

/** root: Links/ToWork -> work; work: Project1/spec.txt */
function setup() {
  const work = new MemoryFS('work').addFile('Project1/spec.txt', 'spec');
  const fs = new MemoryFS('root').addFolder(TRASH).addFolder('Docs').addLink('Links/ToWork', 'link-folder', {
    target: work,
  });
  return { work, ...createFsService({ fs, linkAware: true }) };
}

const entry = (fullPath: string, type: ListingEntryExtended['type']): ListingEntryExtended => ({
  id: `id-${fullPath}`,
  name: fullPath.slice(fullPath.lastIndexOf('/') + 1),
  fullPath,
  type,
});

describe('fsService with paths through links to folders', () => {
  it('lists a linked folder with logical full paths', async () => {
    const { srv, fsId } = setup();
    const list = await srv.getFolderContentFilledList({
      fsId,
      path: 'Links/ToWork/Project1',
      operatingSystem: 'linux',
    });
    expect(list.map(e => [e.fullPath, e.type])).toEqual([['Links/ToWork/Project1/spec.txt', 'file']]);

    const links = await srv.getFolderContentFilledList({ fsId, path: 'Links', operatingSystem: 'linux' });
    expect(links.map(e => [e.fullPath, e.type])).toEqual([['Links/ToWork', 'link-folder']]);
  });

  it('makes and renames entities in a linked folder', async () => {
    const { srv, fsId, work } = setup();
    await srv.makeFolder({ fsId, path: 'Links/ToWork/New' });
    await srv.renameEntity({ fsId, entity: entry('Links/ToWork/Project1/spec.txt', 'file'), newName: 'plan.txt' });
    expect(work.has('New')).toBe(true);
    expect(work.has('Project1/plan.txt')).toBe(true);
  });

  it('moves a deleted entity into the trash of the root FS and restores it by its logical path', async () => {
    const { srv, fsId, fs, work } = setup();
    const res = (await srv.deleteEntities({
      fsId,
      entities: [entry('Links/ToWork/Project1/spec.txt', 'file')],
    })) as Record<string, string>;
    const pathInTrash = res['Links/ToWork/Project1/spec.txt'];

    expect(pathInTrash.startsWith(`${TRASH}/`)).toBe(true);
    expect(fs.has(pathInTrash)).toBe(true);
    expect(work.has('Project1/spec.txt')).toBe(false);
    expect(work.paths().some(p => p.includes(TRASH))).toBe(false);

    const xattrs = fs.xattrsOf(pathInTrash)!;
    await srv.restoreEntities({
      fsId,
      entities: [
        {
          ...fs.entry(pathInTrash),
          parentFolder: xattrs.parentFolder as string,
          originalName: xattrs.originalName as string,
        },
      ],
    });
    expect(work.has('Project1/spec.txt')).toBe(true);
    expect(fs.has(pathInTrash)).toBe(false);
  });

  it('moves entities between a linked folder and a plain one', async () => {
    const { srv, fsId, fs, work } = setup();
    const moved = await srv.moveEntities({
      fsId,
      entities: [entry('Links/ToWork/Project1', 'folder')],
      targetFsId: fsId,
      targetFolder: 'Docs',
    });
    expect(moved).toEqual({ 'Links/ToWork/Project1': 'Docs/Project1' });
    expect(fs.has('Docs/Project1/spec.txt')).toBe(true);
    expect(work.has('Project1')).toBe(false);
  });

  it('removes a folder link itself, not its target', async () => {
    const { srv, fsId, fs, work } = setup();
    await srv.deleteEntities({ fsId, entities: [entry('Links/ToWork', 'link-folder')], completely: true });
    expect(fs.has('Links/ToWork')).toBe(false);
    expect(work.has('Project1/spec.txt')).toBe(true);
  });
});
