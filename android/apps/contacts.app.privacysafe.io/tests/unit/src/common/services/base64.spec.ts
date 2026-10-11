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
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUrlSafeBase64,
  urlSafeBase64ToBytes,
} from '@main/common/services/base/base64';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('bytesToBase64 / base64ToBytes', () => {

  it('round-trips every input length modulo 3', () => {
    for (let len = 0; len <= 12; len += 1) {
      const input = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        input[i] = (i * 37 + 11) & 0xFF;
      }

      expect(Array.from(base64ToBytes(bytesToBase64(input)))).toEqual(Array.from(input));
    }
  });

  it('encodes the RFC test vectors', () => {
    const utf8 = (s: string) => new TextEncoder().encode(s);

    expect(bytesToBase64(utf8(''))).toBe('');
    expect(bytesToBase64(utf8('f'))).toBe('Zg==');
    expect(bytesToBase64(utf8('fo'))).toBe('Zm8=');
    expect(bytesToBase64(utf8('foo'))).toBe('Zm9v');
    expect(bytesToBase64(utf8('foob'))).toBe('Zm9vYg==');
    expect(bytesToBase64(utf8('fooba'))).toBe('Zm9vYmE=');
    expect(bytesToBase64(utf8('foobar'))).toBe('Zm9vYmFy');
  });

  it('round-trips high byte values', () => {
    const input = bytes(0x00, 0x7F, 0x80, 0xFF, 0xFE, 0x01);

    expect(Array.from(base64ToBytes(bytesToBase64(input)))).toEqual(Array.from(input));
  });

  it('rejects a string whose length is not a multiple of 4', () => {
    expect(() => base64ToBytes('Zm9')).toThrow(/Unable to parse base64/);
  });

  it('rejects padding in the middle of a string', () => {
    expect(() => base64ToBytes('Zg==Zm9v')).toThrow(/Unable to parse base64/);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base64ToBytes('Zm9*')).toThrow(/Unable to parse base64/);
    expect(() => base64ToBytes('Zm9Ā')).toThrow(/Unable to parse base64/);
  });

});

describe('url-safe base64', () => {

  it('replaces the + and / characters', () => {
    // 0xFB 0xFF encodes to '+/8=' in standard base64.
    const input = bytes(0xFB, 0xFF, 0xBF);

    const standard = bytesToBase64(input);
    const urlSafe = bytesToUrlSafeBase64(input);

    expect(standard).toContain('+');
    expect(standard).toContain('/');
    expect(urlSafe).not.toContain('+');
    expect(urlSafe).not.toContain('/');
    expect(urlSafe).toBe(standard.replaceAll('+', '-').replaceAll('/', '_'));
  });

  it('round-trips through the url-safe alphabet', () => {
    for (let len = 1; len <= 12; len += 1) {
      const input = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        input[i] = (i * 53 + 251) & 0xFF;
      }

      expect(Array.from(urlSafeBase64ToBytes(bytesToUrlSafeBase64(input))))
      .toEqual(Array.from(input));
    }
  });

});
