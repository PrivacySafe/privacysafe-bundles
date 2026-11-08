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
import { Zip, ZipDeflate, ZipPassThrough, unzip, type Unzipped } from 'fflate/browser';
import { GROUPS_FILE_NAME, IMAGES_FOLDER, RECENT_FILE_NAME } from '../shared/constants.ts';
import { sleep } from '../shared/processes/sleep.ts';
import {
  METADATA_FILE_NAME,
  isSafeArchivePath,
  makeBackupMetadataBytes,
} from '../shared/utils/backup-archive.ts';
import { checkServerConnection } from './utils/check-server-connection.ts';
import { checkItemSyncState, checkFolderSyncState } from './utils/check-sync-fs-state.ts';
import type { TreasureEvent } from '../shared/@types/index.ts';
import type { TreasureFileSrv } from './srv.types.ts';

const COMPRESSION_LEVEL = 6;

interface BackupMetadata {
  fileName: string;
  bytes: Uint8Array;
}

interface CompressBackupParams {
  fs: web3n.files.WritableFS;
  files: string[];
  /** Left out when the gui will encrypt: metadata then goes outside. */
  metadata?: BackupMetadata;
  signal: AbortSignal;
  emitEvent: (event: TreasureEvent) => void;
}

function checkAbortSignal(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Backup cancelled', 'AbortError');
  }
}

function mergeUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function areBytesEqual(a?: Uint8Array, b?: Uint8Array): boolean {
  if (!a || !b) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

async function decompressZip(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (err, unzipped) => {
      if (err) {
        reject(err);
      } else {
        resolve(unzipped);
      }
    });
  });
}

async function generateBackupMetadata(
  fs: web3n.files.WritableFS,
  files: string[],
): Promise<BackupMetadata> {
  const version = (await w3n.myVersion?.()) || '0.0.1';

  let groupsCount = 0;
  try {
    const groups = await fs.readJSONFile<unknown[]>(GROUPS_FILE_NAME);
    groupsCount = Array.isArray(groups) ? groups.length : 0;
  } catch {
    // No groups file yet, or it is not readable. Not worth failing a backup:
    // the count is informational, and the file itself is packed regardless.
  }

  const recordsCount = files.filter(
    path => path !== GROUPS_FILE_NAME && !path.startsWith(`${IMAGES_FOLDER}/`),
  ).length;

  return {
    fileName: METADATA_FILE_NAME,
    bytes: makeBackupMetadataBytes({ version, recordsCount, groupsCount }),
  };
}

function addFileToZip(zip: Zip, filePath: string, bytes: Uint8Array): void {
  const isImage = filePath.startsWith(`${IMAGES_FOLDER}/`);
  const zipEntry = isImage ? new ZipPassThrough(filePath) : new ZipDeflate(filePath, { level: COMPRESSION_LEVEL });
  zip.add(zipEntry);
  zipEntry.push(bytes, true);
}

async function compressFilesToZip({
  fs,
  files,
  metadata,
  signal,
  emitEvent,
}: CompressBackupParams): Promise<Uint8Array> {
  const totalFiles = files.length + (metadata ? 1 : 0);
  const chunks: Uint8Array[] = [];

  return new Promise<Uint8Array>((resolve, reject) => {
    let isEnded = false;

    const onAbort = () => {
      if (isEnded) {
        return;
      }
      isEnded = true;
      try {
        zip.terminate();
      } catch {
        // ignore
      }
      reject(new DOMException('Backup cancelled', 'AbortError'));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });

    const zip = new Zip((err, chunk, isLast) => {
      if (isEnded) {
        return;
      }

      if (err) {
        isEnded = true;
        signal.removeEventListener('abort', onAbort);
        try {
          zip.terminate();
        } catch {
          // ignore
        }
        emitEvent({
          event: 'backup',
          payload: {
            stage: 'error',
            totalFiles,
            processedFiles: 0,
            percent: 0,
          },
        });
        reject(err);
        return;
      }

      if (chunk) {
        chunks.push(chunk);
      }

      if (isLast) {
        isEnded = true;
        signal.removeEventListener('abort', onAbort);
        const finalBuffer = mergeUint8Arrays(chunks);
        emitEvent({
          event: 'backup',
          payload: {
            stage: 'completed',
            totalFiles,
            processedFiles: totalFiles,
            percent: 100,
          },
        });
        resolve(finalBuffer);
      }
    });

    (async () => {
      try {
        checkAbortSignal(signal);

        emitEvent({
          event: 'backup',
          payload: {
            stage: 'compressing',
            totalFiles,
            processedFiles: 0,
            currentFile: metadata?.fileName,
            percent: 0,
          },
        });

        if (metadata) {
          addFileToZip(zip, metadata.fileName, metadata.bytes);
        }

        const packedBeforeFiles = metadata ? 1 : 0;

        for (let i = 0; i < files.length; i++) {
          checkAbortSignal(signal);

          const filePath = files[i];
          const processedFiles = i + packedBeforeFiles + 1;

          emitEvent({
            event: 'backup',
            payload: {
              stage: 'compressing',
              totalFiles,
              processedFiles,
              currentFile: filePath,
              percent: Math.round((processedFiles / totalFiles) * 100),
            },
          });

          const fileBytes = (await fs.readBytes(filePath)) || new Uint8Array(0);
          await sleep(50);

          checkAbortSignal(signal);

          addFileToZip(zip, filePath, fileBytes);
        }

        checkAbortSignal(signal);

        zip.end();
      } catch (error) {
        if (!isEnded) {
          isEnded = true;
          signal.removeEventListener('abort', onAbort);
          try {
            zip.terminate();
          } catch {
            // ignore
          }
          reject(error);
        }
      }
    })();
  });
}

async function collectFilesFromFS(
  fs: web3n.files.WritableFS,
  dir = '',
  signal?: AbortSignal,
): Promise<string[]> {
  checkAbortSignal(signal);

  const entries = await fs.listFolder(dir);
  const filePaths: string[] = [];

  for (const entry of entries) {
    checkAbortSignal(signal);

    const fullPath = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isFolder) {
      const nested = await collectFilesFromFS(fs, fullPath, signal);
      filePaths.push(...nested);
    } else if (entry.isFile) {
      filePaths.push(fullPath);
    }
  }

  return filePaths;
}

export async function treasureBackupSrv({
  fs,
  fsLocal,
  fileSrv,
  emitEvent,
}: {
  fs: web3n.files.WritableFS;
  fsLocal: web3n.files.WritableFS;
  fileSrv: TreasureFileSrv;
  emitEvent: (event: TreasureEvent) => void;
}): Promise<{
  createBackupArchive: (opts?: { forEncryption?: boolean }) => Promise<Uint8Array>;
  cancelBackupArchive: () => Promise<boolean>;
  restoreBackupArchive: (archiveBytes: Uint8Array) => Promise<boolean>;
}> {
  let activeAbortController: AbortController | null = null;

  async function cancelBackupArchive(): Promise<boolean> {
    if (activeAbortController && !activeAbortController.signal.aborted) {
      activeAbortController.abort();
      activeAbortController = null;
      return true;
    }
    return false;
  }

  /**
   * Packs the app's files.
   *
   * With `forEncryption` the metadata file is left out: the gui encrypts this
   * archive whole and writes the metadata into the container around it, where
   * it stays readable without a passphrase.
   */
  async function createBackupArchive(
    { forEncryption }: { forEncryption?: boolean } = {},
  ): Promise<Uint8Array> {
    const abortController = new AbortController();
    activeAbortController = abortController;
    const { signal } = abortController;

    try {
      emitEvent({
        event: 'backup',
        payload: {
          stage: 'scanning',
          totalFiles: 0,
          processedFiles: 0,
          percent: 0,
        },
      });

      checkAbortSignal(signal);

      const files = await collectFilesFromFS(fs, '', signal);

      checkAbortSignal(signal);

      const metadata = forEncryption ? undefined : await generateBackupMetadata(fs, files);

      checkAbortSignal(signal);

      return await compressFilesToZip({
        fs,
        files,
        metadata,
        signal,
        emitEvent,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (signal.aborted || error?.name === 'AbortError' || error?.message?.includes('cancelled')) {
        emitEvent({
          event: 'backup',
          payload: {
            stage: 'cancelled',
            totalFiles: 0,
            processedFiles: 0,
            percent: 0,
          },
        });
      }
      throw error;
    } finally {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }
  }

  async function restoreBackupArchive(archiveBytes: Uint8Array): Promise<boolean> {
    try {
      emitEvent({
        event: 'restore',
        payload: {
          stage: 'unpacking',
          totalFiles: 0,
          processedFiles: 0,
          percent: 5,
        },
      });

      let unzipped: Unzipped;
      try {
        unzipped = await decompressZip(archiveBytes);
      } catch (err) {
        emitEvent({
          event: 'restore',
          payload: {
            stage: 'error',
            totalFiles: 0,
            processedFiles: 0,
            percent: 0,
          },
        });
        throw err;
      }

      // Drops the metadata file, folder entries, the junk desktop zip tools add
      // and anything trying to escape the app's own storage.
      const archiveEntries = Object.entries(unzipped).filter(([filePath]) =>
        isSafeArchivePath(filePath),
      );

      const archiveFilesMap = new Map<string, Uint8Array>(archiveEntries);
      const currentFsFiles = await collectFilesFromFS(fs, '');

      const filesToDelete = currentFsFiles.filter(filePath => !archiveFilesMap.has(filePath));
      const totalOperations = archiveEntries.length + filesToDelete.length;

      const changedFiles: string[] = [];
      const affectedFolders = new Set<string>();

      let processedFiles = 0;

      emitEvent({
        event: 'restore',
        payload: {
          stage: 'restoring',
          totalFiles: totalOperations,
          processedFiles: 0,
          percent: 5,
        },
      });

      // Ensure images folder exists
      if (!(await fs.checkFolderPresence(IMAGES_FOLDER))) {
        await fs.makeFolder(IMAGES_FOLDER);
      }

      // Write new or updated files
      for (const [filePath, fileBytes] of archiveEntries) {
        const fileExists = currentFsFiles.includes(filePath);
        let shouldWrite = true;

        if (fileExists) {
          const existingBytes = await fs.readBytes(filePath);
          if (areBytesEqual(existingBytes, fileBytes)) {
            shouldWrite = false;
          }
        }

        if (shouldWrite) {
          changedFiles.push(filePath);
          if (filePath.startsWith(`${IMAGES_FOLDER}/`)) {
            affectedFolders.add(IMAGES_FOLDER);
          }
          affectedFolders.add('');

          const parts = filePath.split('/');
          if (parts.length > 1) {
            const parentDir = parts.slice(0, -1).join('/');
            if (!(await fs.checkFolderPresence(parentDir))) {
              await fs.makeFolder(parentDir);
            }
          }
          await fs.writeBytes(filePath, fileBytes);
        }

        processedFiles++;
        emitEvent({
          event: 'restore',
          payload: {
            stage: 'restoring',
            totalFiles: totalOperations,
            processedFiles,
            currentFile: filePath,
            percent: Math.round(5 + (processedFiles / (totalOperations || 1)) * 45),
          },
        });
        await sleep(30);
      }

      // Delete obsolete files
      for (const filePath of filesToDelete) {
        changedFiles.push(filePath);
        if (filePath.startsWith(`${IMAGES_FOLDER}/`)) {
          affectedFolders.add(IMAGES_FOLDER);
        }
        affectedFolders.add('');

        await fs.deleteFile(filePath);
        processedFiles++;
        emitEvent({
          event: 'restore',
          payload: {
            stage: 'restoring',
            totalFiles: totalOperations,
            processedFiles,
            currentFile: filePath,
            percent: Math.round(5 + (processedFiles / (totalOperations || 1)) * 45),
          },
        });
        await sleep(30);
      }

      // Reset recent records in local storage
      await fsLocal.writeJSONFile(RECENT_FILE_NAME, []);

      // Guarantee groups file presence
      const doesGroupsFileExist = await fs.checkFilePresence(GROUPS_FILE_NAME);
      if (!doesGroupsFileExist) {
        await fs.writeJSONFile(GROUPS_FILE_NAME, []);
        changedFiles.push(GROUPS_FILE_NAME);
        affectedFolders.add('');
      }

      // Synchronize only if there are changes and we are online
      const hasChanges = changedFiles.length > 0;
      const isOnline = await checkServerConnection(fs);

      if (hasChanges && isOnline) {
        const filesToSync = [...new Set(changedFiles.filter(p => !filesToDelete.includes(p)))];
        const foldersToSync = [...affectedFolders];
        const totalSyncItems = filesToSync.length + foldersToSync.length;
        let syncProcessed = 0;

        emitEvent({
          event: 'restore',
          payload: {
            stage: 'syncing',
            totalFiles: totalSyncItems,
            processedFiles: 0,
            percent: 50,
          },
        });

        try {
          for (const itemPath of filesToSync) {
            await checkItemSyncState({
              path: itemPath,
              fs,
              fileSrv,
              emitEvent,
            });
            syncProcessed++;
            const percent = Math.round(50 + (syncProcessed / (totalSyncItems || 1)) * 45);
            emitEvent({
              event: 'restore',
              payload: {
                stage: 'syncing',
                totalFiles: totalSyncItems,
                processedFiles: syncProcessed,
                currentFile: itemPath,
                percent,
              },
            });
          }

          for (const folderPath of foldersToSync) {
            await checkFolderSyncState({
              path: folderPath,
              fs,
              emitEvent,
            });
            syncProcessed++;
            const percent = Math.round(50 + (syncProcessed / (totalSyncItems || 1)) * 45);
            emitEvent({
              event: 'restore',
              payload: {
                stage: 'syncing',
                totalFiles: totalSyncItems,
                processedFiles: syncProcessed,
                currentFile: folderPath || 'root',
                percent,
              },
            });
          }

          emitEvent({ event: 'update:records' });
        } catch (err) {
          w3n.log('error', 'Error syncing after restore: ', err);
        }
      }

      emitEvent({
        event: 'restore',
        payload: {
          stage: 'completed',
          totalFiles: totalOperations,
          processedFiles: totalOperations,
          percent: 100,
        },
      });

      await sleep(800);
      return true;
    } catch (err) {
      emitEvent({
        event: 'restore',
        payload: {
          stage: 'error',
          totalFiles: 0,
          processedFiles: 0,
          percent: 0,
        },
      });
      throw err;
    }
  }

  return {
    createBackupArchive,
    cancelBackupArchive,
    restoreBackupArchive,
  };
}
