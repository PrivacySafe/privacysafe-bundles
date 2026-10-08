import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';

export type WritableFS = web3n.files.WritableFS;
export type ListingEntry = web3n.files.ListingEntry;
export type StorageUse = web3n.storage.StorageUse;
export type StorageType = web3n.storage.StorageType;
export type AttachmentsContainer = web3n.asmail.AttachmentsContainer;
export type FS = web3n.files.FS;
export type FileW = web3n.files.File;

export type AvailableLanguage = 'en';

export type ConnectivityStatus = 'offline' | 'online';

export type AppConfig = {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
  systemFoldersDisplaying?: boolean;
  customLogo?: string;
};

export interface AppConfigsInternal {
  getSettingsFile: () => Promise<AppSettings>;
  saveSettingsFile: (data: AppSettings) => Promise<void>;
  getCurrentLanguage: () => Promise<AvailableLanguage>;
  getCurrentColorTheme: () => Promise<ThemeId>;
  getSystemFoldersDisplaying: () => Promise<boolean>;
}

export interface AppConfigs {
  getCurrentLanguage: () => Promise<AvailableLanguage>;
  getCurrentColorTheme: () => Promise<ThemeId>;
  getSystemFoldersDisplaying: () => Promise<boolean>;
  watchConfig(obs: web3n.Observer<AppConfig>): () => void;
}

export interface SettingsJSON {
  lang: AvailableLanguage;
  colorTheme: ThemeId;
  systemFoldersDisplaying: boolean;
}

export interface AppSettings {
  currentConfig: SettingsJSON;
}

export interface StorageAppSettings {
  localFoldersDisplaying?: boolean;
  systemFoldersDisplaying?: boolean;
  deviceFoldersDisplaying?: boolean;
}

export interface AppGlobalEvents {
  'create:folder': { fsId: string; fullPath: string };
  'upload:file': { fsId: string; fullPath: string };
  'drag:end': void;
  'refresh:data': { path: string; withoutVerify?: boolean };
  'click:breadcrumb': void;
}

export interface FsListItem {
  fsId: string;
  name: string;
  entity: WritableFS;
}

export interface RootFsFolderView {
  id: string;
  fsId: string;
  name: string;
  icon: string;
  isSyncAvailable?: boolean;
  disabled?: boolean;
}

export interface ListingEntryExtended {
  id: string;
  name: string;
  fullPath: string;
  type: 'folder' | 'file' | 'link';
  ext?: string;
  size?: number;
  mtime?: Date;
  ctime?: Date;
  displayingCTime?: string;
  version?: number;
  bytesNeedDownload?: number;
  versionSyncBranch?: web3n.files.SyncBranch;
  parentFolder?: string;
  originalName?: string;
  thumbnail?: string;
  favoriteId?: string;
  tags?: string[];
  sync?: web3n.files.SyncState | 'remote';
  hidden?: string;
  brokeReason?: string;
}

export type FsFolderEntityEvent =
  | 'go'
  | 'go:linked-folder'
  | 'rename'
  | 'update:favorite'
  | 'open:info'
  | 'refresh:data';
