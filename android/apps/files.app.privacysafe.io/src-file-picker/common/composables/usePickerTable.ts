import dayjs from 'dayjs';
import type { Ui3nTableProps } from '@v1nt1248/3nclient-lib';
import type { PickerFile, PickerTableRow } from '@picker/common/types';
import { useI18n } from 'vue-i18n';

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function sortRows(
  rows: PickerTableRow[],
  field: keyof PickerTableRow,
  direction: 'asc' | 'desc',
): PickerTableRow[] {
  return [...rows].sort((a, b) => {
    if (a.isFolder !== b.isFolder) {
      return a.isFolder ? -1 : 1;
    }

    const aVal = a[field];
    const bVal = b[field];

    const cmp =
      typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal), undefined, {
            numeric: true,
            sensitivity: 'base',
          });

    return direction === 'asc' ? cmp : -cmp;
  });
}

const SORTABLE_FIELDS = ['name', 'type', 'size', 'displayingDate'] as const;

export function usePickerTable() {
  const { t } = useI18n();

  function prepareTableData(
    entries: PickerFile[],
    multiSelections: boolean,
    sortBy: string,
    sortOrder: 'asc' | 'desc',
  ): Ui3nTableProps<PickerTableRow> {
    const content: PickerTableRow[] = entries.map(entry => ({
      id: entry.id,
      name: entry.name,
      isFolder: entry.isFolder,
      type: entry.isFolder ? '' : getExtension(entry.name),
      size: entry.isFolder ? 0 : (entry.size ?? 0),
      displayingDate: entry.ctime ? dayjs(entry.ctime).format('YYYY-MM-DD') : '',
    }));

    const field = (SORTABLE_FIELDS as readonly string[]).includes(sortBy)
      ? (sortBy as keyof PickerTableRow)
      : 'name';

    return {
      config: {
        fieldAsRowKey: 'id',
        selectable: multiSelections ? 'multiple' : 'single',
        sortOrder: { field, direction: sortOrder },
        columnStyle: {
          name: { width: 'calc(98% - 232px)' },
          type: { width: '75px', paddingLeft: '4px' },
          size: { width: '75px', paddingLeft: '6px' },
          displayingDate: { width: '78px', paddingLeft: '6px' },
        },
        showNoDataMessage: true,
      },
      head: [
        { key: 'name', text: t('fs.table.header.name'), sortable: true },
        { key: 'type', text: t('fs.table.header.type'), sortable: true },
        { key: 'size', text: t('fs.table.header.size'), sortable: true },
        { key: 'displayingDate', text: t('fs.table.header.date'), sortable: true },
      ],
      body: { content: sortRows(content, field, sortOrder) },
    };
  }

  return { prepareTableData };
}
