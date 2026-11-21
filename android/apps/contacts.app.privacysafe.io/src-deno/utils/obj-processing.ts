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
// A type predicate rather than a plain boolean: callers narrow a string-or-object
// field on it, and without the narrowing each such branch needs its own cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPlainObject(arg: any): arg is Record<string, unknown> {
  return typeof arg === 'object' && arg !== null && !Array.isArray(arg);
}

export function normalizeJsonField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  let current = value.trim();

  while (
    (current.startsWith('"') && current.endsWith('"')) ||
    (current.startsWith('\\"') && current.endsWith('\\"'))
  ) {
    const unescaped = current.replace(/^\\*"/, '').replace(/\\*"$/, '');
    if (unescaped === current) {
      break;
    }

    current = unescaped.trim();
  }

  if (current === '{}' || current === '[]' || current === '') {
    return null;
  }

  return current;
}

export function safeJsonParse<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch (e) {
    console.warn('JSON parsing error. ', e);
    return null;
  }
}
