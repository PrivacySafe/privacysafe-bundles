/*
 Copyright (C) 2022 3NSoft Inc.

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

import { bytesToUrlSafeBase64 } from './base64.ts';

export function randomStr(numOfChars: number): string {
  if (numOfChars < 1) {
    throw new Error(`number of chars is less than one`);
  }
  const byteLen = 3 * (Math.floor(numOfChars / 4) + 1);
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToUrlSafeBase64(bytes).slice(0, numOfChars);
}

export function randomBytes(numOfBytes: number): Uint8Array {
  const bytes = new Uint8Array(numOfBytes);
  crypto.getRandomValues(bytes);
  return bytes;
}
