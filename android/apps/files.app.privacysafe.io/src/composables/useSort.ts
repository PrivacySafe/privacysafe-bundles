/*
 Copyright (C) 2025 3NSoft Inc.

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
import type { ComputedRef } from 'vue';
import { useNavigation } from '@/composables/useNavigation';
import type { ListingEntryExtended } from '@shared/types';

export function useSort(fsFolderWindow: ComputedRef<'1' | '2'>) {
  const { isSplittedMode, navigateToRouteSingle, navigateToRouteDouble } = useNavigation();

  async function changeSort(val: { field: keyof ListingEntryExtended; direction: 'asc' | 'desc' }) {
    if (isSplittedMode.value) {
      await navigateToRouteDouble({
        query: {
          ...(fsFolderWindow.value === '1' && {
            sortBy: val.field,
            sortOrder: val.direction,
          }),
          ...(fsFolderWindow.value === '2' && {
            sort2By: val.field,
            sort2Order: val.direction,
          }),
        },
      });
    } else {
      await navigateToRouteSingle({
        query: {
          sortBy: val.field,
          sortOrder: val.direction,
        },
      });
    }
  }

  function sortFolderData(
    a: ListingEntryExtended,
    b: ListingEntryExtended,
    field: keyof ListingEntryExtended,
    direction: 'asc' | 'desc',
  ): -1 | 1 {
    const aFieldValue = field === 'type' ? `${a.type === 'file' ? a.ext : '#'}-${a.name}` : a[field]!;
    const aFieldValueProcessed = typeof aFieldValue === 'string' ? aFieldValue.toLowerCase() : aFieldValue;

    const bFieldValue = field === 'type' ? `${b.type === 'file' ? b.ext : '#'}-${b.name}` : b[field]!;
    const bFieldValueProcessed = typeof bFieldValue === 'string' ? bFieldValue.toLowerCase() : bFieldValue;

    return aFieldValueProcessed > bFieldValueProcessed
      ? direction === 'desc'
        ? 1
        : -1
      : direction === 'desc'
        ? -1
        : 1;
  }

  return {
    changeSort,
    sortFolderData,
  };
}
