import type { Ref } from 'vue';
import type { StorageAppSettings } from '../../shared/types/app.types.ts';
import type { FavoriteFolder, SyncQueueItem } from '../../shared/types/services.types.ts';

export type Nullable<T> = T | null;

export interface StorageAppConfig extends StorageAppSettings {
  trashFolderName: string;
}

export interface StorageChangeSyncStatusEvent {
  event: 'syncstatus:change';
  payload: {
    path: string;
    status: web3n.files.SyncState | 'remote';
  };
}

export interface StorageAroseConflictEvent {
  event: 'arose:conflict';
  payload: {
    path: string;
  };
}

export interface StorageUploadStartEvent {
  event: 'upload:start';
  payload: {
    path: string;
  };
}

export interface StorageUploadEndEvent {
  event: 'upload:end';
  payload: {
    path: string;
  };
}

export interface StorageUploadProgressEvent {
  event: 'upload:progress';
  payload: {
    path: string;
    progress: number;
  };
}

export interface StorageDownloadStartEvent {
  event: 'download:start';
  payload: {
    path: string;
  };
}

export interface StorageDownloadEndEvent {
  event: 'download:end';
  payload: {
    path: string;
  };
}

export interface StorageDownloadProgressEvent {
  event: 'download:progress';
  payload: {
    path: string;
    progress: number;
  };
}

export interface StorageAdoptStartEvent {
  event: 'adoptRemote:start';
  payload: {
    path: string;
  };
}

export interface StorageAdoptEndEvent {
  event: 'adoptRemote:end';
  payload: { path: string; isNecessaryReread?: boolean };
}

export interface StorageErrorEvent {
  event: 'sync:error';
  payload: { path: string; message?: string };
}

export interface StorageEntityUpdate {
  event: 'entity:update';
  payload: { fsId: string; path: string; nodeId?: string; changedValues?: string[] };
}

/* -------------------- */

export interface StorageConnectionStatusEvent {
  event: 'connectivity:change';
  payload: {
    isOnline: boolean;
  };
}

export interface StorageFavoritesUpdateEvent {
  event: 'favorites:update';
  payload: { favorites: FavoriteFolder[] };
}

export interface StorageSyncQueueItemAddEvent {
  event: 'sync_queue:item:add';
  payload: { item: SyncQueueItem };
}

export interface StorageSyncQueueItemRemoveEvent {
  event: 'sync_queue:item:remove';
  payload: { path: string };
}

export interface StorageSyncQueueItemUpdateEvent {
  event: 'sync_queue:item:update';
  payload: { item: SyncQueueItem };
}

export interface StorageSyncQueueUpdateEvent {
  event: 'sync_queue:update';
  payload: { syncQueue: Record<string, SyncQueueItem> };
}

export interface StorageFsSyncErrorEvent {
  event: 'fs_sync:error';
  payload: { failedAction: string };
}

export type StorageEvent =
  | StorageAroseConflictEvent
  | StorageChangeSyncStatusEvent
  | StorageUploadStartEvent
  | StorageUploadEndEvent
  | StorageUploadProgressEvent
  | StorageDownloadStartEvent
  | StorageDownloadEndEvent
  | StorageDownloadProgressEvent
  | StorageAdoptStartEvent
  | StorageAdoptEndEvent
  | StorageErrorEvent
  | StorageEntityUpdate
  | StorageFavoritesUpdateEvent
  | StorageConnectionStatusEvent
  | StorageSyncQueueItemAddEvent
  | StorageSyncQueueItemRemoveEvent
  | StorageSyncQueueItemUpdateEvent
  | StorageSyncQueueUpdateEvent
  | StorageFsSyncErrorEvent;

export type StorageEventPayloadWithPath = Exclude<
  StorageEvent['payload'],
  | StorageConnectionStatusEvent['payload']
  | StorageFavoritesUpdateEvent['payload']
  | StorageSyncQueueItemAddEvent['payload']
  | StorageSyncQueueItemUpdateEvent['payload']
  | StorageSyncQueueUpdateEvent['payload']
  | StorageFsSyncErrorEvent['payload']
>;

export interface FsEntityInfoProps {
  fsId: string;
  path: string;
  windowIndex?: '1' | '2';
}

export interface FsEntityInfoProvideProps {
  displayedFsEntityInfo: Ref<Nullable<FsEntityInfoProps>>;
  openFsEntityInfoBlock: (data: Nullable<FsEntityInfoProps>) => void;
}
