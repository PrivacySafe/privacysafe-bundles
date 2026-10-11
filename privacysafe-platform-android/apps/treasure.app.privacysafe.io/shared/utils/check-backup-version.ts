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

export interface VersionCompatibilityResult {
  compatible: boolean;
  appVersion: string;
  archiveVersion?: string;
  reason?: 'missing_metadata' | 'invalid_metadata' | 'version_mismatch';
}

/**
 * Whether this build can read the archive's layout.
 *
 * Strict equality, and an archive without a format version is not compatible:
 * archives written before the format was introduced carry no guarantee about
 * their entries. They can still be restored, but only past the warning.
 */
export function checkBackupFormatCompatibility(
  supportedFormatVersion: number,
  archiveFormatVersion: number | undefined,
): boolean {
  return typeof archiveFormatVersion === 'number' && archiveFormatVersion === supportedFormatVersion;
}

/**
 * Checks compatibility between app version and backup archive version.
 * Compatible if major and minor components match (X.Y.?).
 *
 * Secondary to checkBackupFormatCompatibility: its answer only picks the
 * wording of the warning the user is shown.
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

  // Trimmed before the `v` is stripped: the other way round a leading space
  // shields the prefix, and `v0` then reads as the major component.
  const cleanApp = appVersion.trim().replace(/^v/, '');
  const cleanArch = archiveVersion.trim().replace(/^v/, '');

  const appParts = cleanApp.split('.');
  const archParts = cleanArch.split('.');

  if (appParts.length < 2 || archParts.length < 2) {
    return {
      compatible: false,
      appVersion,
      archiveVersion,
      reason: 'invalid_metadata',
    };
  }

  const isCompatible = appParts[0] === archParts[0] && appParts[1] === archParts[1];

  return {
    compatible: isCompatible,
    appVersion,
    archiveVersion,
    ...(!isCompatible && { reason: 'version_mismatch' }),
  };
}
