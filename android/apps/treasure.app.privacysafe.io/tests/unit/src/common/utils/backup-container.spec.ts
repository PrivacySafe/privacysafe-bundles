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
import { unzipSync, zipSync } from 'fflate';
import {
  BackupArchiveFailure,
  openBackupContainer,
  packEncryptedContainer,
  validateBackupContainer,
} from '@/common/utils/backup-container';
import {
  APP_DOMAIN, METADATA_FILE_NAME, PAYLOAD_FILE_NAME, makeBackupMetadataBytes,
} from '@shared/utils/backup-archive';
import { GROUPS_FILE_NAME, IMAGES_FOLDER } from '@shared/constants';

const PASSPHRASE = 'correct horse battery staple';
const APP_VERSION = '0.2.3';

// Deriving a key runs 250k PBKDF2 rounds, which the default timeout dislikes.
const TIMEOUT = 30000;

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** The archive the service packs: app data, no metadata of its own. */
function innerArchive(): Uint8Array {
  return zipSync({
    [GROUPS_FILE_NAME]: utf8('[{"id":"g1"}]'),
    'rec-1': utf8('{"id":"rec-1","password":"hunter2"}'),
    [`${IMAGES_FOLDER}/img-1`]: new Uint8Array([1, 2, 3, 4]),
  });
}

/** An unencrypted backup file: app data with the metadata alongside it. */
function plainArchive(metadata?: Record<string, unknown>): Uint8Array {
  return zipSync({
    [GROUPS_FILE_NAME]: utf8('[{"id":"g1"}]'),
    'rec-1': utf8('{"id":"rec-1"}'),
    [METADATA_FILE_NAME]: metadata
      ? utf8(JSON.stringify(metadata))
      : makeBackupMetadataBytes({ version: APP_VERSION, recordsCount: 1, groupsCount: 1 }),
  });
}

async function failureOf(fileBytes: Uint8Array, passphrase?: string): Promise<string> {
  try {
    await openBackupContainer(fileBytes, passphrase);
  } catch (err) {
    if (err instanceof BackupArchiveFailure) {
      return err.reason;
    }
    throw err;
  }
  throw new Error('the archive was opened, when it should not have been');
}

describe('packEncryptedContainer', () => {

  it('wraps the archive into metadata plus one opaque entry', async () => {
    const container = await packEncryptedContainer(innerArchive(), PASSPHRASE, APP_VERSION);
    const entries = unzipSync(container);

    expect(Object.keys(entries).sort()).toEqual([METADATA_FILE_NAME, PAYLOAD_FILE_NAME].sort());
  }, TIMEOUT);

  it('leaves the metadata readable without the passphrase', async () => {
    const container = await packEncryptedContainer(innerArchive(), PASSPHRASE, APP_VERSION);
    const metadata = JSON.parse(
      new TextDecoder().decode(unzipSync(container)[METADATA_FILE_NAME]),
    );

    expect(metadata.appDomain).toBe(APP_DOMAIN);
    expect(metadata.version).toBe(APP_VERSION);
    expect(metadata.encryption.alg).toBe('AES-GCM');
  }, TIMEOUT);

  // Nesting the archive as one entry is what keeps its shape private; the
  // counts are left out for the same reason.
  it('discloses neither the stored data nor how much of it there is', async () => {
    const container = await packEncryptedContainer(innerArchive(), PASSPHRASE, APP_VERSION);
    const metadata = JSON.parse(
      new TextDecoder().decode(unzipSync(container)[METADATA_FILE_NAME]),
    );

    expect(metadata.recordsCount).toBeUndefined();
    expect(metadata.groupsCount).toBeUndefined();
    expect(Buffer.from(container).includes(Buffer.from('hunter2'))).toBe(false);
    expect(Buffer.from(container).includes(Buffer.from('rec-1'))).toBe(false);
  }, TIMEOUT);

});

describe('openBackupContainer', () => {

  it('round-trips an encrypted archive', async () => {
    const inner = innerArchive();
    const container = await packEncryptedContainer(inner, PASSPHRASE, APP_VERSION);

    const opened = await openBackupContainer(container, PASSPHRASE);

    expect(opened.encrypted).toBe(true);
    expect(Array.from(opened.plainZipBytes)).toEqual(Array.from(inner));
    expect(Object.keys(unzipSync(opened.plainZipBytes)).sort())
    .toEqual([GROUPS_FILE_NAME, `${IMAGES_FOLDER}/img-1`, 'rec-1']);
  }, TIMEOUT);

  it('passes an unencrypted archive through untouched', async () => {
    const file = plainArchive();

    const opened = await openBackupContainer(file);

    expect(opened.encrypted).toBe(false);
    expect(Array.from(opened.plainZipBytes)).toEqual(Array.from(file));
    expect(opened.metadata?.version).toBe(APP_VERSION);
  });

  // So the caller can ask for one and try again with the same bytes.
  it('asks for a passphrase rather than failing', async () => {
    const container = await packEncryptedContainer(innerArchive(), PASSPHRASE, APP_VERSION);

    expect(await failureOf(container)).toBe('passphrase_required');
  }, TIMEOUT);

  it('names a wrong passphrase as such', async () => {
    const container = await packEncryptedContainer(innerArchive(), PASSPHRASE, APP_VERSION);

    expect(await failureOf(container, 'not the passphrase')).toBe('wrong_passphrase');
  }, TIMEOUT);

  it('names a file that is not a zip', async () => {
    expect(await failureOf(new Uint8Array([1, 2, 3, 4]))).toBe('corrupted_archive');
  });

  it('names an encrypted archive whose payload is missing', async () => {
    const container = await packEncryptedContainer(innerArchive(), PASSPHRASE, APP_VERSION);
    const withoutPayload = zipSync({
      [METADATA_FILE_NAME]: unzipSync(container)[METADATA_FILE_NAME],
    });

    expect(await failureOf(withoutPayload, PASSPHRASE)).toBe('corrupted_archive');
  }, TIMEOUT);

  it('reports metadata it cannot parse, without refusing the archive', async () => {
    const file = zipSync({
      'rec-1': utf8('{}'),
      [METADATA_FILE_NAME]: utf8('{ not json'),
    });

    const opened = await openBackupContainer(file);

    expect(opened.metadataInvalid).toBe(true);
    expect(opened.metadata).toBeUndefined();
  });

  describe('a backup of another app', () => {

    it('is refused by its appDomain', async () => {
      const file = plainArchive({
        appDomain: 'contacts.app.privacysafe.io', version: '0.8.34', formatVersion: 1,
      });

      expect(await failureOf(file)).toBe('foreign_archive');
    });

    // Archives written before appDomain existed carry no field to compare, and
    // another app's entries look restorable on their own.
    it('is refused by the name of its metadata file', async () => {
      const file = zipSync({
        'contacts_app_privacysafe_io.json': utf8('{"version":"0.8.34"}'),
        'contacts-db': new Uint8Array([1, 2, 3]),
      });

      expect(await failureOf(file)).toBe('foreign_archive');
    });

    // Refused before the user is made to type anything.
    it('is refused without asking for a passphrase', async () => {
      const file = zipSync({
        'contacts_app_privacysafe_io.json': utf8(JSON.stringify({
          version: '0.8.34',
          encryption: {
            alg: 'AES-GCM', keyLen: 256, kdf: 'PBKDF2', hash: 'SHA-256',
            iterations: 250000, salt: 'c2FsdA==', iv: 'aXY=',
          },
        })),
        [PAYLOAD_FILE_NAME]: new Uint8Array([9, 9, 9]),
      });

      expect(await failureOf(file)).toBe('foreign_archive');
    });

  });

});

describe('validateBackupContainer', () => {

  it('accepts an archive this build wrote', async () => {
    const opened = await openBackupContainer(plainArchive());

    const res = validateBackupContainer(opened, APP_VERSION);

    expect(res.valid).toBe(true);
    expect(res.compatible).toBe(true);
    expect(res.archiveVersion).toBe(APP_VERSION);
    expect(res.encrypted).toBe(false);
    expect(res.recordsCount).toBe(1);
  });

  it('carries the counts of an unencrypted archive through', async () => {
    const opened = await openBackupContainer(plainArchive({
      appDomain: APP_DOMAIN, version: APP_VERSION, formatVersion: 1,
      createdAt: '2026-09-05T00:00:00.000Z', recordsCount: 7, groupsCount: 2,
    }));

    const res = validateBackupContainer(opened, APP_VERSION);

    expect(res.recordsCount).toBe(7);
    expect(res.groupsCount).toBe(2);
  });

  it('marks an encrypted archive as such', async () => {
    const container = await packEncryptedContainer(innerArchive(), PASSPHRASE, APP_VERSION);
    const opened = await openBackupContainer(container, PASSPHRASE);

    const res = validateBackupContainer(opened, APP_VERSION);

    expect(res.valid).toBe(true);
    expect(res.encrypted).toBe(true);
  }, TIMEOUT);

  // Restorable, but only past the warning: the layout of an archive written
  // before formatVersion existed is not guaranteed.
  it('warns about an archive with no format version', async () => {
    const opened = await openBackupContainer(plainArchive({ version: '0.2.1' }));

    const res = validateBackupContainer(opened, APP_VERSION);

    expect(res.valid).toBe(true);
    expect(res.compatible).toBe(false);
    expect(res.archiveVersion).toBe('0.2.1');
  });

  it('warns about an archive with no metadata at all', async () => {
    const opened = await openBackupContainer(zipSync({ 'rec-1': utf8('{}') }));

    const res = validateBackupContainer(opened, APP_VERSION);

    expect(res.valid).toBe(true);
    expect(res.compatible).toBe(false);
    expect(res.warningReason).toBe('missing_metadata');
  });

  it('warns about a version from another minor release', async () => {
    const opened = await openBackupContainer(plainArchive({
      appDomain: APP_DOMAIN, version: '0.1.0', formatVersion: 1,
      createdAt: '2026-09-05T00:00:00.000Z',
    }));

    const res = validateBackupContainer(opened, APP_VERSION);

    expect(res.compatible).toBe(true);
    expect(res.archiveVersion).toBe('0.1.0');
  });

  // Unpacks, but holds nothing this app could restore.
  it('refuses an archive with no usable entry', async () => {
    const opened = await openBackupContainer(zipSync({
      [METADATA_FILE_NAME]: makeBackupMetadataBytes({ version: APP_VERSION }),
    }));

    const res = validateBackupContainer(opened, APP_VERSION);

    expect(res.valid).toBe(false);
    expect(res.error).toBe('foreign_archive');
  });

  it('refuses bytes that do not unpack', () => {
    const res = validateBackupContainer({
      plainZipBytes: new Uint8Array([1, 2, 3, 4]),
      metadataInvalid: false,
      encrypted: false,
    }, APP_VERSION);

    expect(res.valid).toBe(false);
    expect(res.error).toBe('corrupted_archive');
  });

});
