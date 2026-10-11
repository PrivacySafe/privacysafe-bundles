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
import { useRouter } from 'vue-router';
import size from 'lodash/size';
import { APP_ROUTES } from '@/common/constants';
import type { TreasureRecord } from '@shared/@types';

export function useSort() {
  const router = useRouter();

  async function changeSort<T extends TreasureRecord>({
    field,
    direction,
  }: {
    field: keyof T;
    direction: 'asc' | 'desc';
  }) {
    const newRouterData = {
      name: APP_ROUTES.RECORD_LIST,
      query: {
        sortBy: field as string,
        sortOrder: direction,
      },
    };
    return router.push(newRouterData);
  }

  function getRecordFieldValue(record: TreasureRecord, field: keyof TreasureRecord) {
    if (field === 'name') {
      return `${record.name || record.resource}${record.resource}`;
    }

    if ('username' in record) {
      return record.username as string;
    }

    return size(record.images);
  }

  /**
   * Answers the way a comparator does: negative when `aValue` comes first,
   * zero when the two are equal. Numbers are compared as numbers, and anything
   * else as text, ignoring case.
   */
  function compareValues(aValue: string | number, bValue: string | number): 0 | 1 | -1 {
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return Math.sign(aValue - bValue) as 0 | 1 | -1;
    }

    const a = `${aValue}`.toLowerCase();
    const b = `${bValue}`.toLowerCase();
    return (a === b) ? 0 : (a < b ? -1 : 1);
  }

  function sortTreasuresTableData(
    a: TreasureRecord,
    b: TreasureRecord,
    field: keyof TreasureRecord,
    direction: 'asc' | 'desc',
  ): 0 | 1 | -1 {
    if (!['name', 'username'].includes(field as keyof TreasureRecord as string)) {
      return 0;
    }

    const order = compareValues(getRecordFieldValue(a, field), getRecordFieldValue(b, field));
    if (order === 0) {
      return 0;
    }

    return (direction === 'asc' ? order : -order) as 1 | -1;
  }

  /**
   * Recent records arrive in the order they were opened in, and that order is
   * the whole point of the list - so nothing is reordered here, whichever
   * direction is asked for. Answering zero keeps them as they came: Array.sort
   * is stable.
   */
  function sortTreasuresRecentData(): 0 {
    return 0;
  }

  return {
    changeSort,
    sortTreasuresTableData,
    sortTreasuresRecentData,
  };
}
