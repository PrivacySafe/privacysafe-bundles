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
*/
// A key that is not in en.ts renders as the key itself - vue-i18n does not
// fail, it just shows `app.btn.save` to the user. Nothing else catches that,
// so the sources are scanned for the keys they ask for.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/common/i18n/en';

const SRC = resolve(import.meta.dirname, '../../../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return (/\.(ts|vue)$/.test(name) && !name.endsWith('.d.ts')) ? [path] : [];
  });
}

function valueAt(key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => ((node && typeof node === 'object')
      ? (node as Record<string, unknown>)[part]
      : undefined),
    en,
  );
}

const TOP_LEVEL = new Set(Object.keys(en));

/**
 * Keys the sources ask for, by file.
 *
 * Two shapes are picked up: a `t('...')` call, and a bare string that looks
 * like a key and starts with one of en.ts's own top-level names - which is how
 * the map of archive errors to messages is written. Keys built by template
 * string are skipped: there is no literal to check.
 */
function keysUsedIn(source: string): string[] {
  const keys = new Set<string>();

  for (const [, key] of source.matchAll(/\bt\(\s*'([^'${}]+)'/g)) {
    keys.add(key);
  }

  for (const [, key] of source.matchAll(/'([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)'/g)) {
    if (TOP_LEVEL.has(key.split('.')[0])) {
      keys.add(key);
    }
  }

  return [...keys];
}

describe('i18n keys', () => {

  const files = sourceFiles(SRC);

  it('finds the sources to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has every key the sources ask for', () => {
    const missing: string[] = [];

    for (const path of files) {
      for (const key of keysUsedIn(readFileSync(path, 'utf8'))) {
        if (typeof valueAt(key) !== 'string') {
          missing.push(`${key} (${path.slice(SRC.length + 1)})`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  // The dialog that asks for a backup passphrase reuses these, and a missing
  // one shows the raw key on a button.
  it('has the shared button labels', () => {
    expect(valueAt('app.btn.save')).toBe('Save');
    expect(valueAt('app.btn.cancel')).toBe('Cancel');
  });

});
