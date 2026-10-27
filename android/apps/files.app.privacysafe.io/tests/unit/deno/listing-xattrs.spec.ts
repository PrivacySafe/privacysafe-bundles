import { describe, expect, it, vi } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { loadFolderContentListPrepared } from '../../../src_deno/services/fs-service.utils/load-folder-content-list-prepared.ts';
import { filterRpcWritableXAttrs } from '../../../src_deno/services/fs-service.utils/listing-xattrs.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function list(fs: MemoryFS, path = '') {
  return loadFolderContentListPrepared({
    fs: fs.asWritableFS(),
    path,
    basePath: '',
    trashFolderName: '.trash',
    operatingSystem: 'linux',
  });
}

// Regression for plan 3.2: every xattr was copied into the listing entry after
// its real fields, so an attribute named `fullPath` redirected GUI actions
// (delete, rename) to another entity.
describe('listing entries and xattrs', () => {
  it('ignores xattrs that try to replace listing fields', async () => {
    const fs = new MemoryFS()
      .addFile('Documents/important.pdf')
      .addFile('harmless.txt', '', { fullPath: 'Documents/important.pdf', name: 'x', type: 'folder', size: 1 });

    const entry = (await list(fs)).find(e => e.fullPath !== 'Documents');

    expect(entry).toMatchObject({ name: 'harmless.txt', fullPath: 'harmless.txt', type: 'file' });
    expect(entry).not.toHaveProperty('size', 1);
  });

  it('keeps the known xattrs with valid values', async () => {
    const fs = new MemoryFS().addFolder('fav', { favoriteId: 'f1', thumbnail: PNG });

    const [entry] = await list(fs);

    expect(entry).toMatchObject({ favoriteId: 'f1', thumbnail: PNG });
  });

  it('drops known xattrs with invalid values', async () => {
    const fs = new MemoryFS().addFile('a.png', '', {
      thumbnail: 'javascript:alert(1)',
      favoriteId: { not: 'a string' },
      originalName: '../../etc',
    });

    const [entry] = await list(fs);

    expect(entry.thumbnail).toBeUndefined();
    expect(entry.favoriteId).toBeUndefined();
    expect(entry.originalName).toBe('');
  });

  it('ignores unknown xattrs', async () => {
    const fs = new MemoryFS().addFile('a.txt', '', { 'some-other-app': 'value' });

    const [entry] = await list(fs);

    expect(entry).not.toHaveProperty('some-other-app');
  });
});

describe('filterRpcWritableXAttrs', () => {
  it('lets the GUI set file metadata only', () => {
    const { allowed, rejected } = filterRpcWritableXAttrs({
      id: 'abc',
      ext: 'png',
      mime: 'image/png',
      thumbnail: PNG,
      favoriteId: 'f1',
      parentFolder: 'x',
      fullPath: 'y',
    });

    expect(allowed).toEqual({ id: 'abc', ext: 'png', mime: 'image/png', thumbnail: PNG });
    expect(rejected.sort()).toEqual(['favoriteId', 'fullPath', 'parentFolder']);
  });

  it('rejects invalid values of allowed attributes', () => {
    expect(filterRpcWritableXAttrs({ thumbnail: 'https://example.com/x.png' }).allowed).toEqual({});
  });
});

describe('folder listing', () => {
  it('keeps the folder order and hides dot-files and the trash', async () => {
    const fs = new MemoryFS().addFile('b.txt').addFolder('.trash').addFile('.hidden').addFolder('a').addFile('c.txt');

    const names = (await list(fs)).map(e => e.name);

    expect(names).toEqual(['b.txt', 'a', 'c.txt']);
  });

  it('takes the id and the extension from xattrs when present', async () => {
    const fs = new MemoryFS().addFile('photo', '', { id: 'id-1', ext: 'jpg' });

    const [entry] = await list(fs);

    expect(entry).toMatchObject({ id: 'id-1', ext: 'jpg' });
  });

  // Regression for plan 7.3: 'id' and 'ext' were read for every entity, even
  // without such attributes.
  it('reads only the attributes the entity has', async () => {
    const fs = new MemoryFS().addFile('a.txt').addFile('b.txt', '', { favoriteId: 'f' });
    const getXAttr = vi.spyOn(fs, 'getXAttr');

    await list(fs);

    expect(getXAttr.mock.calls).toEqual([['b.txt', 'favoriteId']]);
  });

  it('ignores tags that are not a list of strings', async () => {
    const fs = new MemoryFS().addFile('a.txt', '', { tags: 'oops' }).addFile('b.txt', '', { tags: ['x'] });

    const [a, b] = await list(fs);

    expect(a.tags).toEqual([]);
    expect(b.tags).toEqual(['x']);
  });
});

// Regression for the picker plan, item 3: a missing folder was listed as an
// empty one, so the picker could save into a folder that does not exist.
describe('listing of a missing folder', () => {
  it('fails instead of returning an empty list', async () => {
    await expect(list(new MemoryFS(), 'missing')).rejects.toMatchObject({ notFound: true });
  });
});

describe('listing for the file picker', () => {
  it('does not read extended attributes when they are not needed', async () => {
    const fs = new MemoryFS().addFile('a.txt', '', { favoriteId: 'f', thumbnail: PNG });
    const listXAttrs = vi.spyOn(fs, 'listXAttrs');

    const [entry] = await loadFolderContentListPrepared({
      fs: fs.asWritableFS(),
      path: '',
      basePath: '',
      trashFolderName: '.trash',
      operatingSystem: 'linux',
      withXAttrs: false,
    });

    expect(listXAttrs).not.toHaveBeenCalled();
    expect(entry).toMatchObject({ name: 'a.txt', type: 'file' });
    expect(entry.thumbnail).toBeUndefined();
  });
});

// Regression for the picker plan, item 8: OS folder names were hidden in any
// storage and at any depth ("Desktop" in the synced Home disappeared), while
// the Windows NTUSER.DAT file was never hidden (the check required a folder).
describe('OS-specific entries', () => {
  const names = async (fs: MemoryFS, operatingSystem: 'macos' | 'windows', path = '') =>
    (
      await loadFolderContentListPrepared({
        fs: fs.asWritableFS(),
        path,
        basePath: '',
        trashFolderName: '.trash',
        operatingSystem,
      })
    ).map(e => e.name);

  it('hides macOS system folders at the top of the device home only', async () => {
    const device = new MemoryFS('home', 'device').addFolder('Desktop').addFolder('Docs/Library').addFile('library');

    expect(await names(device, 'macos')).toEqual(['Docs', 'library']);
    expect(await names(device, 'macos', 'Docs')).toEqual(['Library']);
  });

  it('shows folders with such names in a 3N storage', async () => {
    const synced = new MemoryFS('home', 'synced').addFolder('Desktop').addFolder('Library');

    expect(await names(synced, 'macos')).toEqual(['Desktop', 'Library']);
  });

  it('hides the Windows registry files in the device home', async () => {
    const device = new MemoryFS('home', 'device').addFile('NTUSER.DAT').addFile('ntuser.ini').addFile('notes.txt');

    expect(await names(device, 'windows')).toEqual(['notes.txt']);
  });
});

