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
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Random string in [A-Za-z0-9], for identifiers that have to be unique between
 * the user's devices.
 *
 * Web Crypto is not present in every runtime the deno component runs in - on
 * Android this is not verified here, and the vendored sql.js makes exactly the
 * same check for itself - so it is used under a guard. The fallback is
 * Math.random(): an engine seeds it from host entropy when the context is
 * created, and *not* from the clock, so two devices started in the same
 * millisecond do not converge on one sequence.
 *
 * That last point is the whole reason this is not generateFastRandomString():
 * that one seeds XorShift128 from Date.now() alone, and its singleton is made
 * when the module loads. A shared appDeviceId is precisely the catastrophe the
 * device id exists to prevent - it is both the LWW tie-break and how a device
 * recognizes its own echo.
 */
export function randomIdStr(length: number): string {
  const chars = new Array<string>(length);
  const hasWebCrypto =
    typeof crypto === 'object' && typeof crypto?.getRandomValues === 'function';

  if (hasWebCrypto) {
    // Rejection sampling: 62 does not divide 256, and taking a byte modulo 62
    // would make the first eight characters of the alphabet likelier than the
    // rest. 248 is the largest multiple of 62 below 256.
    const limit = 256 - (256 % CHARS.length);
    let filled = 0;
    const bytes = new Uint8Array(length);
    while (filled < length) {
      crypto.getRandomValues(bytes);
      for (let i = 0; (i < bytes.length) && (filled < length); i += 1) {
        if (bytes[i] < limit) {
          chars[filled] = CHARS[bytes[i] % CHARS.length];
          filled += 1;
        }
      }
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      chars[i] = CHARS[Math.floor(Math.random() * CHARS.length)];
    }
  }

  return chars.join('');
}
