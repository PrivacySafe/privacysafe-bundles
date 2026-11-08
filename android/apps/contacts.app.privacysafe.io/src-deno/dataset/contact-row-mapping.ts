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
// Pure mapping between contact objects and sqlite rows/params. Type-only
// imports of the sqlite lib keep this module free of its ~1MB runtime bundle,
// so it can be unit-tested directly.
import type { QueryExecResult } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import type { BindParams } from '../../shared-libs/sqlite-on-3nstorage/sqljs';
import type { Person, RawPerson } from '../../src/types/index.ts';
import { isPlainObject, safeJsonParse } from '../utils/obj-processing.ts';

type SqlValue = number | string | Uint8Array | null;

export function objectFromQueryExecResult<T>(sqlResult: QueryExecResult): T[] {
  const { columns, values: rows } = sqlResult;
  return rows.map((row: SqlValue[]) =>
    row.reduce((obj, cellValue, index) => {
      const field = columns[index] as keyof T;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obj[field] = cellValue as any;
      return obj;
    }, {} as T),
  );
}

/**
 * Maps a contact into sqlite bind params. `Person` carries `activities` as an
 * array and `settings` as an object (both get stringified); `RawPerson` carries
 * them already as strings (passed through as they are). Anything else becomes
 * null.
 */
export function personValueToSqlInsertParams(value: Omit<Person, 'avatarImage'> | RawPerson): BindParams {
  return {
    $id: value.id,
    $name: value.name || null,
    $mail: value.mail,
    $avatarId: value.avatarId || null,
    $timestamp: value.timestamp || 0,
    $notice: value.notice || null,
    $phone: value.phone || null,
    $activities: Array.isArray(value.activities)
      ? JSON.stringify(value.activities)
      : typeof value.activities === 'string'
        ? value.activities
        : null,
    $settings: isPlainObject(value.settings)
      ? JSON.stringify(value.settings)
      : typeof value.settings === 'string'
        ? value.settings
        : null,
  };
}

/**
 * Reads one row into a contact, parsing the JSON columns.
 *
 * safeJsonParse rather than a bare JSON.parse: a malformed value used to take
 * the whole read down, while updateContactInto tolerated the same value on the
 * way out. A column that cannot be parsed falls back to the empty shape, so a
 * single damaged row costs its own activities or settings and not the contact.
 */
export function queryResultToPerson(sqlResult: QueryExecResult, row = 0): Omit<Person, 'avatarImage'> {
  const person = objectFromQueryExecResult<Omit<Person, 'avatarImage'>>(sqlResult)[row];
  person.activities = (person.activities !== null && person.activities !== undefined)
    ? (safeJsonParse<Person['activities']>(person.activities as unknown as string) ?? [])
    : [];
  person.settings = (person.settings !== null && person.settings !== undefined)
    ? (safeJsonParse<Person['settings']>(person.settings as unknown as string) ?? {})
    : {};
  return person;
}
