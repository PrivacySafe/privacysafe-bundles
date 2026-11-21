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
export function generateColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    // Generate a unique number based on the characters in a string
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Use the remainder of the division to obtain the hue (0-360)
  const h = Math.abs(hash % 360);

  return `hsl(${h}, 60%, 40%)`; // S = 60%, L = 40% — a dark enough background for white text
  // return `hsl(${h}, 40%, 35%)`; // pastel colors
}
