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
import type { ListingEntryExtended } from '@shared/types';
import { getFileExtension } from '@shared/utils/various';

type Comparable = string | number | undefined;

const TYPE_ORDER: Record<ListingEntryExtended['type'], number> = {
  folder: 0,
  'link-folder': 1,
  file: 2,
  'link-file': 3,
  'link-broken': 4,
};

function sortKey(entry: ListingEntryExtended, field: keyof ListingEntryExtended): Comparable {
  if (field === 'type') {
    let ext = '';
    if (entry.type === 'file') {
      ext = entry.ext ?? '';
    } else if (entry.type === 'link-file') {
      ext = getFileExtension(entry.name);
    }
    return `${TYPE_ORDER[entry.type]}-${ext}`;
  }

  const value = entry[field];
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string') {
    return value.toLowerCase();
  }

  return typeof value === 'number' ? value : undefined;
}

function compareKeys(a: Comparable, b: Comparable): number {
  if (a === b) {
    return 0;
  }

  // entries without a value (e.g. the size of a folder) go first
  if (a === undefined) {
    return -1;
  }

  if (b === undefined) {
    return 1;
  }

  return a > b ? 1 : -1;
}

/**
 * Comparator for folder listings: 'asc' puts smaller values first (A→Z, older,
 * smaller), 'desc' reverses the order. Equal keys are ordered by name in the
 * same direction, so the order is stable between renders.
 */
export function compareListingEntries(
  a: ListingEntryExtended,
  b: ListingEntryExtended,
  field: keyof ListingEntryExtended,
  direction: 'asc' | 'desc',
): number {
  const sign = direction === 'asc' ? 1 : -1;
  const byField = compareKeys(sortKey(a, field), sortKey(b, field));
  if (byField !== 0) {
    return byField * sign;
  }
  return compareKeys(sortKey(a, 'name'), sortKey(b, 'name')) * sign;
}
