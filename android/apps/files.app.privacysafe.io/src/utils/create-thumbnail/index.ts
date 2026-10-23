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
import { getFileExtension, isFileImage, isFileVideo } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { useFsStore } from '@/store';
import { createImageThumbnail } from './create-image-thumbnail';
import { createVideoThumbnail } from './create-video-thumbnail';
import { createPdfThumbnail } from './create-pdf-thumbnail';

export async function createThumbnail(fsId: string, path: string): Promise<Nullable<string>> {
  const fsStore = useFsStore();
  const fs = fsStore.getFs(fsId);

  const fileExt = getFileExtension(path);
  if (isFileImage({ fullName: path.toLowerCase() })) {
    return createImageThumbnail(fs, path);
  }

  if (isFileVideo({ fullName: path.toLowerCase() })) {
    return createVideoThumbnail(fs, path);
  }

  if (fileExt === 'pdf') {
    return createPdfThumbnail(fs, path);
  }

  return null;
}
