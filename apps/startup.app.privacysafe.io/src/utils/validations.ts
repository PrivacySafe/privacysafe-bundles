/*
 Copyright (C) 2025 3NSoft Inc.

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

import { UnicodeRanges } from "./unicode-ranges";

export function isCharAllowed(
  char: string, allowedRanges: UnicodeRanges
): boolean {
  const code = char.charCodeAt(0);
  for (const { first, last } of allowedRanges) {
    if ((first <= code) && (code <= last)) {
      return true;
    }
  }
  return false;
}

export function findIndexOfFirstDisallowedCharIn(
  str: string, allowedRanges: UnicodeRanges
): number {
  for (let i=0; i<str.length; i+=1) {
    if (!isCharAllowed(str[i], allowedRanges)) {
      return i;
    }
  }
  return -1;
}

export function isStringOk(str: string, allowedRanges: UnicodeRanges): boolean {
	return (str.length === 0) || (findIndexOfFirstDisallowedCharIn(str, allowedRanges) < 0);
}
