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
import { useI18n } from 'vue-i18n';
import type { Ui3nTableHeadProps, Ui3nTableProps } from '@v1nt1248/3nclient-lib';
import type { TreasureRecord } from '@shared/@types';
import { useSort } from '@/common/composables/use-sort.ts';
import { ComputedRef } from 'vue';
import { DEFAULT_GROUP } from '@shared/constants.ts';

export function useTreasuresTable() {
  const { t } = useI18n();
  const { changeSort, sortTreasuresTableData } = useSort();

  function prepareTreasuresTableData(data: TreasureRecord[], selectedGroup: ComputedRef<string>) {
    const tableDataHead: Ui3nTableHeadProps<
      TreasureRecord & {
        sync?: string;
      }
    >[] = [
      { key: 'name', text: t('treasuresTable.header.name'), sortable: true },
      { key: 'sync', text: t('treasuresTable.header.sync') },
      {
        key: 'username',
        text:
          selectedGroup.value === DEFAULT_GROUP.CARDS
            ? t('treasuresTable.header.photo')
            : selectedGroup.value === DEFAULT_GROUP.BANK_CARDS
              ? t('treasuresTable.header.holderName')
              : t('treasuresTable.header.username'),
        sortable: true,
      },
    ];

    if (selectedGroup.value !== DEFAULT_GROUP.CARDS) {
      tableDataHead.push({
        key: 'password',
        text:
          selectedGroup.value === DEFAULT_GROUP.BANK_CARDS
            ? t('treasuresTable.header.cvv')
            : t('treasuresTable.header.password'),
      });
    }

    const tableDataConfig: Ui3nTableProps<TreasureRecord & { sync?: string }> = {
      config: {
        fieldAsRowKey: 'id',
        columnStyle: {
          name: {
            width: selectedGroup.value === DEFAULT_GROUP.CARDS ? 'calc(100% - 348px)' : 'calc(100% - 524px)',
          },
          sync: { width: '92px' },
          username: { width: '256px' },
          ...(selectedGroup.value !== DEFAULT_GROUP.CARDS && { password: { width: '176px' } }),
        },
        showNoDataMessage: false,
      },
      head: tableDataHead,
      body: {
        content: data,
      },
    };

    return tableDataConfig;
  }

  return {
    prepareTreasuresTableData,
    changeSort,
    sortTreasuresTableData,
  };
}
