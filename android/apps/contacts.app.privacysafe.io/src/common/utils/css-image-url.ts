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

const allowedImageSrc = /^(data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+|blob:[^\s"'()\\]+)$/;

/**
 * A CSS `url("...")` for an avatar, or undefined for a value that is not an
 * inline raster image or a blob URL.
 *
 * Avatars come from places others can write to - a restored backup, a shared
 * contacts file - and were put into `url(...)` unquoted, so a value like
 * `x), url(https://...` added layers of its own (audit of 2026-11-26).
 */
export function cssImageUrl(src: string | undefined | null): string | undefined {
  const value = (typeof src === 'string') ? src.trim() : '';
  return allowedImageSrc.test(value) ? `url("${value}")` : undefined;
}
