/*
 Copyright (C) 2025 3NSoft Inc.

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
import { SingleProc } from '../../shared-libs/processes/single.ts';
import { randomStr } from '../../src/common/services/base/random.ts';
import { isUploadInFlight } from '../utils/upload-state.ts';

export interface FilesStoreService {
  saveFile({ base64, id }: { base64: string; id?: string }): Promise<string>;
  getFile(
    entityId: string,
    responseAsBase64?: boolean,
  ): Promise<web3n.files.ReadonlyFile | string | undefined>;
  deleteFile(entityId: string): Promise<void>;
  multipleDeleteFiles(entityIds: string[]): Promise<void>;
}

export async function filesStoreService(fs: web3n.files.WritableFS): Promise<FilesStoreService> {
  const fileProc = new SingleProc();

  async function saveFile({ base64, id }: { base64: string; id?: string }): Promise<string> {
    if (!base64) {
      w3n.log('error', 'There is no data to save to the file');
      throw new Error('There is no data to save to the file');
    }

    const entityId = id || randomStr(20);
    try {
      await fileProc.startOrChain(() => fs.writeTxtFile(entityId, base64));
      return entityId;
    } catch (e) {
      w3n.log('error', `Error saving the image file ${entityId}. `, e);
      throw new Error(`Error saving the image file ${entityId}`);
    }
  }

  async function getFile(
    entityId: string,
    responseAsBase64?: boolean,
  ): Promise<web3n.files.ReadonlyFile | string | undefined> {
    try {
      const file = await fs!.readonlyFile(entityId);
      if (!file) {
        throw Error(`Expected file ${entityId} is empty`);
      }

      if (!responseAsBase64) {
        return file;
      }

      const fileBytes = await file.readBytes();
      if (!fileBytes) {
        throw Error(`Expected file ${entityId} is empty`);
      }

      const uint8Array = new Uint8Array([...fileBytes]);
      const buffer = Buffer.from(uint8Array);
      return buffer.toString('base64');
    } catch (e: unknown) {
      const { type, notFound } = e as web3n.files.FileException;
      // A file that is in the folder listing while its bytes are still only on
      // the server reads as not found. That is the normal state of another
      // device's avatar until the download lands, so it is not an error: the
      // caller is answered with '', which getImage turns into '[error]' - the
      // signal the list item retries on.
      if (type === 'file' && notFound) {
        return '';
      }

      w3n.log('error', `Error getting file ${entityId}. `, e);
    }
  }

  async function deleteFile(entityId: string): Promise<void> {
    // Deleting a file whose upload is in flight makes the core reject its own
    // background removeCurrentVersion with file/concurrentUpdate, unhandled,
    // because this call has already resolved by then. Leaving the file alone
    // turns it into an orphan, which removeUnnecessaryImageFiles collects on the
    // next sweep - so the deletion still happens, just later.
    if (await isUploadInFlight(fs, entityId)) {
      w3n.log(
        'info',
        `Deletion of file ${entityId} is left to the next sweep: its upload is in flight`,
      );
      return;
    }

    try {
      await fileProc.startOrChain(() => fs.deleteFile(entityId));
    } catch (e) {
      w3n.log('error', `Error deleting file ${entityId}. `, e);
    }
  }

  async function multipleDeleteFiles(entityIds: string[]): Promise<void> {
    try {
      const promises: Promise<void>[] = [];
      for (const entityId of entityIds) {
        promises.push(fs.deleteFile(entityId))
      }
      await Promise.allSettled(promises);
    } catch (e) {
      w3n.log('error', `Error deleting files ${entityIds.join(', ')}. `, e);
    }
  }

  return {
    saveFile,
    getFile,
    deleteFile,
    multipleDeleteFiles,
  };
}
