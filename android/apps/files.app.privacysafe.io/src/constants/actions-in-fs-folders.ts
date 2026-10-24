import type { FsTableBulkActions } from '@/components/common/fs-table-bulk-actions/types';

export const FS_TABLE_BULK_ACTIONS: FsTableBulkActions = {
  'set:favorite': {
    icon: 'outline-bookmark-add',
    tooltip: 'fs.bulk_action.tooltip.set-favorite',
  },
  download: {
    icon: 'outline-download-for-offline',
    tooltip: 'fs.bulk_action.tooltip.download',
  },
  resolve: {
    icon: 'cloud-alert-outline-rounded',
    tooltip: 'fs.bulk_action.tooltip.resolve',
  },
  delete: {
    icon: 'outline-delete',
    tooltip: 'fs.bulk_action.tooltip.delete',
  },
  'delete:completely': {
    icon: 'trash-can',
    iconColor: 'var(--error-content-default)',
    tooltip: 'fs.bulk_action.tooltip.delete_completely',
  },
  restore: {
    icon: 'round-refresh',
    tooltip: 'fs.bulk_action.tooltip.restore',
  },
  'copy/move': {
    icon: '',
    tooltip: 'fs.bulk_action.tooltip.copy_move',
  },
};
