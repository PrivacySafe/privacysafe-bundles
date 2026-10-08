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
  APP_DOMAIN,
  METADATA_FILE_NAME,
  PAYLOAD_FILE_NAME,
  backupFileName,
  isForeignAppMetadataPath,
  isSafeArchivePath,
  makeBackupMetadata,
  makeBackupMetadataBytes,
} from '@shared/utils/backup-archive';
import { GROUPS_FILE_NAME, IMAGES_FOLDER } from '@shared/constants';

describe('backupFileName', () => {

  const AT = new Date(2026, 8, 5, 14, 30);

  it('carries the app version, with dots replaced', () => {
    expect(backupFileName(AT, '0.2.3'))
    .toBe('treasure-backup-0_2_3-2026-09-05_14-30.zip');
  });

  // A name like `treasure-backup-0.2.3-…` reads as a file with a `.3-…`
  // extension to file dialogs and unpackers alike.
  it('leaves no dots in the version segment', () => {
    expect(backupFileName(AT, '1.10.2')).not.toMatch(/backup-\d+\./);
  });

  it('strips a leading v and surrounding spaces', () => {
    expect(backupFileName(AT, ' v0.2.3 '))
    .toBe('treasure-backup-0_2_3-2026-09-05_14-30.zip');
  });

  // Rather than writing `undefined` into the name.
  it('drops the segment when there is no version', () => {
    expect(backupFileName(AT)).toBe('treasure-backup-2026-09-05_14-30.zip');
    expect(backupFileName(AT, '')).toBe('treasure-backup-2026-09-05_14-30.zip');
    expect(backupFileName(AT, '   ')).toBe('treasure-backup-2026-09-05_14-30.zip');
  });

  it('pads every part of the stamp', () => {
    expect(backupFileName(new Date(2026, 0, 2, 3, 4), '0.2.3'))
    .toBe('treasure-backup-0_2_3-2026-01-02_03-04.zip');
  });

});

describe('isSafeArchivePath', () => {

  it('accepts the entries this app writes', () => {
    expect(isSafeArchivePath(GROUPS_FILE_NAME)).toBe(true);
    expect(isSafeArchivePath('rec-1')).toBe(true);
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/abc`)).toBe(true);
  });

  it('refuses the container entries, which are not app data', () => {
    expect(isSafeArchivePath(METADATA_FILE_NAME)).toBe(false);
    expect(isSafeArchivePath(PAYLOAD_FILE_NAME)).toBe(false);
  });

  // The archive is a file the user picked, and nothing stops it from carrying
  // `../../` in an entry name.
  it('refuses paths trying to escape the app storage', () => {
    expect(isSafeArchivePath('../outside')).toBe(false);
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/../../outside`)).toBe(false);
    expect(isSafeArchivePath('/etc/passwd')).toBe(false);
    expect(isSafeArchivePath('\\windows\\system32')).toBe(false);
  });

  it('refuses folder entries and desktop junk', () => {
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/`)).toBe(false);
    expect(isSafeArchivePath('__MACOSX/whatever')).toBe(false);
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/.DS_Store`)).toBe(false);
    expect(isSafeArchivePath('')).toBe(false);
  });

  // Defence in depth: such an archive is refused earlier, when its container is
  // opened, but its metadata is never ours to write either way.
  it('refuses the metadata file of another app', () => {
    expect(isSafeArchivePath('contacts_app_privacysafe_io.json')).toBe(false);
  });

});

describe('isForeignAppMetadataPath', () => {

  it('names the metadata file of another privacysafe app', () => {
    expect(isForeignAppMetadataPath('contacts_app_privacysafe_io.json')).toBe(true);
    expect(isForeignAppMetadataPath('chat_app_privacysafe_io.json')).toBe(true);
  });

  it('does not name our own, nor ordinary entries', () => {
    expect(isForeignAppMetadataPath(METADATA_FILE_NAME)).toBe(false);
    expect(isForeignAppMetadataPath(GROUPS_FILE_NAME)).toBe(false);
    expect(isForeignAppMetadataPath(`${IMAGES_FOLDER}/abc`)).toBe(false);
    expect(isForeignAppMetadataPath('')).toBe(false);
  });

});

describe('makeBackupMetadata', () => {

  it('stamps the app domain and the format version', () => {
    const metadata = makeBackupMetadata({ version: '0.2.3', recordsCount: 42, groupsCount: 5 });

    expect(metadata.appDomain).toBe(APP_DOMAIN);
    expect(metadata.version).toBe('0.2.3');
    expect(metadata.formatVersion).toBe(1);
    expect(metadata.recordsCount).toBe(42);
    expect(metadata.groupsCount).toBe(5);
    expect(Date.parse(metadata.createdAt)).not.toBeNaN();
  });

  // How much is stored says something about it, and someone who cannot open the
  // archive has no business learning it.
  it('leaves the counts out of an encrypted archive', () => {
    const metadata = makeBackupMetadata({
      version: '0.2.3',
      encryption: {
        alg: 'AES-GCM', keyLen: 256, kdf: 'PBKDF2', hash: 'SHA-256',
        iterations: 250000, salt: 'c2FsdA==', iv: 'aXY=',
      },
    });

    expect(metadata.recordsCount).toBeUndefined();
    expect(metadata.groupsCount).toBeUndefined();
    expect(metadata.encryption?.alg).toBe('AES-GCM');
  });

  it('keeps a zero count, which is not the same as an absent one', () => {
    const metadata = makeBackupMetadata({ version: '0.2.3', recordsCount: 0, groupsCount: 0 });

    expect(metadata.recordsCount).toBe(0);
    expect(metadata.groupsCount).toBe(0);
  });

  it('serialises to json a reader can parse', () => {
    const bytes = makeBackupMetadataBytes({ version: '0.2.3', recordsCount: 1, groupsCount: 0 });
    const parsed = JSON.parse(new TextDecoder().decode(bytes));

    expect(parsed.appDomain).toBe(APP_DOMAIN);
    expect(parsed.formatVersion).toBe(1);
  });

});
