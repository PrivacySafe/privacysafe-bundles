import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  size: 1000,
  link: null as null | { isFile?: boolean; isFolder?: boolean; targetName: string; version?: number },
}));

vi.mock('@/store', () => ({
  useFsStore: () => ({
    getFs: () => ({
      stat: async () => ({ size: env.size }),
      readonlyFile: async (path: string) => ({ name: path }),
      readLink: async () => {
        const link = env.link!;
        return {
          isFile: link.isFile,
          isFolder: link.isFolder,
          target: async () => ({
            name: link.targetName,
            stat: async () => ({ size: env.size, version: link.version }),
          }),
        };
      },
    }),
  }),
}));
vi.mock('../../../src/utils/create-thumbnail/create-image-thumbnail.ts', () => ({
  createImageThumbnail: vi.fn(async (file: { name: string }) => `thumb:${file.name}`),
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
  env.link = null;
  vi.mocked(createImageThumbnail).mockClear();
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

describe('createThumbnail of a link to a file', () => {
  it('makes a thumbnail of the target, by the name of the target', async () => {
    env.link = { isFile: true, targetName: 'photo.png', version: 3 };

    expect(await createThumbnail('user-synced', 'link-to-photo', 1, { isLink: true })).toBe('thumb:photo.png');
  });

  it('returns null for a target of another group', async () => {
    env.link = { isFile: true, targetName: 'notes.txt', version: 3 };

    expect(await createThumbnail('user-synced', 'link.png', 1, { isLink: true })).toBeNull();
    expect(createImageThumbnail).not.toHaveBeenCalled();
  });

  it('returns null for a link to a folder', async () => {
    env.link = { isFolder: true, targetName: 'pics.png' };

    expect(await createThumbnail('user-synced', 'link', 1, { isLink: true })).toBeNull();
    expect(createImageThumbnail).not.toHaveBeenCalled();
  });

  it('caches by the version of the target', async () => {
    env.link = { isFile: true, targetName: 'photo.png', version: 3 };
    await createThumbnail('user-synced', 'link', 1, { isLink: true });
    await createThumbnail('user-synced', 'link', 1, { isLink: true });
    expect(createImageThumbnail).toHaveBeenCalledTimes(1);

    env.link.version = 4;
    await createThumbnail('user-synced', 'link', 1, { isLink: true });
    expect(createImageThumbnail).toHaveBeenCalledTimes(2);
  });

  it('does not read a target above the size limit', async () => {
    env.size = THUMBNAIL_SOURCE_SIZE_LIMIT + 1;
    env.link = { isFile: true, targetName: 'photo.png', version: 3 };

    expect(await createThumbnail('user-synced', 'link', 1, { isLink: true })).toBeNull();
    expect(createImageThumbnail).not.toHaveBeenCalled();
  });
});
