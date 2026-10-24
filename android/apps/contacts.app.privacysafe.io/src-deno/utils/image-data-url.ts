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
// Avatars are kept in the app's storage as data-urls in text files, while an
// export file with shared contacts carries them as ordinary image files.

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export function imageFromDataURL(dataURL: string): { bytes: Uint8Array; ext: string } | undefined {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataURL.trim());
  if (!match) {
    return undefined;
  }

  const [, mime = '', isBase64, payload] = match;
  let bytes: Uint8Array;
  if (isBase64) {
    const bin = atob(payload);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }

  return { bytes, ext: MIME_TO_EXT[mime.toLowerCase()] ?? 'img' };
}

/**
 * The reverse of imageFromDataURL. Undefined for a file that is not a known
 * image type: such a file is not something to show as an avatar.
 */
export function dataURLFromImage(bytes: Uint8Array, ext: string): string | undefined {
  const mime = EXT_TO_MIME[ext.toLowerCase()];
  if (!mime) {
    return undefined;
  }

  // Chunked: String.fromCharCode(...bytes) on a whole image can overflow the
  // call stack.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}
