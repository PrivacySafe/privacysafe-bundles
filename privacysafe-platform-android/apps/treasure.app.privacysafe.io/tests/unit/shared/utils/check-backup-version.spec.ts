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
import { describe, expect, it } from 'vitest';
import {
  checkBackupFormatCompatibility,
  checkBackupVersionCompatibility,
} from '@shared/utils/check-backup-version';
import { BACKUP_FORMAT_VERSION } from '@shared/utils/backup-archive';

describe('checkBackupFormatCompatibility', () => {

  it('accepts only the layout this build knows', () => {
    expect(checkBackupFormatCompatibility(1, 1)).toBe(true);
    expect(checkBackupFormatCompatibility(1, 2)).toBe(false);
    expect(checkBackupFormatCompatibility(1, 0)).toBe(false);
  });

  // Archives written before the field existed carry no guarantee about their
  // entries. They can still be restored, but only past the warning.
  it('refuses an archive that carries no format version', () => {
    expect(checkBackupFormatCompatibility(1, undefined)).toBe(false);
  });

  it('refuses a format version that is not a number', () => {
    expect(checkBackupFormatCompatibility(1, '1' as unknown as number)).toBe(false);
    expect(checkBackupFormatCompatibility(1, NaN)).toBe(false);
  });

  it('accepts what this build itself writes', () => {
    expect(checkBackupFormatCompatibility(BACKUP_FORMAT_VERSION, BACKUP_FORMAT_VERSION))
    .toBe(true);
  });

});

describe('checkBackupVersionCompatibility', () => {

  it('accepts a matching major and minor, whatever the patch', () => {
    expect(checkBackupVersionCompatibility('0.2.3', '0.2.1').compatible).toBe(true);
    expect(checkBackupVersionCompatibility('0.2.3', '0.2.99').compatible).toBe(true);
  });

  it('reports a mismatch of either major or minor', () => {
    const minor = checkBackupVersionCompatibility('0.2.3', '0.3.0');
    expect(minor.compatible).toBe(false);
    expect(minor.reason).toBe('version_mismatch');

    const major = checkBackupVersionCompatibility('0.2.3', '1.2.3');
    expect(major.compatible).toBe(false);
    expect(major.reason).toBe('version_mismatch');
  });

  it('tolerates a leading v and surrounding spaces', () => {
    expect(checkBackupVersionCompatibility(' v0.2.3 ', 'v0.2.0').compatible).toBe(true);
  });

  it('names a missing archive version as such', () => {
    const res = checkBackupVersionCompatibility('0.2.3', undefined);

    expect(res.compatible).toBe(false);
    expect(res.reason).toBe('missing_metadata');
  });

  it('names a version it cannot read as invalid', () => {
    const res = checkBackupVersionCompatibility('0.2.3', 'nonsense');

    expect(res.compatible).toBe(false);
    expect(res.reason).toBe('invalid_metadata');
  });

  it('echoes both versions back for the warning to quote', () => {
    const res = checkBackupVersionCompatibility('0.2.3', '0.1.0');

    expect(res.appVersion).toBe('0.2.3');
    expect(res.archiveVersion).toBe('0.1.0');
  });

});
