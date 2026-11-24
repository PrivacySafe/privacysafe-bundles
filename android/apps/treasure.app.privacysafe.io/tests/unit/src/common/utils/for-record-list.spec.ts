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
import { describe, expect, it } from 'vitest';
import { getRecordListPlaceholder } from '@/common/utils/for-record-list';

const base = {
  areRecordsLoaded: true,
  recordsLoadFailed: false,
  totalRecords: 5,
  shownRecords: 0,
  searchText: '',
};

describe('getRecordListPlaceholder', () => {
  it('shows nothing over a list that has rows', () => {
    expect(getRecordListPlaceholder({ ...base, shownRecords: 2 })).toBeNull();
  });

  it('says the records are being read until the first reading ends', () => {
    expect(getRecordListPlaceholder({ ...base, areRecordsLoaded: false, totalRecords: 0 })).toBe('loading');
  });

  it('tells no records at all from an empty group', () => {
    expect(getRecordListPlaceholder({ ...base, totalRecords: 0 })).toBe('no-records');
    expect(getRecordListPlaceholder(base)).toBe('group-empty');
  });

  it('blames the search when the search hides every record', () => {
    expect(getRecordListPlaceholder({ ...base, searchText: 'bank' })).toBe('no-matches');
    expect(getRecordListPlaceholder({ ...base, searchText: '   ' })).toBe('group-empty');
  });

  it('reports a failed reading only when nothing could be shown', () => {
    expect(getRecordListPlaceholder({ ...base, totalRecords: 0, recordsLoadFailed: true })).toBe('failed');
    expect(getRecordListPlaceholder({ ...base, recordsLoadFailed: true })).toBe('group-empty');
  });
});
