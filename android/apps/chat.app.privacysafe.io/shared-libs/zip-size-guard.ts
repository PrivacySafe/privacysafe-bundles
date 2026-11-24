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
// SECURITY(CVE-2026-122146): guard for fflate `unzipSync` and `gunzipSync`.
//
// fflate (<= 0.8.3, no fixed release yet - see fflate#311) allocates the output
// buffer of a deflated zip entry as `new Uint8Array(originalSize)`, where
// originalSize is whatever the archive's central directory claims. A crafted
// file declaring gigabytes makes the webview / deno isolate run out of memory.
// `gunzipSync` does the same with the ISIZE field in the last 4 bytes of a gzip
// stream.
//
// The `filter` option of unzipSync sees the declared sizes BEFORE anything is
// allocated, so the zip guard lives there and throws: the callers already turn
// a throw from unzipSync into 'corrupted_archive' (a backup) or skip the file
// (an automatic backup). It throws rather than returns
// false, because a silently skipped entry would make a quietly incomplete
// restore. For gzip the declared size is read and checked before gunzipSync is
// called at all.
//
// Every call of unzipSync on bytes that came from outside MUST pass a filter
// made by makeZipSizeGuard, and every call of gunzipSync MUST be preceded by
// assertGzipSizeWithin. Remove the guard once fflate ships a fix.
// See doc/security/fflate-cve-2026-122146.md.
//
// Pure module, shared by the GUI and the background component: no fflate, no
// Web API - the type below mirrors fflate's UnzipFileInfo instead of importing
// it, and the component's runtime on Android has neither TextEncoder nor more.
import { MAX_ATTACHMENT_SIZE } from './constants/attachment-limits.ts';
import { BACKUP_MAX_BYTES } from './constants/backup.ts';

export interface ZipEntryInfo {
  name: string;
  /** Compressed size, as declared by the archive. */
  size: number;
  /** Uncompressed size, as declared by the archive. */
  originalSize: number;
  /** 0 - stored, 8 - deflate. */
  compression: number;
}

/**
 * The largest entry of a backup is either one attachment, which is never over
 * MAX_ATTACHMENT_SIZE, or the json with all the messages; this is a wide margin
 * for both. An automatic backup is one gzip-compressed json without
 * attachments, far smaller still.
 */
export const MAX_ZIP_ENTRY_SIZE = Math.max(256 * 1024 * 1024, MAX_ATTACHMENT_SIZE);

/**
 * The attachments of a backup are capped by BACKUP_MAX_BYTES when it is made;
 * on top of them come the json files of chats, messages and tombstones.
 */
export const MAX_ZIP_TOTAL_SIZE = BACKUP_MAX_BYTES + 256 * 1024 * 1024;

export class ZipSizeLimitError extends Error {
  constructor(entryName: string, declaredSize: number) {
    super(`Zip entry ${entryName} declares ${declaredSize} bytes, which is over the limit`);
    this.name = 'ZipSizeLimitError';
  }
}

export interface ZipSizeGuardOptions {
  maxEntrySize?: number;
  maxTotalSize?: number;
}

/**
 * Makes a filter for fflate `unzipSync`. `accept` is the caller's own filter;
 * sizes are checked only for entries it lets through, as only those get
 * decompressed. The guard counts what it has accepted, so a fresh one is needed
 * for every unzipSync call.
 */
export function makeZipSizeGuard(
  accept?: (file: ZipEntryInfo) => boolean,
  opts: ZipSizeGuardOptions = {},
): (file: ZipEntryInfo) => boolean {
  const maxEntrySize = opts.maxEntrySize ?? MAX_ZIP_ENTRY_SIZE;
  const maxTotalSize = opts.maxTotalSize ?? MAX_ZIP_TOTAL_SIZE;
  let total = 0;

  return file => {
    if (accept && !accept(file)) {
      return false;
    }
    const declared = file.originalSize;
    if (!Number.isFinite(declared) || (declared < 0) || (declared > maxEntrySize)) {
      throw new ZipSizeLimitError(file.name, declared);
    }
    total += declared;
    if (total > maxTotalSize) {
      throw new ZipSizeLimitError(file.name, declared);
    }
    return true;
  };
}

/**
 * The uncompressed size a gzip stream declares in its trailer (ISIZE, the last
 * 4 bytes, little-endian) - the size fflate's gunzipSync allocates for.
 */
export function declaredGzipSize(bytes: Uint8Array): number {
  const len = bytes.length;
  if (len < 4) {
    return 0;
  }
  return (bytes[len - 4] | (bytes[len - 3] << 8) | (bytes[len - 2] << 16) | (bytes[len - 1] << 24)) >>> 0;
}

/**
 * Throws ZipSizeLimitError when a gzip stream declares more than maxSize bytes.
 * To be called before every gunzipSync on bytes that came from outside.
 */
export function assertGzipSizeWithin(bytes: Uint8Array, maxSize: number = MAX_ZIP_ENTRY_SIZE): void {
  const declared = declaredGzipSize(bytes);
  if (declared > maxSize) {
    throw new ZipSizeLimitError('<gzip stream>', declared);
  }
}
