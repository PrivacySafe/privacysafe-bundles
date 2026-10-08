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
import { createPdfThumbnail, getFileArray } from '@/utils';
import { USER_FS, USER_LOCAL_FS } from '@shared/constants';
import { getFileExtension } from '../../../shared/utils/various';

async function createThumbnailForFileFromOs(
  uploadedFile: File & { path?: string },
  byteArray: Uint8Array<ArrayBufferLike>,
): Promise<{ img: Nullable<string>; ext: string; mime: string }> {
  let fileType = await fileTypeFromBuffer(byteArray);
  if (!fileType && uploadedFile) {
    const parsedFileName = uploadedFile.name.split('.');

    fileType = {
      mime: uploadedFile.type,
      ext: (parsedFileName.length > 1 ? parsedFileName.pop() : '') as string,
    };
  }

  let img: Nullable<string> = null;
  const isImage = isFileImage({ type: fileType!.mime });
  const isVideo = isFileVideo({ type: fileType!.mime });

  if (isImage) {
    const base64Image = byteArray ? uint8ToDataURL(byteArray, fileType!.mime) : '';
    img = base64Image ? await resizeImage(base64Image, 200) : '';
  } else if (isVideo) {
    img = await createVideoThumbnail(uploadedFile, 200, 5);
  } else if (fileType!.mime === 'application/pdf') {
    img = await createPdfThumbnail(byteArray!, 200);
  }

  return { img, ext: fileType!.ext, mime: fileType!.mime };
}

export async function createFileBaseOnOsFileSystemFile({
  fsId,
  fs,
  uploadedFile,
  folderPath,
  withThumbnail,
}: {
  fsId: string;
  fs: web3n.files.WritableFS;
  uploadedFile: File & { path?: string };
  folderPath: string;
  withThumbnail?: boolean;
}): Promise<void> {
  const { name } = uploadedFile;

  try {
    const byteArray = await getFileArray(uploadedFile);
    if (!byteArray) {
      throw new Error('No file uploaded');
    }

    const fullFilePath = `${folderPath}/${name}`;
    const fileExt = getFileExtension(name);
    const fileName = name.replace(`.${fileExt}`, '');
    const isThereFileWithSameName = await fs.checkFilePresence(fullFilePath);
    const newFullFileName = isThereFileWithSameName ? `${folderPath}/${fileName}_copy.${fileExt}` : fullFilePath;

    await fs.writeBytes(newFullFileName, byteArray);


    if (fsId === USER_FS || USER_LOCAL_FS) {
      const { img, ext, mime } = await createThumbnailForFileFromOs(uploadedFile, byteArray);

      await appStorageSrv.updateEntityXAttrs({
        fsId,
        path: newFullFileName,
        attrs: {
          id: getRandomId(24),
          ext,
          mime,
          ...(withThumbnail && img && { thumbnail: img }),
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
