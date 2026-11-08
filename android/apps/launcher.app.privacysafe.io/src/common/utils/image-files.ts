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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { b64ToBlob, uint8ToDataURL } from '@v1nt1248/3nclient-lib/utils';

type ReadonlyFile = web3n.files.ReadonlyFile;

const IMG_FILE_EXTS = ['svg', 'jpeg', 'jpg', 'png', 'gif', 'webp'];

export type ImageType = 'svg' | 'jpeg' | 'png' | 'gif' | 'webp';

export async function selectImageFilesWithDialog(
  title: string,
  btnLabel: string,
  multiSelections: boolean,
  t: any,
): Promise<ReadonlyFile | ReadonlyFile[] | undefined> {
  const files = await w3n.shell!.fileDialogs!.openFileDialog!(title, btnLabel, multiSelections, {
    filters: [{ extensions: IMG_FILE_EXTS, name: t('dialog.open-file.image-type') }],
  });
  return files ? (files.length > 1 ? files : files[0]) : undefined;
}

export async function selectOneImageFileWithDialog(
  title: string,
  btnLabel: string,
  t: any,
): Promise<ReadonlyFile | undefined> {
  const file = await selectImageFilesWithDialog(title, btnLabel, false, t);
  return file ? (file as ReadonlyFile) : undefined;
}

export async function blobFromImageFile(imgFile: ReadonlyFile): Promise<Blob> {
  const imgBytes = await imgFile.readBytes();
  if (!imgBytes) {
    throw new Error(`Expected image file ${imgFile.name} is empty`);
  }
  return new Blob([imgBytes as BlobPart], { type: mimeTypeOfImageFile(imgFile.name) });
}

export function mimeTypeOfImageFile(imgFileName: string): string {
  const indOfDot = imgFileName.lastIndexOf('.');
  if (indOfDot < 0) {
    throw new Error(`File name has no extension to guess its type`);
  }
  const fExt = imgFileName.substring(indOfDot + 1);
  switch (fExt as ImageType | 'jpg') {
    case 'svg':
      return `image/svg+xml`;
    case 'jpeg':
    case 'jpg':
      return `image/jpeg`;
    case 'png':
      return `image/png`;
    case 'gif':
      return `image/gif`;
    case 'webp':
      return `image/webp`;
    default:
      throw new Error(`Can't connect file extension ${fExt} to known image mime type`);
  }
}

export function blobFromDataURL(dataURL: string): Blob {
  const b64Start = dataURL.indexOf(';base64,');
  if (b64Start < 8) {
    throw new Error(`Fail to parse given string as data url`);
  }
  const mimeType = dataURL.substring(5, b64Start);
  return b64ToBlob(dataURL.substring(b64Start + 8), mimeType);
}

export async function readImageFileIntoDataURL(imgFile: ReadonlyFile): Promise<string> {
  const imgBytes = await imgFile.readBytes();
  if (!imgBytes) {
    throw new Error(`Expected image file ${imgFile.name} is empty`);
  }
  return uint8ToDataURL(imgBytes, mimeTypeOfImageFile(imgFile.name));
}
