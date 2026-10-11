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
import { getFileExtension, isFileImage, isFileVideo } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { createImageThumbnail } from './create-image-thumbnail';
import { createVideoThumbnail } from './create-video-thumbnail';
import { createPdfThumbnail } from './create-pdf-thumbnail';

/**
 * A preview of a file, whichever of the three builders its type calls for.
 *
 * The if/else chain used to be copied into every component that shows a preview,
 * and all three builders already take the same arguments - so the choice belongs
 * in one place rather than in each of them.
 *
 * Either an already-open file (`file3n`, what the composer has) or the id to
 * look one up by (`fileId`, what a message's attachment has).
 *
 * @returns null for a type with no preview, and for a file that could not be
 * read.
 */
export async function createThumbnail({
  fileName,
  file3n,
  fileId,
  incomingMsgId,
  targetSize = 200,
}: {
  fileName: string;
  file3n?: web3n.files.ReadonlyFile;
  fileId?: string;
  incomingMsgId?: string;
  targetSize?: number;
}): Promise<Nullable<string>> {
  const args = { file3n, fileId, incomingMsgId, targetSize };
  const lowerCaseName = fileName.toLowerCase();

  if (isFileImage({ fullName: lowerCaseName })) {
    return createImageThumbnail(args);
  }

  if (isFileVideo({ fullName: lowerCaseName })) {
    return createVideoThumbnail(args);
  }

  if (getFileExtension(fileName).toLowerCase() === 'pdf') {
    return createPdfThumbnail(args);
  }

  return null;
}
