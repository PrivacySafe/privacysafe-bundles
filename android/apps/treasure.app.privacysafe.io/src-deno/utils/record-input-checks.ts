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
// Checks for what a backup file or another device puts into the storage.
//
// A backup archive is a file the user was handed, and an unencrypted one is
// whatever its author wrote. A restore writes it into the synced storage, so it
// reaches every device of the user. Ids found inside records are used as file
// names - a record with `id: "groups"` or an image id `../x` would rewrite or
// delete a file that is not its own (audit of 2026-11-26).
//
// Kept free of w3n so that both the service and the specs can use it. Of fflate
// only its UTF-8 decoder is taken: the bare V8 isolate the deno component runs
// in on Android has no TextDecoder.
import { strFromU8 } from 'fflate/browser';
import { GROUPS_FILE_NAME, IMAGES_FOLDER, RECENT_FILE_NAME } from '../../shared/constants.ts';

/** A file at the root that is not a record, and is not this app's to check. */
export const CONFS_FILE_NAME = 'confs.json';

/** More entries than this in one archive is not a backup of a password vault. */
export const MAX_RESTORE_ENTRIES = 20_000;
export const MAX_ID_LENGTH = 128;
export const MAX_GROUPS = 1_000;
export const MAX_IMAGES_PER_RECORD = 100;
/** Name-like fields: one line. */
export const MAX_NAME_LENGTH = 1_000;
/** Secrets and other free text. */
export const MAX_TEXT_LENGTH = 10_000;

const RECORD_TYPES = ['password', 'card', 'bank_card'];
const RESERVED_NAMES = [GROUPS_FILE_NAME, IMAGES_FOLDER, RECENT_FILE_NAME, CONFS_FILE_NAME] as string[];

/**
 * An id that is used as a file name: no path in it, nothing hidden, no control
 * characters, and none of the names the app keeps for itself. Ids this app
 * makes are 20 url-safe base64 characters; the rule is looser than that so that
 * nothing written by an older build is turned away.
 */
export function isSafeFileId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_ID_LENGTH &&
    !id.startsWith('.') &&
    // eslint-disable-next-line no-control-regex -- control characters are what it looks for
    !/[/\\\u0000-\u001f\u007f]/.test(id) &&
    !RESERVED_NAMES.includes(id)
  );
}

function isBoundedString(value: unknown, max: number, oneLine = false): boolean {
  return typeof value === 'string' && value.length <= max && !(oneLine && /[\r\n]/.test(value));
}

function isOptional(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || value === null || check(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

/** Answers why the value is not a record stored as `fileName`, or undefined if it is one. */
export function recordProblem(value: unknown, fileName: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'not an object';
  }

  const r = value as Record<string, unknown>;
  if (r.id !== fileName || !isSafeFileId(r.id)) {
    return 'id does not match the file name';
  }
  if (typeof r.type !== 'string' || !RECORD_TYPES.includes(r.type)) {
    return 'unknown type';
  }

  const nameFields = ['name', 'username', 'exp', 'group'];
  for (const field of nameFields) {
    if (!isOptional(r[field], v => isBoundedString(v, MAX_NAME_LENGTH, true))) {
      return `bad ${field}`;
    }
  }

  const textFields = ['resource', 'password'];
  for (const field of textFields) {
    if (!isOptional(r[field], v => isBoundedString(v, MAX_TEXT_LENGTH))) {
      return `bad ${field}`;
    }
  }

  for (const field of ['source', 'reference']) {
    if (!isOptional(r[field], isSafeFileId)) {
      return `bad ${field}`;
    }
  }

  if (!isOptionalBoolean(r.isFavorite) || !isOptionalBoolean(r.withoutSync)) {
    return 'bad flags';
  }

  if (r.images !== undefined) {
    if (
      !Array.isArray(r.images) ||
      r.images.length > MAX_IMAGES_PER_RECORD ||
      !r.images.every(isSafeFileId)
    ) {
      return 'bad images';
    }
  }

  return undefined;
}

/** Answers why the value is not a list of groups, or undefined if it is one. */
export function groupsProblem(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return 'not a list';
  }
  if (value.length > MAX_GROUPS) {
    return 'too many groups';
  }

  for (const group of value) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      return 'group is not an object';
    }
    const g = group as Record<string, unknown>;
    if (!isBoundedString(g.id, MAX_NAME_LENGTH, true) || !(g.id as string)) {
      return 'bad group id';
    }
    if (!isBoundedString(g.name, MAX_NAME_LENGTH, true)) {
      return 'bad group name';
    }
    if (!isOptional(g.description, v => isBoundedString(v, MAX_TEXT_LENGTH))) {
      return 'bad group description';
    }
    if (!isOptionalBoolean(g.withoutSync)) {
      return 'bad group flags';
    }
  }

  return undefined;
}

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  return prefix.every((b, i) => bytes[offset + i] === b);
}

/**
 * The formats the app writes or lets the user pick: PNG and JPEG uploads, WebP
 * thumbnails; GIF for good measure. SVG is not one of them - it is a document
 * that can carry script.
 */
export function isRasterImage(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) || // GIF8
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) // RIFF....WEBP
  );
}

function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(strFromU8(bytes)) };
  } catch {
    return { ok: false };
  }
}

/**
 * Answers why an archive entry must not be written into the storage, or
 * undefined when it may be. Only the files the app itself keeps are accepted:
 * the groups list, records at the root, images in their folder, and the
 * platform's settings file (an object).
 */
export function restoreEntryProblem(path: string, bytes: Uint8Array): string | undefined {
  if (path.startsWith(`${IMAGES_FOLDER}/`)) {
    const id = path.slice(IMAGES_FOLDER.length + 1);
    if (!isSafeFileId(id)) {
      return 'bad image id';
    }
    return isRasterImage(bytes) ? undefined : 'not a raster image';
  }

  if (path.includes('/')) {
    return 'not a file the app keeps';
  }

  const parsed = parseJson(bytes);
  if (!parsed.ok) {
    return 'not json';
  }

  if (path === GROUPS_FILE_NAME) {
    return groupsProblem(parsed.value);
  }

  if (path === CONFS_FILE_NAME) {
    const v = parsed.value;
    return v && typeof v === 'object' && !Array.isArray(v) ? undefined : 'not an object';
  }

  if (!isSafeFileId(path)) {
    return 'not a file the app keeps';
  }

  return recordProblem(parsed.value, path);
}
