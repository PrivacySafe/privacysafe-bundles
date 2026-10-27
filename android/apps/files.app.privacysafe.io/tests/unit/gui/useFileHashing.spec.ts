import { createHash } from 'node:crypto';
import { computed, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingEntryExtended } from '../../../shared/types/index.ts';

const files = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@/store', () => ({
  useFsStore: () => ({
    getFs: () => ({ writableFile: async (path: string) => files.get(path) }),
  }),
}));

const { useFileHashing } = await import('../../../src/components/common/fs-entity-info/useFileHashing.ts');

const MTIME = new Date('2026-01-01T00:00:00Z');

/**
 * A writable file. With `gated`, its byte source hands out chunks only when the
 * test calls `release()`, so a hashing run can be interrupted at a chosen point.
 */
function createFile(content: Uint8Array, { gated = false } = {}) {
  const xattrs: Record<string, unknown> = {};
  const pendingReads: Array<() => void> = [];
  let offset = 0;

  const file = {
    xattrs,
    release: () => pendingReads.shift()?.(),
    releaseAll: async () => {
      while (pendingReads.length) {
        pendingReads.shift()!();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    },
    stat: async () => ({ mtime: MTIME, size: content.length }),
    getXAttr: async (name: string) => xattrs[name],
    updateXAttrs: vi.fn(async ({ set }: { set: Record<string, unknown> }) => {
      Object.assign(xattrs, set);
    }),
    getByteSource: async () => {
      offset = 0;
      return {
        getSize: async () => content.length,
        readNext: (len: number) =>
          new Promise<Uint8Array>(resolve => {
            const read = () => {
              const chunk = content.slice(offset, offset + len);
              offset += chunk.length;
              resolve(chunk);
            };
            if (gated) {
              pendingReads.push(read);
            } else {
              read();
            }
          }),
      };
    },
  };
  return file;
}

function setup(initialPath: string) {
  const path = ref(initialPath);
  const stats = ref<ListingEntryExtended | null>(null);
  const setStats = (p: string) => {
    stats.value = { id: p, name: p, fullPath: p, type: 'file', size: 3, mtime: MTIME } as ListingEntryExtended;
  };
  setStats(initialPath);
  const hashing = useFileHashing(
    computed(() => 'user-synced'),
    computed(() => path.value),
    stats,
  );
  return { path, setStats, hashing };
}

const sha = (alg: string, data: Uint8Array) => createHash(alg).update(data).digest('hex');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => files.clear());

describe('useFileHashing', () => {
  it('computes and caches SHA-256 and SHA-512 of the whole file', async () => {
    const data = new TextEncoder().encode('abc');
    const a = createFile(data);
    files.set('a.txt', a);
    const { hashing } = setup('a.txt');

    await hashing.calculateHash();

    expect(hashing.sha256hex.value).toBe(sha('sha256', data));
    expect(hashing.sha512hex.value).toBe(sha('sha512', data));
    expect(a.xattrs['cached-hashes']).toMatchObject({
      contentLen: 3,
      hashes: { 'SHA-256': sha('sha256', data), 'SHA-512': sha('sha512', data) },
    });
  });

  // Regression for plan 1.10: a stopped run used to digest partial data, show
  // it and cache it into the xattrs of the file that was opened next.
  it('does not show or cache anything after being stopped and switched to another file', async () => {
    const a = createFile(new Uint8Array(1024 * 1024).fill(1), { gated: true });
    const b = createFile(new TextEncoder().encode('xyz'));
    files.set('a.bin', a);
    files.set('b.txt', b);
    const { path, setStats, hashing } = setup('a.bin');

    const run = hashing.calculateHash();
    await flush();
    a.release(); // first chunk of A is read, hashing is in progress
    await flush();

    // the user clicks another file: the panel stops hashing and opens B
    hashing.stopHashingProcess();
    path.value = 'b.txt';
    setStats('b.txt');
    await hashing.loadHashing();

    await a.releaseAll();
    await run;

    expect(hashing.sha256hex.value).toBeNull();
    expect(hashing.sha512hex.value).toBeNull();
    expect(a.updateXAttrs).not.toHaveBeenCalled();
    expect(b.updateXAttrs).not.toHaveBeenCalled();
  });
});
