/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
import type { FavoritesService } from '../../types.ts';

/**
 * Keeps favorites pointing to folders after a rename or a move: the moved
 * folder itself and every favorite folder inside it get the new path.
 */
export async function relocateFavorites({
  favoritesSrv,
  fsId,
  oldPath,
  newFsId,
  newPath,
}: {
  favoritesSrv: FavoritesService;
  fsId: string;
  oldPath: string;
  newFsId: string;
  newPath: string;
}): Promise<void> {
  const favorites = await favoritesSrv.getFavorites();

  for (const fav of favorites) {
    if (fav.fsId !== fsId) {
      continue;
    }

    if (fav.fullPath === oldPath || fav.fullPath.startsWith(`${oldPath}/`)) {
      await favoritesSrv.updateFavorite({
        favId: fav.favId,
        fsId: newFsId,
        fullPath: `${newPath}${fav.fullPath.slice(oldPath.length)}`,
      });
    }
  }
}
