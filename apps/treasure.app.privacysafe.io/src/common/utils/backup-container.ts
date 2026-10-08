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
// The outer layer of a backup file: metadata, and - when a passphrase is used -
// the encrypted payload wrapping the archive the deno service packed.
//
// The synchronous fflate api is used deliberately: the asynchronous one spins
// up a worker through URL.createObjectURL, which is not something to rely on
// inside the platform's webview.
import { unzipSync, zipSync } from 'fflate';
import {
  METADATA_FILE_NAME,
  PAYLOAD_FILE_NAME,
  APP_DOMAIN,
  BACKUP_FORMAT_VERSION,
  isForeignAppMetadataPath,
  isSafeArchivePath,
  makeBackupMetadataBytes,
  type BackupMetadataContent,
} from '@shared/utils/backup-archive';
import {
  checkBackupFormatCompatibility,
  checkBackupVersionCompatibility,
} from '@shared/utils/check-backup-version';
import { decryptPayload, encryptPayload, isSubtleCryptoAvailable } from './backup-crypto';
import type { BackupArchiveError, BackupValidationResult } from '@shared/@types';

/**
 * Carries the reason an archive cannot be used, so the caller can tell a wrong
 * passphrase - which is worth asking about again - from a broken file.
 */
export class BackupArchiveFailure extends Error {
  constructor(public readonly reason: BackupArchiveError) {
    super(`Backup archive cannot be used: ${reason}`);
    this.name = 'BackupArchiveFailure';
  }
}

export interface OpenedBackupContainer {
  /** Bytes of the archive the deno service knows how to read. */
  plainZipBytes: Uint8Array;
  metadata?: BackupMetadataContent;
  /** The metadata file is there, but is not json this build can read. */
  metadataInvalid: boolean;
  encrypted: boolean;
}

function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Wraps an archive into a passphrase-protected container.
 *
 * The inner archive goes in as one opaque entry, so an encrypted archive
 * discloses nothing beyond its own metadata - not how many records are stored,
 * not even how many images there are.
 */
export async function packEncryptedContainer(
  innerZipBytes: Uint8Array,
  passphrase: string,
  appVersion: string,
): Promise<Uint8Array> {
  const { cipher, params } = await encryptPayload(innerZipBytes, passphrase);

  return zipSync({
    [METADATA_FILE_NAME]: makeBackupMetadataBytes({ version: appVersion, encryption: params }),
    // Ciphertext does not compress, so it is stored rather than deflated.
    [PAYLOAD_FILE_NAME]: [cipher, { level: 0 }],
  });
}

/**
 * Reads the outer layer of a backup file, decrypting the payload when the
 * archive carries one.
 *
 * Throws BackupArchiveFailure('passphrase_required') when the archive is
 * encrypted and no passphrase was given, so the caller can ask for one and try
 * again with the same bytes.
 */
export async function openBackupContainer(
  fileBytes: Uint8Array,
  passphrase?: string,
): Promise<OpenedBackupContainer> {
  let outer: Record<string, Uint8Array>;
  try {
    outer = unzipSync(fileBytes);
  } catch {
    throw new BackupArchiveFailure('corrupted_archive');
  }

  let metadata: BackupMetadataContent | undefined;
  let metadataInvalid = false;
  const metadataBytes = outer[METADATA_FILE_NAME];
  if (metadataBytes) {
    try {
      metadata = JSON.parse(fromUtf8(metadataBytes)) as BackupMetadataContent;
    } catch {
      metadataInvalid = true;
    }
  }

  // Only checked when the field is there: archives written before it was added
  // carry no domain, and those are still ours to restore.
  if (metadata?.appDomain && metadata.appDomain !== APP_DOMAIN) {
    throw new BackupArchiveFailure('foreign_archive');
  }

  // Caught before a passphrase is asked for: another app's archive is not worth
  // making the user type anything, and its entries would otherwise look
  // restorable enough to reach the storage.
  if (!metadataBytes && Object.keys(outer).some(isForeignAppMetadataPath)) {
    throw new BackupArchiveFailure('foreign_archive');
  }

  const encryption = metadata?.encryption;
  if (!encryption) {
    return { plainZipBytes: fileBytes, metadata, metadataInvalid, encrypted: false };
  }

  if (!isSubtleCryptoAvailable()) {
    throw new BackupArchiveFailure('encryption_unsupported');
  }
  if (!passphrase) {
    throw new BackupArchiveFailure('passphrase_required');
  }

  const payload = outer[PAYLOAD_FILE_NAME];
  if (!payload) {
    throw new BackupArchiveFailure('corrupted_archive');
  }

  let plainZipBytes: Uint8Array;
  try {
    plainZipBytes = await decryptPayload(payload, passphrase, encryption);
  } catch {
    // AES-GCM refusing the tag IS the wrong-passphrase answer; there is no
    // other check to make, and no way to tell a wrong key from tampering.
    throw new BackupArchiveFailure('wrong_passphrase');
  }

  return { plainZipBytes, metadata, metadataInvalid, encrypted: true };
}

/**
 * Whether an opened archive can be restored, and with what warning.
 *
 * Done here rather than in the deno service: an encrypted archive keeps its
 * metadata in the OUTER container, which the service never sees - it is handed
 * the decrypted inner archive only.
 */
export function validateBackupContainer(
  opened: OpenedBackupContainer,
  appVersion: string,
): BackupValidationResult {
  const { plainZipBytes, metadata, metadataInvalid, encrypted } = opened;

  let usableEntries = 0;
  try {
    // Counted through the filter rather than by unpacking: returning false
    // leaves the entry compressed, so nothing is paid to decompress it.
    unzipSync(plainZipBytes, {
      filter: file => {
        if (isSafeArchivePath(file.name)) {
          usableEntries += 1;
        }
        return false;
      },
    });
  } catch {
    return { valid: false, compatible: false, appVersion, encrypted, error: 'corrupted_archive' };
  }

  if (usableEntries === 0) {
    // Unpacks, but holds nothing this app could restore - most likely a backup
    // of a different app, which is worth catching before a destructive restore.
    return { valid: false, compatible: false, appVersion, encrypted, error: 'foreign_archive' };
  }

  const compatible = checkBackupFormatCompatibility(BACKUP_FORMAT_VERSION, metadata?.formatVersion);
  const versionCheck = checkBackupVersionCompatibility(appVersion, metadata?.version);
  const warningReason = metadataInvalid
    ? ('invalid_metadata' as const)
    : !metadata
      ? ('missing_metadata' as const)
      : versionCheck.reason;

  return {
    valid: true,
    compatible,
    appVersion,
    archiveVersion: metadata?.version,
    formatVersion: metadata?.formatVersion,
    encrypted,
    recordsCount: metadata?.recordsCount,
    groupsCount: metadata?.groupsCount,
    ...(!compatible && warningReason && { warningReason }),
  };
}
