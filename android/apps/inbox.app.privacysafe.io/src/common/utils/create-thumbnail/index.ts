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
import { getFileExtension, isFileImage, isFileVideo, schedulerYield } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { getFileByInfoFromMsg } from '@common/utils/files';
import { createImageThumbnail, createThumbnailForSVG } from './create-image-thumbnail';
import { createVideoThumbnail } from './create-video-thumbnail';
import { createPdfThumbnail } from './create-pdf-thumbnail';
import type { AttachmentInfo } from '@common/types';

export async function createThumbnail(
  { attachment, incomingMsgId, targetSize = 200 }:
  { attachment: AttachmentInfo; incomingMsgId?: string; targetSize?: number },
): Promise<Nullable<string>> {
  const fileName = attachment.fileName;
  const fileExt = getFileExtension(fileName);

  // Out first of all, so that no caller reads a null answer as "the file is
  // deleted, moved or renamed": there is nothing wrong with a file sitting on
  // the user's other device.
  if (attachment.hasNoLocalSource) {
    return null;
  }

  const file3n = await getFileByInfoFromMsg(attachment, incomingMsgId);
  if (!file3n) {
    return null;
  }
  await schedulerYield();

  if (fileExt === 'pdf') {
    return createPdfThumbnail({ file3n, targetSize });
  }

  if (fileExt === 'svg') {
    return createThumbnailForSVG({ file3n });
  }

  if (isFileImage({ fullName: fileName.toLowerCase() })) {
    return createImageThumbnail({ file3n, targetSize });
  }

  if (isFileVideo({ fullName: fileName.toLowerCase() })) {
    return createVideoThumbnail({ file3n, targetSize });
  }

  return null;
}
