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
import { syncStuckWarningKey } from '@main/common/utils/sync-stuck-warning';
import { en } from '@main/common/data/i18/en';

describe('syncStuckWarningKey', () => {

  // A server that does not answer is not cured by a restart, which the old
  // text recommended.
  it('blames the server for a root that cannot be verified', () => {
    expect(syncStuckWarningKey('root-folder-not-verified')).toBe('app.warning.server-unreachable');
  });

  it('keeps the words about changes the server refuses', () => {
    expect(syncStuckWarningKey('local-version-not-published')).toBe('app.warning.changes-not-published');
  });

  it('falls back to the general words', () => {
    expect(syncStuckWarningKey(undefined)).toBe('app.warning.sync-stuck');
    expect(syncStuckWarningKey('something-new')).toBe('app.warning.sync-stuck');
  });

  it('names keys that exist', () => {
    for (const reason of ['root-folder-not-verified', 'local-version-not-published', undefined]) {
      const key = syncStuckWarningKey(reason).replace('app.warning.', '');
      expect(en.app.warning).toHaveProperty([key]);
    }
  });

});
