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

/**
 * Rounding with a given accuracy
 * @param num {number}
 * @param precision {number} - rounding accuracy (number of digits after the decimal point
 * indicated with the "-" sign)
 * @return {number}
 */
export function round(num: number, precision: number): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tmpNum = num.toString().split('e') as any;
  tmpNum = Math.round(+(tmpNum[0] + 'e' + (tmpNum[1] ? +tmpNum[1] - precision : -precision)));
  tmpNum = tmpNum.toString().split('e');
  return +(tmpNum[0] + 'e' + (tmpNum[1] ? +tmpNum[1] - +precision : precision));
}
