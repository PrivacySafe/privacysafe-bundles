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
import { SingleProc } from '../shared/processes/single.ts';
import { randomStr } from '../shared/utils/random-str.ts';
import { GROUPS_FILE_NAME, IMAGES_FOLDER, RECENT_FILE_NAME } from '../shared/constants.ts';
import type { TreasureGroup, TreasureRecord } from '../shared/@types/common.types.ts';
import type { TreasureFileSrv } from './srv.types.ts';

export async function treasureFileSrv(
  fs: web3n.files.WritableFS,
  fsLocal: web3n.files.WritableFS,
): Promise<TreasureFileSrv> {
  const fileProc = new SingleProc();

  async function saveRecentFile(data: string[]): Promise<void> {
    return fsLocal.writeJSONFile(RECENT_FILE_NAME, data);
  }

  async function loadRecentFile(): Promise<string[]> {
    return fsLocal.readJSONFile<string[]>(RECENT_FILE_NAME);
  }

  async function saveFile(data: TreasureRecord | TreasureGroup[], fileName?: string): Promise<string> {
    // console.log('💾 SAVE_FILE => ', fileName, JSON.stringify(data));
    if (!data) {
      w3n.log('error', 'There is no data to save to the file');
      throw new Error('There is no data to save to the file');
    }

    const itemId =
      !(data as TreasureRecord).id || (data as TreasureRecord).id === 'new'
        ? randomStr(20)
        : (data as TreasureRecord).id;
    const fileNameUsed = fileName || itemId;

    try {
      await fileProc.startOrChain(async () => {
        const savedData = Array.isArray(data)
          ? data
          : {
              ...data,
              id: itemId,
            };

        await fs.writeJSONFile(fileNameUsed, savedData);
      });
      return fileNameUsed;
    } catch (err) {
      w3n.log('error', `Error saving the file ${fileNameUsed}. `, err);
      throw new Error(`Error saving the file ${fileNameUsed}.`, { cause: err });
    }
  }

  async function updateFile(data: TreasureRecord | TreasureGroup[], fileName?: string): Promise<void> {
    // A list of groups has no id of its own and always lives in one file, so
    // the name can be left out for it. A record is addressed by its id, and
    // without either there is nothing to write to.
    const fileNameUsed = Array.isArray(data)
      ? fileName || GROUPS_FILE_NAME
      : fileName || (data as TreasureRecord).id;

    if (!fileNameUsed) {
      w3n.log('error', 'The filename argument is missing');
      throw new Error('The filename argument is missing');
    }

    await fileProc.startOrChain(async () => fs.writeJSONFile(fileNameUsed, data));
  }

  async function getFile<T>(
    fileName: string,
  ): Promise<(T extends TreasureRecord ? TreasureRecord : TreasureGroup[]) | null> {
    try {
      // @ts-ignore
      return fileProc.startOrChain(
        async () =>
          await fs
            .readJSONFile<T extends TreasureRecord ? TreasureRecord : TreasureGroup[]>(fileName)
            .catch(err => {
              if ((err as web3n.files.FileException).notFound) {
                if (fileName === GROUPS_FILE_NAME) {
                  return [];
                }

                return null;
              }

              throw err;
            }),
      );
    } catch (err) {
      w3n.log('error', `Error getting file ${fileName}. `, err);
      throw new Error(`Error getting file ${fileName}`, { cause: err });
    }
  }

  async function saveImage(data: { bytes: Uint8Array; id?: string }): Promise<string> {
    const fileId = data.id || randomStr(20);
    try {
      await fileProc.startOrChain(async () => await fs.writeBytes(`${IMAGES_FOLDER}/${fileId}`, data.bytes));
      return fileId;
    } catch (err) {
      w3n.log('error', `Error saving the file ${fileId}. `, err);
      throw new Error(`Error saving the file ${fileId}.`, { cause: err });
    }
  }

  async function loadImage(fileId: string): Promise<Uint8Array | undefined> {
    try {
      return fileProc.startOrChain(async () => fs.readBytes(`${IMAGES_FOLDER}/${fileId}`));
    } catch (err) {
      w3n.log('error', `Error getting image file ${fileId}. `, err);
      throw new Error(`Error getting image file ${fileId}`, { cause: err });
    }
  }

  async function deleteFile(fileName: string): Promise<void> {
    try {
      const doesFileExist = await fs.checkFilePresence(fileName);
      // console.log('🧽 DELETE_FILE => ', fileName, doesFileExist);
      if (doesFileExist) {
        await fileProc.startOrChain(async () => await fs.deleteFile(fileName));
      }
    } catch (err) {
      w3n.log('error', `Error deleting file ${fileName}. `, err);
      throw new Error(`Error deleting file ${fileName}`, { cause: err });
    }
  }

  async function deleteFiles(currentFileNames: string[]): Promise<void> {
    const promiseToPerformWorks = currentFileNames.map(fileName => deleteFile(fileName));
    await Promise.allSettled(promiseToPerformWorks);
  }

  return {
    loadRecentFile,
    saveRecentFile,
    saveFile,
    saveImage,
    updateFile,
    getFile,
    loadImage,
    deleteFile,
    deleteFiles,
  };
}
