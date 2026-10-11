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
