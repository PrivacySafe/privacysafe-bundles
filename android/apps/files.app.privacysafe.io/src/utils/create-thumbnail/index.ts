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
import { THUMBNAIL_CACHE_SIZE, THUMBNAIL_SOURCE_SIZE_LIMIT } from '@/constants/thumbnails';
import { createImageThumbnail } from './create-image-thumbnail';
import { createVideoThumbnail } from './create-video-thumbnail';
import { createPdfThumbnail } from './create-pdf-thumbnail';

// least recently used entries are dropped first (a Map keeps insertion order)
const thumbnailCache = new Map<string, Nullable<string>>();

function rememberThumbnail(key: string, value: Nullable<string>) {
  thumbnailCache.delete(key);
  thumbnailCache.set(key, value);
  if (thumbnailCache.size > THUMBNAIL_CACHE_SIZE) {
    thumbnailCache.delete(thumbnailCache.keys().next().value!);
  }
}

export function clearThumbnailCache() {
  thumbnailCache.clear();
}

/**
 * Makes a thumbnail of an image, a video or a PDF file. With `cacheTag` (the
 * file version or mtime) the result is kept for the session, so revisiting a
 * folder or switching its view does not decode the files again.
 */
export async function createThumbnail(
  fsId: string,
  path: string,
  cacheTag?: string | number,
): Promise<Nullable<string>> {
  const fullName = path.toLowerCase();
  const kind = isFileImage({ fullName })
    ? 'image'
    : isFileVideo({ fullName })
      ? 'video'
      : getFileExtension(path).toLowerCase() === 'pdf'
        ? 'pdf'
        : null;
  if (!kind) {
    return null;
  }

  const cacheKey = cacheTag === undefined ? undefined : `${fsId}\n${path}\n${cacheTag}`;
  if (cacheKey && thumbnailCache.has(cacheKey)) {
    const cached = thumbnailCache.get(cacheKey)!;
    rememberThumbnail(cacheKey, cached);
    return cached;
  }

  const fs = useFsStore().getFs(fsId);
  const { size = 0 } = await fs.stat(path);
  const thumbnail =
    size > THUMBNAIL_SOURCE_SIZE_LIMIT
      ? null
      : kind === 'image'
        ? await createImageThumbnail(fs, path)
        : kind === 'video'
          ? await createVideoThumbnail(fs, path)
          : await createPdfThumbnail(fs, path);

  if (cacheKey) {
    rememberThumbnail(cacheKey, thumbnail);
  }
  return thumbnail;
}
