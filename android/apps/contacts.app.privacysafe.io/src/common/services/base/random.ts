/*
 Copyright (C) 2022, 2026 3NSoft Inc.

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
  const bytes = randomBytes(byteLen);
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  const str = ((bytes as any).toBase64 ?
    (bytes as any).toBase64({ alphabet: 'base64url' }) :
    bytesToUrlSafeBase64(bytes)
  );
  return str.slice(0, numOfChars);
}

export function randomBytes(numOfBytes: number): Uint8Array {
  if ((globalThis as Partial<typeof globalThis>).crypto?.getRandomValues) {
    const bytes = new Uint8Array(numOfBytes);
    crypto.getRandomValues(bytes);
    return bytes;
  } else {
    console.warn(`Using math to get random value, in when crypto is missing.`);
    const numOfRandU32s = Math.floor(numOfBytes/4) + ((numOfBytes%4 > 0) ? 1 : 0);
    const u32s = new Uint32Array(numOfRandU32s);
    for (let i=0; i<u32s.length; i+=1) {
      u32s[i] = Math.floor(0xffffffff * Math.random());
    }
    const u8s = new Uint8Array(u32s.buffer);
    return ((u8s.length > numOfBytes) ? u8s.slice(0, numOfBytes) : u8s);
  }
}
