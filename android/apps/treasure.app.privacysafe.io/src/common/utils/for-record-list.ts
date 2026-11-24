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
import type { TreasureRecord } from '@shared/@types';

export function prepareRecordList(
  list: TreasureRecord[] = [],
  processedSearchText: string,
  sortTreasuresTableData?: (
    a: TreasureRecord,
    b: TreasureRecord,
    field: keyof TreasureRecord,
    direction: 'asc' | 'desc',
  ) => 0 | 1 | -1,
) {
  return list
    .filter(r => {
      const { resource = '', name = '', username = '' } = r;
      const processedResource = resource.toLowerCase();
      const processedName = name.toLowerCase() || '';
      const processedUsername = username.toLowerCase() || '';

      const isResourceCompliant = processedResource.includes(processedSearchText);
      const isNameCompliant = processedName.includes(processedSearchText);
      const isUsernameCompliant = processedUsername.includes(processedSearchText);
      return isResourceCompliant || isNameCompliant || isUsernameCompliant;
    })
    // Ascending: the list reads A to Z. The table asks for its own direction,
    // which the user picks in its header.
    .sort((a, b) => (sortTreasuresTableData ? sortTreasuresTableData(a, b, 'name', 'asc') : 0));
}

/**
 * What an empty record list says instead of rows.
 *
 * - `loading`: the records are still being read. Each record is a file of its
 *   own in the synced storage, so the first reading takes a while, and an empty
 *   list in the meantime would read as "you have nothing stored".
 * - `failed`: the reading failed and there is nothing to show.
 * - `no-matches`: there are records, the search leaves none of them.
 * - `no-records`: there are no records at all.
 * - `group-empty`: there are records, just none in the selected group.
 */
export type RecordListPlaceholder = 'loading' | 'failed' | 'no-matches' | 'no-records' | 'group-empty';

export function getRecordListPlaceholder({
  areRecordsLoaded,
  recordsLoadFailed,
  totalRecords,
  shownRecords,
  searchText,
}: {
  areRecordsLoaded: boolean;
  recordsLoadFailed: boolean;
  totalRecords: number;
  shownRecords: number;
  searchText: string;
}): RecordListPlaceholder | null {
  if (shownRecords > 0) {
    return null;
  }
  if (!areRecordsLoaded) {
    return 'loading';
  }
  if (totalRecords === 0) {
    return recordsLoadFailed ? 'failed' : 'no-records';
  }
  return searchText.trim() ? 'no-matches' : 'group-empty';
}
