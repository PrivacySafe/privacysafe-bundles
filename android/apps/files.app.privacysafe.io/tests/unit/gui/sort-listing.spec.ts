import { describe, expect, it } from 'vitest';
import type { ListingEntryExtended } from '../../../shared/types/index.ts';
import { compareListingEntries } from '../../../src/utils/sort-listing.ts';

const entry = (name: string, extra: Partial<ListingEntryExtended> = {}): ListingEntryExtended => ({
  id: name,
  name,
  fullPath: name,
  type: 'file',
  ext: name.split('.').pop(),
  ...extra,
});

const sorted = (list: ListingEntryExtended[], field: keyof ListingEntryExtended, direction: 'asc' | 'desc') =>
  [...list].sort((x, y) => compareListingEntries(x, y, field, direction)).map(e => e.name);

describe('compareListingEntries', () => {
  // Regression for plan 4.3: the direction names were inverted ('desc' gave A→Z).
  it("sorts ascending for 'asc' and descending for 'desc'", () => {
    const list = [entry('c.txt'), entry('A.txt'), entry('b.txt')];

    expect(sorted(list, 'name', 'asc')).toEqual(['A.txt', 'b.txt', 'c.txt']);
    expect(sorted(list, 'name', 'desc')).toEqual(['c.txt', 'b.txt', 'A.txt']);
  });

  // Regression for plan 4.3: the comparator never returned 0, so entries with
  // equal keys (same size or date) changed places between renders.
  it('returns 0 only for entries with equal keys and names', () => {
    const a = entry('a.txt', { size: 10 });
    expect(compareListingEntries(a, { ...a }, 'size', 'asc')).toBe(0);
  });

  it('orders entries with equal keys by name, consistently in both argument orders', () => {
    const a = entry('a.txt', { size: 10 });
    const b = entry('b.txt', { size: 10 });

    expect(Math.sign(compareListingEntries(a, b, 'size', 'asc'))).toBe(
      -Math.sign(compareListingEntries(b, a, 'size', 'asc')),
    );
    expect(sorted([b, a], 'size', 'asc')).toEqual(['a.txt', 'b.txt']);
  });

  it('compares dates by time', () => {
    const older = entry('older', { mtime: new Date('2024-01-01') });
    const newer = entry('newer', { mtime: new Date('2025-01-01') });

    expect(sorted([newer, older], 'mtime', 'asc')).toEqual(['older', 'newer']);
    expect(sorted([older, newer], 'mtime', 'desc')).toEqual(['newer', 'older']);
  });

  it("puts folders before files when sorting by type 'asc' (the default view)", () => {
    const list = [entry('a.txt'), entry('z', { type: 'folder', ext: undefined })];

    expect(sorted(list, 'type', 'asc')).toEqual(['z', 'a.txt']);
    expect(sorted(list, 'type', 'desc')).toEqual(['a.txt', 'z']);
  });

  it("puts entries without a value first for 'asc'", () => {
    const folder = entry('dir', { type: 'folder', size: undefined });
    const file = entry('a.txt', { size: 1 });

    expect(sorted([file, folder], 'size', 'asc')).toEqual(['dir', 'a.txt']);
  });
});
