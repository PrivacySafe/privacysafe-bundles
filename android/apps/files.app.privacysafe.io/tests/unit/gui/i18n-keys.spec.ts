import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../../../src/data/i18/en.ts';

const ROOT = new URL('../../../', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|vue)$/.test(name) ? [path] : [];
  });
}

function hasMessage(key: string): boolean {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
  return typeof value === 'string';
}

// t('literal.key') and t(`prefix.${expr}`) calls in the GUI and the pickers
const STATIC_KEY = /\bt\(\s*'([\w.-]+)'/g;

// Regression for plans 4.2 and 7.6: keys like 'app.resolve.text' did not exist,
// and the user saw the raw key, as missing keys are not reported in production.
describe('i18n keys', () => {
  const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'src-file-picker'))];

  it('has a message for every static key used in the code', () => {
    const missing = files.flatMap(file =>
      [...readFileSync(file, 'utf-8').matchAll(STATIC_KEY)]
        .map(match => match[1])
        .filter(key => !hasMessage(key))
        .map(key => `${key} (${file.slice(ROOT.length)})`),
    );

    expect(missing).toEqual([]);
  });

  it('has messages for every sync state and entity type shown by dynamic keys', () => {
    for (const state of ['synced', 'unsynced', 'behind', 'conflicting', 'remote']) {
      expect(hasMessage(`fs.sync_state.${state}`), state).toBe(true);
    }
    for (const type of ['folder', 'file', 'link']) {
      expect(hasMessage(`fs.entity.info.type_${type}`), type).toBe(true);
    }
  });
});
