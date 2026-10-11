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
class XorShift128 {
  private x: number;
  private y: number;
  private z: number;
  private w: number;

  constructor() {
    // Seed once from Date.now() + Math.random() — fast, no crypto dependency
    const now = Date.now();
    this.x = (now ^ 0x12345678) >>> 0 || 123456789;
    this.y = ((now * 0x5bd1e995) ^ 0x362436069) >>> 0 || 362436069;
    this.z = ((now * 0x1b873593) ^ 0x521288629) >>> 0 || 521288629;
    this.w = ((now * 0xcc9e2d51) ^ 0x88675123) >>> 0 || 88675123;
    // Warm up the generator to mix initial state
    for (let i = 0; i < 8; i++) { this.next(); }
  }

  next(): number {
    const t = this.x ^ (this.x << 11);
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = this.w ^ (this.w >>> 19) ^ (t ^ (t >>> 8));
    return (this.w >>> 0) / 4294967296;
  }
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CHARS_LENGTH = CHARS.length;

// Singleton RNG — state persists across calls, ensuring uniqueness
const rng = new XorShift128();

export function generateFastRandomString(length = 16): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = (rng.next() * CHARS_LENGTH) | 0;
    result += CHARS[randomIndex];
  }
  return result;
}
