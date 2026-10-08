/// <reference path="../@types/platform-defs/injected-w3n.d.ts" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  FavoriteFolder,
  FsListItem,
  ListingEntryExtended,
  RootFsFolderView,
  StorageAppConfig,
  StorageEvent,
  SyncQueueItem,
} from '../shared/types/index.ts';

export interface AppConfigService {
  appLocalFs: web3n.files.WritableFS;
  trashFolderName: string;
  getTrashFolderName(): Promise<string>;
  loadConfigFile(): Promise<StorageAppConfig | undefined>;
  saveConfigFile(value: StorageAppConfig): Promise<void>;
}

export interface FsStore {
  fsList: Record<string, FsListItem>;
  fsRootFolderList: RootFsFolderView[];
  getFsItem: (fsId: string) => Promise<FsListItem>;
  getFsList: () => Promise<Record<string, FsListItem>>;
  getFsRootFolderList: () => Promise<RootFsFolderView[]>;
  initializeFsItems: () => Promise<void>;
}

export interface FavoritesService {
  getFavorites: () => Promise<FavoriteFolder[]>;
  getFavorite: (favId: string) => Promise<FavoriteFolder | undefined>;
  addFavorite: (fullPath: string, fsId: string, withoutSaveDbFile?: boolean) => Promise<FavoriteFolder>;
  updateFavorite: (value: FavoriteFolder) => Promise<void>;
  deleteFavorite: (favId: string, returnUpdatedList?: boolean) => Promise<FavoriteFolder[] | undefined>;
}

export interface SyncService {
  getSyncQueue: () => Promise<Record<string, SyncQueueItem>>;
  isSyncQueueItemPresence: (path: string) => Promise<boolean>;
  addSyncQueueItem: (item: SyncQueueItem, withoutSaveDbFile?: boolean) => Promise<void>;
  updateSyncQueueItem: (item: SyncQueueItem) => Promise<void>;
  deleteSyncQueueItem: (path: string) => Promise<void>;
  clearSubtreeFromQueue: (path: string) => Promise<void>;
  resetItemAttempts: (path: string) => Promise<void>;
  startSyncUpload: (payload: {
    path: string;
    opts?: web3n.files.OptionsToUploadLocal;
    stopErrorPropagate?: boolean;
  }) => Promise<{ uploadVersion: number; uploadTaskId: number } | undefined>;
  startSyncDownload: (payload: {
    path: string;
    version: number;
    stopErrorPropagate?: boolean;
  }) => Promise<{ downloadTaskId: number } | undefined>;
  startSyncAdopt: (payload: {
    path: string;
    opts?: web3n.files.OptionsToAdopteRemote;
    stopErrorPropagate?: boolean;
  }) => Promise<void>;
}

export interface EntitySyncStatus extends Omit<web3n.files.SyncStatus, 'state'> {
  state: web3n.files.SyncState | 'remote';
}

export interface FsService {
  setFolderAsFavorite: (payload: { fsId: string; fullPath: string }) => Promise<FavoriteFolder[] | undefined>;
  unsetFolderAsFavorite: (payload: {
    fsId: string;
    id: string;
    fullPath: string;
  }) => Promise<FavoriteFolder[] | undefined>;
  removeFavoriteFolderFromList: (id: string) => Promise<FavoriteFolder[] | undefined>;

  isEntityPresent: (payload: {
    fsId: string;
    path: string;
    type?: 'folder' | 'file' | 'link';
  }) => Promise<boolean>;

  getEntityXAttrs: <T>(payload: {
    fsId: string;
    fullPath: string;
    attrName: string;
    version?: number;
  }) => Promise<T | undefined>;

  updateEntityXAttrs: (payload: {
    fsId: string;
    path: string;
    attrs: Record<string, any | undefined>;
  }) => Promise<void>;

  deleteEntityXAttrs: (payload: { fsId: string; path: string; attrNames: string[] }) => Promise<void>;

  getEntityStats: (payload: {
    fsId: string;
    fullPath: string;
    version?: number;
  }) => Promise<(ListingEntryExtended & { thumbnail?: string }) | undefined>;

  getSyncedStatus: (payload: {
    fsId: string;
    fullPath: string;
    stopErrorPropagate?: boolean;
  }) => Promise<EntitySyncStatus | undefined>;

  isRemoteVersionOnDisk: (payload: {
    fsId: string;
    fullPath: string;
    version: number;
  }) => Promise<'partial' | 'complete' | 'none' | undefined>;

  makeFolder: ({ fsId, path }: { fsId: string; path: string }) => Promise<string | undefined>;

  getFolderContentList: (payload: {
    fsId: string;
    path: string;
    version?: number;
  }) => Promise<web3n.files.ListingEntry[]>;

  getFolderContentFilledList: (payload: {
    fsId: string;
    path: string;
    basePath?: string;
    operatingSystem: 'macos' | 'linux' | 'windows';
    version?: number;
  }) => Promise<ListingEntryExtended[]>;

  copyEntities: (payload: {
    fsId: string;
    entities: ListingEntryExtended[];
    targetFsId: string;
    targetFolder: string;
  }) => Promise<PromiseSettledResult<string | undefined>[]>;

  moveEntity: (payload: {
    fsId: string;
    entity: ListingEntryExtended;
    targetFsId: string;
    newPath: string;
  }) => Promise<string>;

  moveEntities: (payload: {
    fsId: string;
    entities: ListingEntryExtended[];
    targetFsId: string;
    targetFolder: string;
  }) => Promise<Record<string, string>>;

  copyMoveEntities: (payload: {
    sourceFsId: string;
    entities: ListingEntryExtended[];
    targetFsId: string;
    target: ListingEntryExtended;
    moveMode?: boolean;
  }) => Promise<void>;

  renameEntity: (payload: { fsId: string; entity: ListingEntryExtended; newName: string }) => Promise<void>;

  deleteEntities: (payload: {
    fsId: string;
    entities: Pick<ListingEntryExtended, 'fullPath' | 'type' | 'name'>[];
    completely?: boolean;
  }) => Promise<Record<string, string> | boolean | undefined>;

  restoreEntities: (payload: {
    fsId: string;
    entities: ListingEntryExtended[];
    mode?: 'keep' | 'replace';
  }) => Promise<Record<string, string> | undefined>;
}

export interface StorageAppDenoService
  extends
    Omit<AppConfigService, 'appLocalFs' | 'trashFolderName'>,
    FavoritesService,
    FsService,
    SyncService,
    Omit<FsStore, 'fsList' | 'fsRootFolderList'> {
  watchEvent(obs: web3n.Observer<StorageEvent>): () => void;
}
