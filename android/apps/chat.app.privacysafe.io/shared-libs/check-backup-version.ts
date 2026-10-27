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
// Pure module: no fflate, no sqlite, no `w3n`. Imported from the GUI as well as
// from the deno component, so that both sides describe an archive the same way.

import type { BackupVersionWarning } from '../types/backup.types.ts';

export interface VersionCompatibilityResult {
  compatible: boolean;
  appVersion: string;
  archiveVersion?: string;
  reason?: BackupVersionWarning;
}

/**
 * Whether the archive's layout is one this build knows how to read.
 *
 * This - not the app version - is what actually gates a restore. The archive
 * format and the shape of a record are what break, and they do not change with
 * every minor release: gating on the app version instead would turn every
 * archive taken before the next release into a red "restore at own risk" the
 * day it ships, which trains people to click through the warning.
 *
 * An archive with no metadata file at all has no format version to compare, and
 * is reported as incompatible - the caller still lets the user proceed.
 */
export function checkBackupFormatCompatibility(
  supportedFormatVersion: number,
  archiveFormatVersion: number | undefined,
): boolean {
  return (typeof archiveFormatVersion === 'number')
    && (archiveFormatVersion === supportedFormatVersion);
}

/**
 * Compares the app version with the one the archive was written by.
 *
 * Secondary to checkBackupFormatCompatibility: its answer only picks the wording
 * of the warning shown to the user. Versions count as matching when both major
 * and minor components are equal (X.Y.?).
 */
export function checkBackupVersionCompatibility(
  appVersion: string,
  archiveVersion?: string,
): VersionCompatibilityResult {
  if (!archiveVersion) {
    return {
      compatible: false,
      appVersion,
      reason: 'missing_metadata',
    };
  }

  // Trimmed first: stripping the `v` off an untrimmed string leaves the prefix
  // in place whenever a space precedes it.
  const cleanApp = appVersion.trim().replace(/^v/, '');
  const cleanArchive = archiveVersion.trim().replace(/^v/, '');

  const appParts = cleanApp.split('.');
  const archiveParts = cleanArchive.split('.');

  if ((appParts.length < 2) || (archiveParts.length < 2)) {
    return {
      compatible: false,
      appVersion,
      archiveVersion,
      reason: 'invalid_metadata',
    };
  }

  const isCompatible = (appParts[0] === archiveParts[0]) && (appParts[1] === archiveParts[1]);

  return {
    compatible: isCompatible,
    appVersion,
    archiveVersion,
    ...(!isCompatible && { reason: 'version_mismatch' as const }),
  };
}
