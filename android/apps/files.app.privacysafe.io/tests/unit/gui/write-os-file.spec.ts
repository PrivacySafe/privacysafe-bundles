import { describe, expect, it, vi } from 'vitest';
import { MemoryFS } from '../helpers/memory-fs.ts';
import { writeOsFile } from '../../../src/store/fs-operations/write-os-file.ts';

const bytesOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

// Regression for plan 7.1: an upload read the whole file into memory three or
// four times (a data URL for a fake progress, the bytes, a base64 copy).
describe('writeOsFile', () => {
  it('streams the content in chunks and reports the progress', async () => {
    const fs = new MemoryFS();
    const data = bytesOf(10_000);
    const onProgress = vi.fn();

    await writeOsFile({
      fs: fs.asWritableFS(),
      path: 'docs/big.bin',
      file: new Blob([data]),
      onProgress,
      chunkSize: 4096,
    });

    expect(await fs.readBytes('docs/big.bin')).toEqual(data);
    expect(onProgress.mock.calls).toEqual([
      [4096, 10_000],
      [8192, 10_000],
      [10_000, 10_000],
    ]);
  });

  it('writes an empty file', async () => {
    const fs = new MemoryFS();
    const onProgress = vi.fn();

    await writeOsFile({ fs: fs.asWritableFS(), path: 'empty.txt', file: new Blob([]), onProgress });

    expect(await fs.readBytes('empty.txt')).toEqual(new Uint8Array());
    expect(onProgress).toHaveBeenCalledWith(0, 0);
  });

  it('never overwrites an existing file', async () => {
    const fs = new MemoryFS().addFile('a.txt', 'keep me');

    await expect(
      writeOsFile({ fs: fs.asWritableFS(), path: 'a.txt', file: new Blob(['new']) }),
    ).rejects.toMatchObject({ alreadyExists: true });
    expect(new TextDecoder().decode(await fs.readBytes('a.txt'))).toBe('keep me');
  });

  it('removes a partly written file when reading the source fails', async () => {
    const fs = new MemoryFS();
    const failingFile = {
      size: 3 * 1024,
      slice: (start: number) => ({
        arrayBuffer: async () => {
          if (start > 0) {
            throw new Error('the file became unreadable');
          }
          return new ArrayBuffer(1024);
        },
      }),
    } as unknown as Blob;

    await expect(
      writeOsFile({ fs: fs.asWritableFS(), path: 'broken.bin', file: failingFile, chunkSize: 1024 }),
    ).rejects.toThrow('unreadable');
    expect(fs.has('broken.bin')).toBe(false);
  });
});
