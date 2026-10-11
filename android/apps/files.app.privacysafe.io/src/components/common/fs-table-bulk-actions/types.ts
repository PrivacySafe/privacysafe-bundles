import type { ListingEntryExtended } from '@shared/types';

export type FsTableBulkActionName =
  | 'set:favorite'
  | 'copy/move'
  | 'download'
  | 'restore'
  | 'delete'
  | 'delete:completely'
  | 'resolve';

export type FsTableBulkActions = Partial<
  Record<
    FsTableBulkActionName,
    {
      icon: string;
      iconColor?: string;
      tooltip?: string;
    }
  >
>;

export interface FsTableBulkActionsProps {
  windowIndex: 1 | 2;
  isInSplitMode: boolean;
  fsId: string;
  rootFolderId: string;
  folderPath: string;
  selectedEntities: ListingEntryExtended[];
  isMoveMode?: boolean;
  isMoveModeQuick?: boolean;
  disabled?: boolean;
}

export interface FsTableBulkActionsEmits {
  (event: 'action', value: { action: FsTableBulkActionName; payload?: unknown }): void;
  (event: 'update:move-mode', value: boolean): void;
}
