/** One id per navigable RootFsFolderView. */
export type PickerRootId = string;

export type PickerLoadStatus = 'idle' | 'loading' | 'error' | 'ready';

export interface PickerFile {
  /** Full path from the selected root; also used as the stable table row id. */
  id: string;
  name: string;
  isFolder: boolean;
  size?: number;
  ctime?: Date;
}

export interface PickerTableRow {
  id: string;
  name: string;
  isFolder: boolean;
  type: string;
  size: number;
  displayingDate: string;
}

export interface PickerWindowState {
  currentPath: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  entries: PickerFile[];
  status: PickerLoadStatus;
  error?: unknown;
}

export interface PickerState {
  activeRootId: PickerRootId;
  windows: Record<PickerRootId, PickerWindowState>;
}
