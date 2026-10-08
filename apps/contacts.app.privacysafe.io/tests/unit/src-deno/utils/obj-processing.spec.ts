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
import { describe, expect, it, vi } from 'vitest';
import { isPlainObject, normalizeJsonField, safeJsonParse } from '@deno/utils/obj-processing.ts';

describe('normalizeJsonField', () => {

  it('maps absent values to null', () => {
    expect(normalizeJsonField(null)).toBeNull();
    expect(normalizeJsonField(undefined)).toBeNull();
  });

  it('maps empty and empty-container values to null', () => {
    for (const value of ['', '   ', '{}', '[]']) {
      expect(normalizeJsonField(value)).toBeNull();
    }
  });

  it('passes real JSON through, trimmed', () => {
    expect(normalizeJsonField('{"a":1}')).toBe('{"a":1}');
    expect(normalizeJsonField('[1,2]')).toBe('[1,2]');
    expect(normalizeJsonField('  {"a":1}  ')).toBe('{"a":1}');
  });

  it('passes a non-JSON string through unchanged', () => {
    expect(normalizeJsonField('plain')).toBe('plain');
  });

  it('strips the outer quotes off a quoted empty container', () => {
    expect(normalizeJsonField('"{}"')).toBeNull();
  });

  it('maps degenerate quote-only values to null', () => {
    expect(normalizeJsonField('"')).toBeNull();
    expect(normalizeJsonField('""')).toBeNull();
  });

  // Documents a limitation rather than an intent: only the OUTER quotes come
  // off. The inner backslashes survive, so the result of unwrapping a
  // double-encoded value is NOT parseable JSON. Callers must not assume the
  // output of this function can be handed to JSON.parse.
  it('does not unescape inner quotes of a double-encoded value', () => {
    const doubleEncoded = '"{\\"a\\":1}"';

    const normalized = normalizeJsonField(doubleEncoded);

    expect(normalized).toBe('{\\"a\\":1}');
    expect(() => JSON.parse(normalized!)).toThrow();
  });

});

describe('safeJsonParse', () => {

  it('parses valid JSON', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for malformed JSON instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(safeJsonParse('nope')).toBeNull();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('returns null for empty input without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(safeJsonParse('')).toBeNull();
    expect(safeJsonParse(null)).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

});

describe('isPlainObject', () => {

  it('accepts object literals', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it('rejects arrays, null and primitives', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('str')).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject(7)).toBe(false);
  });

  // The check is `typeof === 'object' && !null && !Array`, so any non-array
  // object instance passes. Documented because callers use it to decide
  // "should I JSON.stringify this?" — and a Date stringifies to a quoted
  // string, not to an object.
  it('also accepts non-plain object instances, such as Date', () => {
    expect(isPlainObject(new Date(0))).toBe(true);
  });

});
