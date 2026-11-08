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
export const CONTACTS_DB_FILE = 'contacts-db' as string;
export const IMAGES_FOLDER = 'images' as string;

/** Extension of export files with contacts, shared with other users. */
export const SHARE_FILE_EXT = 'w3nec' as string;
/** Data file of an export file, with an array of SharedPerson. */
export const SHARE_DATA_FILE = 'contacts.json' as string;
export const SHARE_DATA_VERSION = 1;
/** Folder with avatars in an export file. */
export const SHARE_IMAGES_FOLDER = 'images' as string;
/** Folder in the app's local fs, where export files wait to be handed over. */
export const SHARE_TMP_FOLDER = 'share-exports' as string;
