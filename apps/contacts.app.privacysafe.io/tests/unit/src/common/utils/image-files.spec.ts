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
import { blobFromDataURL } from '@main/common/utils/image-files';

// 1x1 transparent gif, the smallest real image data url.
const gifDataURL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('blobFromDataURL', () => {

  it('reads the mime type out of the data url', () => {
    const blob = blobFromDataURL(gifDataURL);

    expect(blob.type).toBe('image/gif');
  });

  it('decodes the payload to the expected byte length', async () => {
    const blob = blobFromDataURL(gifDataURL);

    expect(blob.size).toBe(42);
    expect(new Uint8Array(await blob.arrayBuffer()).subarray(0, 3))
    .toEqual(new Uint8Array([0x47, 0x49, 0x46])); // 'GIF'
  });

  it('handles a mime type carrying parameters', () => {
    const blob = blobFromDataURL('data:text/plain;charset=utf-8;base64,aGk=');

    expect(blob.type).toBe('text/plain;charset=utf-8');
  });

  it('rejects a string that is not a base64 data url', () => {
    expect(() => blobFromDataURL('https://example.com/logo.png'))
    .toThrow(/Fail to parse given string as data url/);
  });

  it('rejects a data url without the base64 marker', () => {
    expect(() => blobFromDataURL('data:image/gif,raw-content'))
    .toThrow(/Fail to parse given string as data url/);
  });

  // The guard is `b64Start < 8`, so a marker appearing too early — i.e. with
  // no room for a real `data:<mime>` prefix — is refused rather than producing
  // a blob with a nonsense mime type.
  it('rejects a truncated prefix', () => {
    expect(() => blobFromDataURL(';base64,aGk=')).toThrow(/Fail to parse given string as data url/);
    expect(() => blobFromDataURL('')).toThrow(/Fail to parse given string as data url/);
  });

});
