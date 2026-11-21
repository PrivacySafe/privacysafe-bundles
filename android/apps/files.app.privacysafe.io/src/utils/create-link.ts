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

export type LinkTargetType = 'folder' | 'file';

/** What the dialog of a new SymLink gives: its name and the platform's object of its target. */
export interface CreateLinkDialogData {
  name: string;
  target: web3n.files.File | web3n.files.FS;
}

export type CreateLinkErrorKey =
  'fs.create_link_error' | 'fs.name_taken' | 'fs.create_link_error_not_allowed' | 'fs.create_link_error_readonly';

function hasFlag(err: unknown, flag: string): boolean {
  return !!err && typeof err === 'object' && (err as Record<string, unknown>)[flag] === true;
}

/**
 * The message key for an error of fs.link(). The platform refuses a target of
 * another storage with a plain Error: 'Cannot create link to <type> from <type> storage'
 * (synced links only to synced and shared storages, a device folder only to device ones).
 */
export function getCreateLinkErrorKey(err: unknown): CreateLinkErrorKey {
  if (hasFlag(err, 'alreadyExists')) {
    return 'fs.name_taken';
  }
  if (hasFlag(err, 'readonlyLinkTarget')) {
    return 'fs.create_link_error_readonly';
  }
  if (hasFlag(err, 'notLinkableFile') || hasFlag(err, 'notLinkableFolder')) {
    return 'fs.create_link_error_not_allowed';
  }
  const message =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : '';
  if (/cannot create link to/i.test(message)) {
    return 'fs.create_link_error_not_allowed';
  }
  return 'fs.create_link_error';
}
