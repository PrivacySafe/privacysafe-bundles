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
import {
  checkBackupFormatCompatibility,
  checkBackupVersionCompatibility,
} from '@deno/utils/check-backup-version.ts';

describe('checkBackupFormatCompatibility', () => {

  it('accepts an archive written in the layout this build reads', () => {
    expect(checkBackupFormatCompatibility(1, 1)).toBe(true);
  });

  it('rejects a layout this build does not know', () => {
    expect(checkBackupFormatCompatibility(1, 2)).toBe(false);
    expect(checkBackupFormatCompatibility(2, 1)).toBe(false);
  });

  // An archive with no metadata file has no format version to compare. The
  // caller still lets the user proceed - it only decides the wording.
  it('rejects an archive with no format version at all', () => {
    expect(checkBackupFormatCompatibility(1, undefined)).toBe(false);
    expect(checkBackupFormatCompatibility(1, '1' as unknown as number)).toBe(false);
  });

});

describe('checkBackupVersionCompatibility', () => {

  it('matches on major and minor, ignoring the patch', () => {
    expect(checkBackupVersionCompatibility('0.8.34', '0.8.1')).toMatchObject({
      compatible: true, appVersion: '0.8.34', archiveVersion: '0.8.1',
    });
    expect(checkBackupVersionCompatibility('0.8.34', '0.8.34').reason).toBeUndefined();
  });

  it('reports a mismatch of major or minor', () => {
    expect(checkBackupVersionCompatibility('0.9.0', '0.8.34')).toMatchObject({
      compatible: false, reason: 'version_mismatch',
    });
    expect(checkBackupVersionCompatibility('1.0.0', '0.8.34')).toMatchObject({
      compatible: false, reason: 'version_mismatch',
    });
  });

  it('reports a missing archive version', () => {
    expect(checkBackupVersionCompatibility('0.8.34')).toMatchObject({
      compatible: false, reason: 'missing_metadata',
    });
  });

  it('reports a version it cannot read', () => {
    expect(checkBackupVersionCompatibility('0.8.34', '1')).toMatchObject({
      compatible: false, reason: 'invalid_metadata',
    });
  });

  it('tolerates a leading v and surrounding spaces', () => {
    expect(checkBackupVersionCompatibility('v0.8.34', ' 0.8.1 ').compatible).toBe(true);
  });

});
