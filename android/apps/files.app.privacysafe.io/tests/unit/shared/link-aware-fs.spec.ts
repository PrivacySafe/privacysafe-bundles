import { describe, expect, it, vi } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import {
  assertNotCopiedIntoItself,
  COPY_INTO_ITSELF_ERROR,
  FsLinkResolver,
  LINK_HOP_REVALIDATE_MS,
  MAX_LINK_HOPS,
  makeLinkAwareFs,
  parseFolderItselfPath,
  toFolderItselfPath,
  unwrapLinkAwareFs,
} from '../../../shared/utils/fs-utils/index.ts';

/**
 * root:   Docs/Work/Project1/plan.txt, Links/ToWork -> work,
 *         Docs/Work/Project1/ToTasks -> tasks (inside `work`)
 * work:   Project1/spec.txt, Project1/ToTasks -> tasks
 * tasks:  2026-10-12/todo.txt
 */
function makeStorage() {
  const tasks = new MemoryFS('tasks').addFile('2026-10-12/todo.txt', 'todo');
  const work = new MemoryFS('work')
    .addFile('Project1/spec.txt', 'spec')
    .addLink('Project1/ToTasks', 'link-folder', {
      target: tasks,
    });
  const root = new MemoryFS('root')
    .addFile('Docs/Work/Project1/plan.txt', 'plan')
    .addLink('Links/ToWork', 'link-folder', { target: work })
    .addLink('Links/ToFile', 'link-file')
    .addFile('Links/readme.txt', 'readme');
  return { root, work, tasks, fs: makeLinkAwareFs(root.asWritableFS()) };
}

const names = (list: web3n.files.ListingEntry[]) => list.map(e => e.name).sort();

describe('FsLinkResolver', () => {
  it('resolves a path without links to the root FS', async () => {
    const { root } = makeStorage();
    const loc = await new FsLinkResolver(root.asWritableFS()).resolveFolder('Docs/Work');
    expect(loc).toMatchObject({ path: 'Docs/Work', hasHops: false, writable: true });
    expect(loc.fs).toBe(root);
    expect(loc.segments).toEqual([
      { name: 'Docs', isLink: false },
      { name: 'Work', isLink: false },
    ]);
  });

  it('goes through several links on the way', async () => {
    const { root, tasks } = makeStorage();
    const loc = await new FsLinkResolver(root.asWritableFS()).resolveFolder(
      'Links/ToWork/Project1/ToTasks/2026-10-12',
    );
    expect(loc.fs).toBe(tasks);
    expect(loc.path).toBe('2026-10-12');
    expect(loc.hasHops).toBe(true);
    expect(loc.segments.map(s => s.isLink)).toEqual([false, true, false, true, false]);
  });

  it('resolves a folder link at the end of the path to its target root', async () => {
    const { root, work } = makeStorage();
    const loc = await new FsLinkResolver(root.asWritableFS()).resolveFolder('Links/ToWork');
    expect(loc.fs).toBe(work);
    expect(loc.path).toBe('');
  });

  it('passes the readonly access of a link to the rest of the path', async () => {
    const target = new MemoryFS('ro').addFolder('A');
    const root = new MemoryFS('root').addLink('RO', 'link-folder', { target, readonly: true });
    const loc = await new FsLinkResolver(root.asWritableFS()).resolveFolder('RO/A');
    expect(loc.writable).toBe(false);
  });

  it('throws notDirectory for a file link or a file on the way, notFound for a missing folder', async () => {
    const { root } = makeStorage();
    await root.deleteLink('Links/ToFile');
    await root.link('Links/ToFile', { bytes: new Uint8Array() } as unknown as web3n.files.File);
    const resolver = new FsLinkResolver(root.asWritableFS());
    await expect(resolver.resolveFolder('Links/ToFile/x')).rejects.toMatchObject({ notDirectory: true });
    await expect(resolver.resolveFolder('Links/readme.txt/x')).rejects.toMatchObject({ notDirectory: true });
    await expect(resolver.resolveFolder('Links/Missing')).rejects.toMatchObject({ notFound: true });
  });

  it('keeps the missing end of a path when asked to', async () => {
    const { root, work } = makeStorage();
    const loc = await new FsLinkResolver(root.asWritableFS()).resolveFolder('Links/ToWork/New/Sub', {
      allowMissingTail: true,
    });
    expect(loc.fs).toBe(work);
    expect(loc.path).toBe('New/Sub');
  });

  it('stops a loop of links', async () => {
    const loop = new MemoryFS('loop');
    loop.addLink('Self', 'link-folder', { target: loop });
    const path = Array.from({ length: MAX_LINK_HOPS + 1 }, () => 'Self').join('/');
    await expect(new FsLinkResolver(loop.asWritableFS()).resolveFolder(path)).rejects.toThrow(/Too many links/);
  });

  it('reuses a cached link and checks it again after a while', async () => {
    const { root } = makeStorage();
    let now = 0;
    const resolver = new FsLinkResolver(root.asWritableFS(), () => now);
    const first = await resolver.resolveFolder('Links/ToWork/Project1');
    const readLink = vi.spyOn(root, 'readLink');

    const second = await resolver.resolveFolder('Links/ToWork/Project1');
    expect(second.fs).toBe(first.fs);
    expect(readLink).not.toHaveBeenCalled();

    await root.deleteLink('Links/ToWork');
    now = LINK_HOP_REVALIDATE_MS + 1;
    await expect(resolver.resolveFolder('Links/ToWork/Project1')).rejects.toMatchObject({ notFound: true });
  });

  it('forgets links at and inside a path', async () => {
    const { root } = makeStorage();
    const resolver = new FsLinkResolver(root.asWritableFS());
    await resolver.resolveFolder('Links/ToWork');
    expect(resolver.hasCachedHop('Links/ToWork/Project1')).toBe(true);
    resolver.invalidate('Links');
    expect(resolver.hasCachedHop('Links/ToWork/Project1')).toBe(false);
  });
});

describe('makeLinkAwareFs', () => {
  it('lists a folder behind links by its logical path', async () => {
    const { fs } = makeStorage();
    expect(names(await fs.listFolder('Links/ToWork'))).toEqual(['Project1']);
    expect(names(await fs.listFolder('Links/ToWork/Project1/ToTasks/2026-10-12'))).toEqual(['todo.txt']);
  });

  it('makes no extra calls for a path without links', async () => {
    const { root, fs } = makeStorage();
    const check = vi.spyOn(root, 'checkFolderPresence');
    expect(names(await fs.listFolder('Docs/Work/Project1'))).toEqual(['plan.txt']);
    expect(check).not.toHaveBeenCalled();
  });

  it('works with the link itself, not its target, for the last path segment', async () => {
    const { root, work, fs } = makeStorage();
    expect((await fs.stat('Links/ToWork')).isLink).toBe(true);
    await fs.move('Links/ToWork', 'Links/Renamed');
    expect(root.has('Links/Renamed')).toBe(true);
    expect(work.has('Project1')).toBe(true);
    expect(names(await fs.listFolder('Links/Renamed'))).toEqual(['Project1']);
  });

  it('reads, writes and makes folders behind links', async () => {
    const { work, fs } = makeStorage();
    expect(new TextDecoder().decode(await fs.readBytes('Links/ToWork/Project1/spec.txt'))).toBe('spec');
    await fs.writeBytes('Links/ToWork/Project1/new.txt', new TextEncoder().encode('new'));
    await fs.makeFolder('Links/ToWork/A/B');
    await fs.updateXAttrs('Links/ToWork/Project1/new.txt', { set: { tag: 'x' } });
    expect(work.has('Project1/new.txt')).toBe(true);
    expect(work.has('A/B')).toBe(true);
    expect(await fs.getXAttr('Links/ToWork/Project1/new.txt', 'tag')).toBe('x');
  });

  it('treats a folder link as a folder in presence checks', async () => {
    const { fs } = makeStorage();
    expect(await fs.checkFolderPresence('Links/ToWork')).toBe(true);
    expect(await fs.checkFolderPresence('Links/ToWork/Project1')).toBe(true);
    expect(await fs.checkFilePresence('Links/ToWork/Project1/spec.txt')).toBe(true);
    expect(await fs.checkLinkPresence('Links/ToWork/Project1/ToTasks')).toBe(true);
    expect(await fs.checkFolderPresence('Links/ToWork/Missing')).toBe(false);
  });

  it('moves inside one link target with the platform move', async () => {
    const { work, fs } = makeStorage();
    const move = vi.spyOn(work, 'move');
    await fs.move('Links/ToWork/Project1/spec.txt', 'Links/ToWork/spec.txt');
    expect(move).toHaveBeenCalledWith('Project1/spec.txt', 'spec.txt');
    expect(work.has('spec.txt')).toBe(true);
  });

  it('moves between the root and a link target by copy and removal, keeping xattrs', async () => {
    const { root, work, fs } = makeStorage();
    await root.updateXAttrs('Docs/Work/Project1/plan.txt', { set: { id: 'plan-id' } });
    await fs.move('Docs/Work/Project1/plan.txt', 'Links/ToWork/plan.txt');
    expect(root.has('Docs/Work/Project1/plan.txt')).toBe(false);
    expect(work.xattrsOf('plan.txt')).toEqual({ id: 'plan-id' });

    await fs.move('Links/ToWork/Project1', 'Docs/Project1');
    expect(work.has('Project1')).toBe(false);
    expect(root.has('Docs/Project1/spec.txt')).toBe(true);
    expect(await root.checkLinkPresence('Docs/Project1/ToTasks')).toBe(true);
  });

  it('refuses to copy a folder into itself when the destination FS is another object', async () => {
    const docs = new MemoryFS('docs').addFile('Sub/a.txt');
    // another FS object over the same folder, as the target of a link to it
    const sameFolder = makeLinkAwareFs(docs.asWritableFS());
    await expect(
      assertNotCopiedIntoItself({ srcFs: docs.asWritableFS(), src: '', dstFs: sameFolder, dst: 'Sub/Copy' }),
    ).rejects.toThrow(COPY_INTO_ITSELF_ERROR);
    expect(docs.paths().some(p => p.includes('.link-probe-'))).toBe(false);

    const other = new MemoryFS('other');
    await expect(
      assertNotCopiedIntoItself({ srcFs: docs.asWritableFS(), src: '', dstFs: other.asWritableFS(), dst: 'Copy' }),
    ).resolves.toBeUndefined();
    expect(other.paths()).toEqual([]);
  });

  it('leaves a move into itself through a link to the platform when both ends are one FS', async () => {
    const docs = new MemoryFS('docs').addFolder('Sub');
    docs.addLink('Self', 'link-folder', { target: docs });
    const fs = makeLinkAwareFs(docs.asWritableFS());
    await expect(fs.move('Sub', 'Self/Sub/Moved')).rejects.toThrow(/into itself/);
    expect(docs.has('Sub')).toBe(true);
  });

  it('refuses writes behind a readonly link', async () => {
    const target = new MemoryFS('ro').addFolder('A');
    const root = new MemoryFS('root').addLink('RO', 'link-folder', { target, readonly: true });
    const fs = makeLinkAwareFs(root.asWritableFS());
    expect(names(await fs.listFolder('RO'))).toEqual(['A']);
    await expect(fs.makeFolder('RO/B')).rejects.toMatchObject({ readonlyLinkTarget: true });
    await expect(fs.move('RO/A', 'A')).rejects.toMatchObject({ readonlyLinkTarget: true });
    expect(target.has('B')).toBe(false);
  });

  it('runs the versioned and sync API by logical paths', async () => {
    const work = new MemoryFS('work', 'synced').addFile('Project1/spec.txt');
    const root = new MemoryFS('root', 'synced').addLink('ToWork', 'link-folder', { target: work });
    const fs = makeLinkAwareFs(root.asWritableFS());
    const status = vi.spyOn(work.v!.sync, 'status');
    await expect(fs.v!.sync!.status('ToWork/Project1/spec.txt')).resolves.toEqual({ state: 'unsynced' });
    expect(status).toHaveBeenCalledWith('Project1/spec.txt');
    expect((await fs.v!.stat('ToWork/Project1/spec.txt')).isFile).toBe(true);
  });

  it('takes "<link>/." for the root of the link target and "<link>" for the link itself', async () => {
    const work = new MemoryFS('work', 'synced').addFolder('Project1');
    const root = new MemoryFS('root', 'synced').addLink('ToWork', 'link-folder', { target: work });
    const fs = makeLinkAwareFs(root.asWritableFS());
    const rootStatus = vi.spyOn(root.v!.sync, 'status');
    const workStatus = vi.spyOn(work.v!.sync, 'status');

    await fs.v!.sync!.status('ToWork');
    expect(rootStatus).toHaveBeenLastCalledWith('ToWork');

    await fs.v!.sync!.status(toFolderItselfPath('ToWork'));
    expect(workStatus).toHaveBeenLastCalledWith('');
    expect(parseFolderItselfPath('ToWork/.')).toEqual({ path: 'ToWork', isFolderItself: true });
  });

  // Live test: the device FS throws notFound from checkLinkPresence for a missing path
  it('answers false instead of throwing from a presence check without throwIfMissing', async () => {
    const root = new MemoryFS('device', 'device').addFolder('Movies');
    vi.spyOn(root, 'checkLinkPresence').mockRejectedValue({
      runtimeException: true,
      type: 'file',
      notFound: true,
    });
    const fs = makeLinkAwareFs(root.asWritableFS());

    await expect(fs.checkLinkPresence('Movies/123')).resolves.toBe(false);
    await expect(fs.checkLinkPresence('Movies/123', true)).rejects.toMatchObject({ notFound: true });
  });

  it('tells whether an entity is reached through links', async () => {
    const { fs } = makeStorage();
    expect(await fs.isReachedThroughLinks('Docs/Work/Project1/plan.txt')).toBe(false);
    expect(await fs.isReachedThroughLinks('Links/ToWork')).toBe(false);
    expect(await fs.isReachedThroughLinks('Links/ToWork/Project1')).toBe(true);
  });

  it('keeps the FS properties and gives the raw FS for platform APIs', () => {
    const { root, fs } = makeStorage();
    expect(fs.name).toBe('root');
    expect(fs.type).toBe('local');
    expect(unwrapLinkAwareFs(fs)).toBe(root);
    expect(makeLinkAwareFs(fs)).toBe(fs);
  });
});
