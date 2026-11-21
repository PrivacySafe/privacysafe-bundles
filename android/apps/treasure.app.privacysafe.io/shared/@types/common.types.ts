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
export type SyncType = 'upload' | 'adopt' | 'download';

export interface TreasureGroup {
  id: string;
  name: string;
  description?: string;
  withoutSync?: boolean;
}

export interface TreasureBaseRecord {
  id: string;
  resource: string;
  group?: string;
  source?: string;
  reference?: string;
  isFavorite?: boolean;
  withoutSync?: boolean;
  mtime?: Date;
}

export interface TreasurePasswordRecord extends TreasureBaseRecord {
  type: 'password';
  name?: string;
  username: string;
  password: string;
}

export interface TreasureCardRecord extends TreasureBaseRecord {
  type: 'card';
  name?: string;
  username?: string;
  password?: string;
  images: string[];
}

export interface TreasureBankCardRecord extends TreasureBaseRecord {
  type: 'bank_card';
  name: string; // The record name
  username: string; // Cardholder name
  exp: string; // Expiration date (MM/YY)
  password: string; // Security code
  // resource: string; // Credit card number
}

export interface ProcessedImage {
  name: string;
  data: File | Uint8Array | null;
  isNew?: boolean;
  isTouched?: boolean;
  toDelete?: boolean;
}

export type TreasureRecord = TreasurePasswordRecord | TreasureCardRecord | TreasureBankCardRecord;

export interface TreasureSyncStartEvent {
  event: 'sync:start';
  payload: {
    path: string;
    type: SyncType;
  };
}

export interface TreasureSyncUpdateEvent {
  event: 'sync:update';
  payload: {
    path: string;
    type: SyncType;
    value: number;
  };
}

export interface TreasureSyncEndEvent {
  event: 'sync:end';
  payload: {
    path: string;
    type: SyncType;
    error?: string;
  };
}

export interface TreasureAddEvent {
  event: 'add:record';
  payload: {
    data: string[];
  };
}

export interface TreasureRemoveEvent {
  event: 'remove:record';
  payload: {
    data: string[];
  };
}

export interface TreasureUpdateEvent {
  event: 'update:record';
  payload: {
    data: string;
  };
}

export interface TreasureGroupUpdateEvent {
  event: 'update:group';
}

export interface TreasureRecordsUpdateEvent {
  event: 'update:records';
}

/** Reason an archive cannot be used. Mapped to a message in the gui. */
export type BackupArchiveError =
  | 'corrupted_archive'
  | 'foreign_archive'
  | 'passphrase_required'
  | 'wrong_passphrase'
  | 'encryption_unsupported';

export interface BackupValidationResult {
  valid: boolean;
  compatible: boolean;
  appVersion: string;
  archiveVersion?: string;
  formatVersion?: number;
  /** Whether the archive the user picked was passphrase-protected. */
  encrypted?: boolean;
  recordsCount?: number;
  groupsCount?: number;
  warningReason?: 'missing_metadata' | 'invalid_metadata' | 'version_mismatch';
  error?: BackupArchiveError;
}

export interface BackupProgress {
  stage: 'start' | 'scanning' | 'compressing' | 'encrypting' | 'saving' | 'completed' | 'error' | 'cancelled';
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
  percent: number;
}

export interface TreasureBackupEvent {
  event: 'backup';
  payload: BackupProgress;
}

export interface RestoreProgress {
  stage: 'unpacking' | 'decrypting' | 'restoring' | 'syncing' | 'completed' | 'error';
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
  percent: number;
}

export interface TreasureRestoreEvent {
  event: 'restore';
  payload: RestoreProgress;
}

export type TreasureEvent =
  | TreasureSyncStartEvent
  | TreasureSyncUpdateEvent
  | TreasureSyncEndEvent
  | TreasureAddEvent
  | TreasureRemoveEvent
  | TreasureUpdateEvent
  | TreasureGroupUpdateEvent
  | TreasureRecordsUpdateEvent
  | TreasureBackupEvent
  | TreasureRestoreEvent;
