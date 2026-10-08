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
// The outer layer of a backup file: the metadata, and - when a passphrase is
// used - the encrypted payload wrapping the inner archive.
//
// The synchronous fflate api is used deliberately: the asynchronous one spins up
// a worker through URL.createObjectURL, which is not something to rely on inside
// the platform's webview.
import { unzipSync, zipSync } from 'fflate';
import {
  isForeignAppMetadataPath,
  makeBackupMetadataBytes,
} from '@shared/backup-archive';
import { APP_DOMAIN, METADATA_FILE_NAME, PAYLOAD_FILE_NAME } from '@shared/constants/backup';
import type { BackupArchiveError, BackupMetadataContent, SkippedAttachment } from '~/backup.types';
import { decryptPayload, encryptPayload, isSubtleCryptoAvailable } from './backup-crypto';

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
  /** Bytes of the archive holding the records and the attachments. */
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
 * discloses nothing beyond its own metadata - not the number of messages, not
 * even how many files there are. That is why the counts are not passed on here
 * while `snapshotTs` is: without the archive's own stamp a restore has no
 * barrier for its `replace` mode, and a stamp says nothing about the size of a
 * conversation history.
 */
export async function packEncryptedContainer(
  innerZipBytes: Uint8Array,
  passphrase: string,
  appVersion: string,
  opts?: { snapshotTs?: number; skippedAttachments?: SkippedAttachment[] },
): Promise<Uint8Array> {
  const { cipher, params } = await encryptPayload(innerZipBytes, passphrase);

  return zipSync({
    [METADATA_FILE_NAME]: makeBackupMetadataBytes({
      version: appVersion,
      snapshotTs: opts?.snapshotTs,
      skippedAttachments: opts?.skippedAttachments,
      encryption: params,
    }),
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
  if (metadata?.appDomain && (metadata.appDomain !== APP_DOMAIN)) {
    throw new BackupArchiveFailure('foreign_archive');
  }

  // Caught before a passphrase is asked for: another app's archive is not worth
  // making the user type anything.
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
    // AES-GCM refusing the tag IS the wrong-passphrase answer; there is no other
    // check to make, and no way to tell a wrong key from tampering.
    throw new BackupArchiveFailure('wrong_passphrase');
  }

  return { plainZipBytes, metadata, metadataInvalid, encrypted: true };
}
