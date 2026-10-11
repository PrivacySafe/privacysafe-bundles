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
export function timeInSecondsToString(timeInSeconds: number): string {
  let remainder = timeInSeconds;
  const hours = remainder > 3600 ? `${Math.floor(remainder / 3600)}` : 0;
  remainder = remainder % 3600;
  const minutes = `${Math.floor(remainder / 60)}`;
  const seconds = `${Math.floor(remainder % 60)}`;
  const str = `${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
  return hours === 0 ? str : `${hours.padStart(2, '0')}:${str}`;
}
