import { describe, expect, it } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import {
  deleteFile,
  deleteFolder,
  getReadonlySubRoot,
  makeFolder,
  moveFsEntity,
  readLink,
} from '../../../shared/utils/fs-utils/index.ts';

// Regression for plan 1.13: wrappers used to `return fs.xxx()` without await
// inside try, so the catch never ran and stopErrorPropagate had no effect.
describe('shared/utils/fs-utils wrappers', () => {
  const fs = () => new MemoryFS().asWritableFS();

  it.each([
    ['deleteFile', () => deleteFile({ fs: fs(), path: 'missing.txt', stopErrorPropagate: true })],
    ['deleteFolder', () => deleteFolder({ fs: fs(), path: 'missing', stopErrorPropagate: true })],
    ['moveFsEntity', () => moveFsEntity({ fs: fs(), src: 'missing', dst: 'x', stopErrorPropagate: true })],
    ['readLink', () => readLink({ fs: fs(), path: 'missing', stopErrorPropagate: true })],
    ['getReadonlySubRoot', () => getReadonlySubRoot({ fs: fs(), folder: 'missing', stopErrorPropagate: true })],
  ])('%s resolves to undefined with stopErrorPropagate', async (_name, call) => {
    await expect(call()).resolves.toBeUndefined();
  });

  it('rethrows the FS error without stopErrorPropagate', async () => {
    await expect(deleteFile({ fs: fs(), path: 'missing.txt' })).rejects.toMatchObject({ notFound: true });
  });

  it('passes successful results through', async () => {
    const memoryFs = new MemoryFS();
    await makeFolder({ fs: memoryFs.asWritableFS(), path: 'a/b' });
    expect(memoryFs.has('a/b')).toBe(true);
  });
});
