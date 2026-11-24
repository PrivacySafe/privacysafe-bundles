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
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { makeZipSizeGuard, ZipSizeLimitError } from '@deno/utils/zip-size-guard.ts';
import {
  readSharedContactsArchive,
  SharedContactsArchiveFailure,
} from '@deno/utils/shared-contacts-archive.ts';
import { openBackupContainer } from '@main/common/utils/backup-container';

/**
 * Rewrites the uncompressed size every central directory record declares -
 * the field fflate's unzipSync sizes its output buffer by (CVE-2026-122146).
 */
function withDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const res = zip.slice();
  const view = new DataView(res.buffer);
  for (let i = 0; i + 46 <= res.length; i += 1) {
    if (view.getUint32(i, true) === 0x02014B50) {
      view.setUint32(i + 24, size, true);
    }
  }
  return res;
}

const HUGE = 0xFFFFFFF0;

describe('makeZipSizeGuard', () => {
  it('lets an ordinary archive through unchanged', () => {
    const zip = zipSync({ 'a.txt': strToU8('hello'), 'b/c.bin': new Uint8Array(1000) });
    expect(unzipSync(zip, { filter: makeZipSizeGuard() })).toEqual(unzipSync(zip));
  });

  it('throws before allocating for an entry declaring a huge size', () => {
    const zip = withDeclaredSize(zipSync({ 'a.txt': strToU8('hello'.repeat(100)) }), HUGE);
    expect(() => unzipSync(zip, { filter: makeZipSizeGuard() })).toThrow(ZipSizeLimitError);
  });

  it('throws when the entries together go over the total limit', () => {
    const zip = zipSync({ a: new Uint8Array(600), b: new Uint8Array(600) });
    const filter = makeZipSizeGuard(undefined, { maxEntrySize: 1000, maxTotalSize: 1000 });
    expect(() => unzipSync(zip, { filter })).toThrow(ZipSizeLimitError);
  });

  it('checks only entries the inner filter accepts', () => {
    const zip = withDeclaredSize(zipSync({ skipped: strToU8('x'.repeat(100)) }), HUGE);
    expect(unzipSync(zip, { filter: makeZipSizeGuard(() => false) })).toEqual({});
  });

  it('makes readSharedContactsArchive report a forged archive as corrupted', () => {
    const zip = withDeclaredSize(
      zipSync({ 'contacts.json': strToU8(JSON.stringify({ version: 1, contacts: [] })) }),
      HUGE,
    );
    let reason: string | undefined;
    try {
      readSharedContactsArchive(zip);
    } catch (err) {
      reason = (err as SharedContactsArchiveFailure).reason;
    }
    expect(reason).toBe('corrupted_archive');
  });

  it('makes openBackupContainer report a forged archive as corrupted', async () => {
    const zip = withDeclaredSize(zipSync({ 'contacts.db': strToU8('x'.repeat(100)) }), HUGE);
    await expect(openBackupContainer(zip)).rejects.toMatchObject({ reason: 'corrupted_archive' });
  });
});
