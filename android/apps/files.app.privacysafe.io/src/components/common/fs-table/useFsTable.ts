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
import { type ComputedRef } from 'vue';
import dayjs from 'dayjs';
import { useSort } from '@/composables/useSort';
import type { Ui3nTableProps } from '@v1nt1248/3nclient-lib';
import type { ListingEntryExtended } from '@shared/types';

export function useFsTable(tableWindow: ComputedRef<'1' | '2'>) {
  const { changeSort, sortFolderData } = useSort(tableWindow);

  function prepareFolderDataTable(
    data: ListingEntryExtended[],
    tableName: string,
    t: (key: string, placeholders?: Record<string, string>) => string,
    isSyncTable?: boolean,
  ): Ui3nTableProps<ListingEntryExtended> {
    const tableDataConfig: Ui3nTableProps<ListingEntryExtended> = {
      config: {
        tableName,
        fieldAsRowKey: 'id',
        selectable: 'multiple',
        columnStyle: {
          name: { width: isSyncTable ? 'calc(100% - 328px)' : 'calc(100% - 238px)' },
          type: { width: '68px' },
          size: { width: '80px' },
          ...(isSyncTable && { sync: { width: '90px' } }),
          displayingCTime: { width: '90px' },
        },
        showNoDataMessage: false,
      },
      head: [
        { key: 'name', text: t('fs.table.header.name'), sortable: true },
        { key: 'type', text: t('fs.table.header.type'), sortable: true },
        { key: 'size', text: t('fs.table.header.size'), sortable: true },
      ],
      body: {
        content: data.map(item => ({
          ...item,
          size: item.size || 0,
          displayingCTime: item.ctime ? dayjs(item.ctime).format('YYYY-MM-DD') : '',
        })),
      },
    };

    if (isSyncTable) {
      tableDataConfig.head.push({
        key: 'sync',
        text: t('fs.table.header.sync'),
        sortable: false,
      });
    }

    tableDataConfig.head.push({
      key: 'displayingCTime',
      text: t('fs.table.header.date'),
      sortable: true,
    });

    return tableDataConfig;
  }

  return {
    changeSort,
    prepareFolderDataTable,
    sortFolderData,
  };
}
