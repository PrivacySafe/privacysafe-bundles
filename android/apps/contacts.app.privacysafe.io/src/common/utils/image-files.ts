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

import { b64ToBlob } from "@v1nt1248/3nclient-lib/utils";

export function blobFromDataURL(dataURL: string): Blob {
  const b64Start = dataURL.indexOf(';base64,');
  if (b64Start < 8) {
    throw new Error(`Fail to parse given string as data url`);
  }
  const mimeType = dataURL.substring(5, b64Start);
  return b64ToBlob(dataURL.substring(b64Start+8), mimeType);
}
