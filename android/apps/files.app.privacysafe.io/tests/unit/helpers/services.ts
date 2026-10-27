import { vi } from 'vitest';
import type { FavoriteFolder } from '../../../shared/types/index.ts';
import type { FavoritesService } from '../../../src_deno/types.ts';
import { fsService } from '../../../src_deno/services/fs.service.ts';
import { USER_FS } from '../../../shared/constants/index.ts';
import { MemoryFS } from './memory-fs.ts';

export const TRASH = '.trash-folder-test';

export function createFavorites(initial: FavoriteFolder[] = []) {
  let list = [...initial];

  const srv = {
    getFavorites: vi.fn(async () => [...list]),
    getFavorite: vi.fn(async (favId: string) => list.find(f => f.favId === favId)),
    addFavorite: vi.fn(async (fullPath: string, fsId: string) => {
      const fav = { favId: `fav-${list.length + 1}`, fsId, fullPath };
      list.push(fav);
      return fav;
    }),
    updateFavorite: vi.fn(async (value: FavoriteFolder) => {
      list = list.map(f => (f.favId === value.favId ? { ...f, ...value } : f));
    }),
    deleteFavorite: vi.fn(async (favId: string, returnUpdatedList?: boolean) => {
      list = list.filter(f => f.favId !== favId);
      return returnUpdatedList ? [...list] : undefined;
    }),
  } satisfies FavoritesService;

  return { srv, current: () => [...list] };
}

/**
 * Builds the real fsService (the one src_deno/index.ts uses) on top of an
 * in-memory FS registered as the user synced storage.
 */
export function createFsService({
  fs = new MemoryFS(),
  fsId = USER_FS,
  favorites = createFavorites(),
  trashFolderName = TRASH,
}: {
  fs?: MemoryFS;
  fsId?: string;
  favorites?: ReturnType<typeof createFavorites>;
  trashFolderName?: string;
} = {}) {
  const fsList = { [fsId]: fs.asFsListItem(fsId) };
  const srv = fsService({
    getFsItem: async (id: string) => {
      const item = fsList[id];
      if (!item) {
        throw new Error(`Unknown fsId '${id}' in test`);
      }
      return item;
    },
    favoritesSrv: favorites.srv,
    emitStorageEvent: vi.fn(),
    trashFolderName,
  });

  return { srv, fs, fsId, favorites };
}
