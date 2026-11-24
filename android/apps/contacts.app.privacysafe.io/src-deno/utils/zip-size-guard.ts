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
// SECURITY(CVE-2026-122146): guard for fflate `unzipSync`.
//
// fflate (<= 0.8.3, no fixed release yet - see fflate#311) allocates the output
// buffer of a deflated entry as `new Uint8Array(originalSize)`, where
// originalSize is whatever the archive's central directory claims. A crafted
// file declaring gigabytes makes the webview / deno isolate run out of memory.
//
// The `filter` option of unzipSync sees the declared sizes BEFORE anything is
// allocated, so the guard lives there and throws: the callers already turn a
// throw from unzipSync into 'corrupted_archive'. It throws rather than returns
// false, because a silently skipped entry would make a quietly incomplete
// restore.
//
// Every call of unzipSync on bytes that came from outside MUST pass a filter
// made by makeZipSizeGuard. Remove the guard once fflate ships a fix.
// See docs/security/fflate-cve-2026-122146.md.
//
// Pure module, no fflate import: the type below mirrors fflate's UnzipFileInfo.

export interface ZipEntryInfo {
  name: string;
  /** Compressed size, as declared by the archive. */
  size: number;
  /** Uncompressed size, as declared by the archive. */
  originalSize: number;
  /** 0 - stored, 8 - deflate. */
  compression: number;
}

/** Avatars are 104px images and the db is a few MB; this is a wide margin. */
export const MAX_ZIP_ENTRY_SIZE = 64 * 1024 * 1024;

export const MAX_ZIP_TOTAL_SIZE = 256 * 1024 * 1024;

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
