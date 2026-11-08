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

type ThumbnailKind = 'image' | 'video' | 'pdf';

function getThumbnailKind(name: string): Nullable<ThumbnailKind> {
  const fullName = name.toLowerCase();
  return isFileImage({ fullName })
    ? 'image'
    : isFileVideo({ fullName })
      ? 'video'
      : getFileExtension(name).toLowerCase() === 'pdf'
        ? 'pdf'
        : null;
}

function makeThumbnailOfFile(kind: ThumbnailKind, file: web3n.files.ReadonlyFile): Promise<Nullable<string>> {
  return kind === 'image'
    ? createImageThumbnail(file)
    : kind === 'video'
      ? createVideoThumbnail(file)
      : createPdfThumbnail(file);
}

function getCachedThumbnail(cacheKey: string | undefined): { hit: boolean; value?: Nullable<string> } {
  if (!cacheKey || !thumbnailCache.has(cacheKey)) {
    return { hit: false };
  }
  const value = thumbnailCache.get(cacheKey)!;
  rememberThumbnail(cacheKey, value);
  return { hit: true, value };
}

/**
 * A thumbnail of the target of a link to a file. The kind comes from the name
 * of the target, and the cache tag from its version: the target changes apart
 * from the link.
 */
async function createLinkTargetThumbnail(fsId: string, path: string): Promise<Nullable<string>> {
  const link = await useFsStore().getFs(fsId).readLink(path);
  // target() resolves the link to either a file or a folder
  const target = await link.target();
  if (!link.isFile) {
    return null;
  }

  const file = target as web3n.files.ReadonlyFile;
  const kind = getThumbnailKind(file.name || path);
  if (!kind) {
    return null;
  }

  const { size = 0, version, mtime } = await file.stat();
  const cacheTag = version ?? mtime?.valueOf();
  const cacheKey = cacheTag === undefined ? undefined : `${fsId}\n${path}\nlink:${cacheTag}`;
  const cached = getCachedThumbnail(cacheKey);
  if (cached.hit) {
    return cached.value ?? null;
  }

  const thumbnail = size > THUMBNAIL_SOURCE_SIZE_LIMIT ? null : await makeThumbnailOfFile(kind, file);
  if (cacheKey) {
    rememberThumbnail(cacheKey, thumbnail);
  }
  return thumbnail;
}

/**
 * Makes a thumbnail of an image, a video or a PDF file. With `cacheTag` (the
 * file version or mtime) the result is kept for the session, so revisiting a
 * folder or switching its view does not decode the files again. With `isLink`
 * the path is a link to a file, and the thumbnail is made of its target.
 */
export async function createThumbnail(
  fsId: string,
  path: string,
  cacheTag?: string | number,
  { isLink = false }: { isLink?: boolean } = {},
): Promise<Nullable<string>> {
  if (isLink) {
    return createLinkTargetThumbnail(fsId, path);
  }

  const kind = getThumbnailKind(path);
  if (!kind) {
    return null;
  }

  const cacheKey = cacheTag === undefined ? undefined : `${fsId}\n${path}\n${cacheTag}`;
  const cached = getCachedThumbnail(cacheKey);
  if (cached.hit) {
    return cached.value ?? null;
  }

  const fs = useFsStore().getFs(fsId);
  const { size = 0 } = await fs.stat(path);
  const thumbnail =
    size > THUMBNAIL_SOURCE_SIZE_LIMIT ? null : await makeThumbnailOfFile(kind, await fs.readonlyFile(path));

  if (cacheKey) {
    rememberThumbnail(cacheKey, thumbnail);
  }
  return thumbnail;
}
