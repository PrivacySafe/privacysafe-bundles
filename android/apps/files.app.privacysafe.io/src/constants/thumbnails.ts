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
 * Making a thumbnail reads the whole file into memory (images, PDFs, and videos
 * stored in 3N, which are turned into an in-memory File). Bigger files get none.
 */
export const THUMBNAIL_SOURCE_SIZE_LIMIT = 30 * 1024 * 1024;

/** Thumbnails made during the session; a thumbnail is about 10–30 KB. */
export const THUMBNAIL_CACHE_SIZE = 500;
