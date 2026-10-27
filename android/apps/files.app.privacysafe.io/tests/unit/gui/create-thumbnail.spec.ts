import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ size: 1000 }));

vi.mock('@/store', () => ({
  useFsStore: () => ({
    getFs: () => ({ stat: async () => ({ size: env.size }) }),
  }),
}));
vi.mock('../../../src/utils/create-thumbnail/create-image-thumbnail.ts', () => ({
  createImageThumbnail: vi.fn(async (_fs: unknown, path: string) => `thumb:${path}`),
}));
vi.mock('../../../src/utils/create-thumbnail/create-video-thumbnail.ts', () => ({
  createVideoThumbnail: vi.fn(async () => 'thumb:video'),
}));
vi.mock('../../../src/utils/create-thumbnail/create-pdf-thumbnail.ts', () => ({
  createPdfThumbnail: vi.fn(async () => 'thumb:pdf'),
}));

const { createThumbnail, clearThumbnailCache } = await import('../../../src/utils/create-thumbnail/index.ts');
const { createImageThumbnail } = await import('../../../src/utils/create-thumbnail/create-image-thumbnail.ts');
const { THUMBNAIL_SOURCE_SIZE_LIMIT } = await import('../../../src/constants/thumbnails.ts');

beforeEach(() => {
  clearThumbnailCache();
  env.size = 1000;
});

// Regression for plan 7.2: thumbnails were made again on every visit of a folder
// and for files of any size, reading each file whole into memory.
describe('createThumbnail', () => {
  it('reuses a thumbnail of the same file version', async () => {
    expect(await createThumbnail('user-synced', 'a.png', 7)).toBe('thumb:a.png');
    expect(await createThumbnail('user-synced', 'a.png', 7)).toBe('thumb:a.png');

    expect(createImageThumbnail).toHaveBeenCalledTimes(1);
  });

  it('makes a new thumbnail for a new file version', async () => {
    await createThumbnail('user-synced', 'a.png', 7);
    await createThumbnail('user-synced', 'a.png', 8);

    expect(createImageThumbnail).toHaveBeenCalledTimes(2);
  });

  it('does not read files above the size limit', async () => {
    env.size = THUMBNAIL_SOURCE_SIZE_LIMIT + 1;

    expect(await createThumbnail('user-synced', 'huge.png', 1)).toBeNull();
    expect(createImageThumbnail).not.toHaveBeenCalled();
  });

  it('returns null for other file types without touching the file', async () => {
    expect(await createThumbnail('user-synced', 'notes.txt', 1)).toBeNull();
    expect(createImageThumbnail).not.toHaveBeenCalled();
  });

  it('does not cache without a cache tag', async () => {
    await createThumbnail('user-synced', 'a.png');
    await createThumbnail('user-synced', 'a.png');

    expect(createImageThumbnail).toHaveBeenCalledTimes(2);
  });
});
