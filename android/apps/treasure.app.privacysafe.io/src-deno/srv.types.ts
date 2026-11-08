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
import type {
  TreasureEvent,
  TreasureGroup,
  TreasureRecord,
} from '../shared/@types/common.types.ts';

export interface TreasureDenoSrv {
  emitTreasureEvent: (event: TreasureEvent) => void;
  watchEvent: (obs: web3n.Observer<TreasureEvent>) => () => void;

  rewriteGroups: (data: TreasureGroup[]) => Promise<boolean>;
  getAllTreasureGroups: () => Promise<TreasureGroup[] | null | undefined>;

  loadRecentFile: () => Promise<string[]>;
  saveRecentFile: (data: string[]) => Promise<void>;

  /**
   * With `forEncryption` the archive comes back without its metadata file: the
   * gui encrypts it and puts the metadata into the container around it.
   */
  createBackupArchive: (opts?: { forEncryption?: boolean }) => Promise<Uint8Array>;
  cancelBackupArchive: () => Promise<boolean>;
  /** Takes the archive already decrypted by the gui, when it was protected. */
  restoreBackupArchive: (archiveBytes: Uint8Array) => Promise<boolean>;

  loadImage: (imageId: string) => Promise<Uint8Array | undefined>;
  saveImage: (data: { bytes: Uint8Array; id?: string }) => Promise<string>;
  deleteImages: (fileIds: string[]) => Promise<void>;

  addRecord: (
    data: TreasureRecord,
    withoutUploadParentFolder?: boolean,
  ) => Promise<{ id: string; wasSync?: boolean }>;
  updateRecord: (data: TreasureRecord) => Promise<boolean>;
  deleteRecord: (data: TreasureRecord, withoutUploadParentFolder?: boolean) => Promise<boolean>;
  deleteRecords: (ids: string[]) => Promise<boolean>;
  getRecord: (id: string) => Promise<TreasureRecord | null>;
  getRecordSyncStatus: (id: string) => Promise<web3n.files.SyncStatus | undefined>;
  getAllRecords: () => Promise<{ records: TreasureRecord[]; errors: unknown[] }>;
  initial: () => Promise<void>;
}

export type TreasureDenoSrvInternal = Omit<TreasureDenoSrv, 'fs' | 'emitTreasureEvent'>;

export interface TreasureFileSrv {
  loadRecentFile: () => Promise<string[]>;
  saveRecentFile: (data: string[]) => Promise<void>;
  saveFile: (data: TreasureRecord | TreasureGroup[], fileName?: string) => Promise<string>;
  saveImage: (data: { bytes: Uint8Array; id?: string }) => Promise<string>;
  updateFile: (data: TreasureRecord | TreasureGroup[], fileName?: string) => Promise<void>;
  getFile: <T>(fileName: string) => Promise<(T extends TreasureRecord ? TreasureRecord : TreasureGroup[]) | null>;
  loadImage: (fileId: string) => Promise<Uint8Array | undefined>;
  deleteFile: (fileName: string) => Promise<void>;
  deleteFiles: (currentRecordFileName: string[]) => Promise<void>;
}
