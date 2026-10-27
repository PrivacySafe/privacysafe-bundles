/*
 Copyright (C) 2024-2025 3NSoft Inc.

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
import {
  createVideoThumbnail,
  isFileImage,
  isFileVideo,
  resizeImage,
  uint8ToDataURL,
  getRandomId,
} from '@v1nt1248/3nclient-lib/utils';
import { fileTypeFromBuffer } from 'file-type';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { appStorageSrv } from '@/services/services-provider';
import { createPdfThumbnail } from '@/utils';
import { USER_FS, USER_LOCAL_FS } from '@shared/constants';
import { formatPath } from '@shared/utils/various';
import { getFolderEntityNames, joinEntityPath, pickFreeEntityName } from '@shared/utils/fs-utils/entity-name';
import { writeOsFile } from './write-os-file';
import { THUMBNAIL_SOURCE_SIZE_LIMIT } from '@/constants/thumbnails';

// enough for file-type to recognize the format
const FILE_TYPE_SAMPLE_SIZE = 4100;

async function detectFileType(file: File): Promise<{ ext: string; mime: string }> {
  const sample = new Uint8Array(await file.slice(0, FILE_TYPE_SAMPLE_SIZE).arrayBuffer());
  const detected = await fileTypeFromBuffer(sample);
  if (detected) {
    return detected;
  }

  const dotIndex = file.name.lastIndexOf('.');
  return { ext: dotIndex > 0 ? file.name.slice(dotIndex + 1) : '', mime: file.type };
}

async function createThumbnailForFileFromOs(file: File, mime: string): Promise<Nullable<string>> {
  if (isFileVideo({ type: mime })) {
    // the video is played from the File object, its content is not read into memory here
    return createVideoThumbnail(file, 200, 5);
  }

  const isImage = isFileImage({ type: mime });
  if ((!isImage && mime !== 'application/pdf') || file.size > THUMBNAIL_SOURCE_SIZE_LIMIT) {
    return null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return isImage ? resizeImage(uint8ToDataURL(bytes, mime), 200) : createPdfThumbnail(bytes, 200);
}

/**
 * Uploads a file from the OS into the folder. The content is streamed, so big
 * files are not held in memory; `onProgress` reports the written bytes.
 * A name taken in the folder gets a free variant (`name_copy.ext`, ...).
 */
export async function createFileBaseOnOsFileSystemFile({
  fsId,
  fs,
  uploadedFile,
  folderPath,
  withThumbnail,
  onProgress,
}: {
  fsId: string;
  fs: web3n.files.WritableFS;
  uploadedFile: File & { path?: string };
  folderPath: string;
  withThumbnail?: boolean;
  onProgress?: (bytesWritten: number, totalBytes: number) => void;
}): Promise<void> {
  const { name } = uploadedFile;

  try {
    // The folder may have been renamed or removed (on another device too) while it was shown.
    // Writing by its old path would silently create a new folder with the old name.
    if (formatPath(folderPath) && !(await fs.checkFolderPresence(folderPath))) {
      throw new Error(`The folder '${folderPath}' does not exist: it was renamed or removed.`);
    }

    const takenNames = await getFolderEntityNames(fs, folderPath);
    const freeName = await pickFreeEntityName({ name, isTaken: candidate => takenNames.has(candidate) });
    const newFullFileName = joinEntityPath(folderPath, freeName);

    await writeOsFile({ fs, path: newFullFileName, file: uploadedFile, onProgress });

    if (fsId === USER_FS || fsId === USER_LOCAL_FS) {
      const { ext, mime } = await detectFileType(uploadedFile);
      const img = withThumbnail
        ? await createThumbnailForFileFromOs(uploadedFile, mime).catch(err => {
            w3n.log('error', `Error creating a thumbnail for the ${name} file. `, err);
            return null;
          })
        : null;

      await appStorageSrv.updateEntityXAttrs({
        fsId,
        path: newFullFileName,
        attrs: {
          id: getRandomId(24),
          ext,
          mime,
          ...(img && { thumbnail: img }),
        },
      });
    }
  } catch (e) {
    if (!(e as web3n.files.FSSyncException).childNeverUploaded) {
      await w3n.log!('error', `An error creating of the ${name} file. `, e);
      throw e;
    }
  }
}
