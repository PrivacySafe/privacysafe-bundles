import type { ListingEntryExtended } from '@shared/types';

export const SORTABLE_FIELDS: Array<{
  field: keyof ListingEntryExtended;
  label: string;
}> = [
  {
    field: 'name',
    label: 'fs.table.header.name',
  },
  {
    field: 'type',
    label: 'fs.table.header.type',
  },
  {
    field: 'size',
    label: 'fs.table.header.size',
  },
  {
    field: 'displayingCTime',
    label: 'fs.table.header.date',
  },
];
