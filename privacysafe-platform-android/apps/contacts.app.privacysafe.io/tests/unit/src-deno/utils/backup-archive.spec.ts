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
  APP_DOMAIN,
  backupFileName,
  isForeignAppMetadataPath,
  isSafeArchivePath,
  makeBackupMetadata,
  prepareRestoredContactRows,
  splitArchiveEntries,
  METADATA_FILE_NAME,
  PAYLOAD_FILE_NAME,
} from '@deno/utils/backup-archive.ts';
import { CONTACTS_DB_FILE, IMAGES_FOLDER } from '@deno/constants';
import type { RawPerson } from '@main/types';

const OWN = 'me@3nweb.com';

function rawPerson(over: Partial<RawPerson> = {}): RawPerson {
  return {
    id: 'x',
    mail: 'a@b.c',
    name: null,
    avatarId: null,
    timestamp: 0,
    notice: null,
    phone: null,
    activities: null,
    settings: null,
    ...over,
  } as RawPerson;
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('isSafeArchivePath', () => {

  it('accepts the entries this app writes', () => {
    expect(isSafeArchivePath(CONTACTS_DB_FILE)).toBe(true);
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/abc`)).toBe(true);
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/abc-mini`)).toBe(true);
    expect(isSafeArchivePath(METADATA_FILE_NAME)).toBe(true);
  });

  // The archive is a file the user picked, so nothing stops an entry name from
  // pointing outside the app's storage.
  it('rejects paths that escape the storage root', () => {
    expect(isSafeArchivePath('../outside')).toBe(false);
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/../../outside`)).toBe(false);
    expect(isSafeArchivePath('/etc/passwd')).toBe(false);
    expect(isSafeArchivePath('\\windows\\system32')).toBe(false);
  });

  it('rejects folder entries and desktop zip junk', () => {
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/`)).toBe(false);
    expect(isSafeArchivePath('__MACOSX/whatever')).toBe(false);
    expect(isSafeArchivePath(`${IMAGES_FOLDER}/.DS_Store`)).toBe(false);
    expect(isSafeArchivePath('')).toBe(false);
  });

});

describe('isForeignAppMetadataPath', () => {

  it('names the metadata file of another privacysafe app', () => {
    expect(isForeignAppMetadataPath('treasure_app_privacysafe_io.json')).toBe(true);
    expect(isForeignAppMetadataPath('chat_app_privacysafe_io.json')).toBe(true);
  });

  it('does not name our own, nor ordinary entries', () => {
    expect(isForeignAppMetadataPath(METADATA_FILE_NAME)).toBe(false);
    expect(isForeignAppMetadataPath(CONTACTS_DB_FILE)).toBe(false);
    expect(isForeignAppMetadataPath(`${IMAGES_FOLDER}/abc`)).toBe(false);
    expect(isForeignAppMetadataPath('')).toBe(false);
  });

  // An archive of another app unpacks, and its entries look restorable on their
  // own, so its metadata must never be written into this app's storage.
  it('keeps the metadata of another app out of a restore', () => {
    expect(isSafeArchivePath('treasure_app_privacysafe_io.json')).toBe(false);
  });

});

describe('makeBackupMetadata', () => {

  it('stamps the app domain and the format version', () => {
    const metadata = makeBackupMetadata({ version: '0.8.34', contactsCount: 7 });

    expect(metadata.appDomain).toBe(APP_DOMAIN);
    expect(metadata.version).toBe('0.8.34');
    expect(metadata.formatVersion).toBe(1);
    expect(metadata.contactsCount).toBe(7);
    expect(Date.parse(metadata.createdAt)).not.toBeNaN();
  });

  // How large an address book is says something about it, and someone who
  // cannot open the archive has no business learning it.
  it('leaves the counts out of an encrypted archive', () => {
    const metadata = makeBackupMetadata({
      version: '0.8.34',
      encryption: {
        alg: 'AES-GCM', keyLen: 256, kdf: 'PBKDF2', hash: 'SHA-256',
        iterations: 250000, salt: 'c2FsdA==', iv: 'aXY=',
      },
    });

    expect(metadata.contactsCount).toBeUndefined();
    expect(metadata.encryption?.alg).toBe('AES-GCM');
  });

  it('omits an empty list of skipped images', () => {
    expect(makeBackupMetadata({ version: '0.8.34', skippedImages: [] }).skippedImages)
    .toBeUndefined();
    expect(makeBackupMetadata({ version: '0.8.34', skippedImages: ['a'] }).skippedImages)
    .toEqual(['a']);
  });

});

describe('splitArchiveEntries', () => {

  it('sorts a mixed archive into the db file and the avatars', () => {
    const res = splitArchiveEntries([
      [METADATA_FILE_NAME, bytes(1)],
      [CONTACTS_DB_FILE, bytes(2)],
      [`${IMAGES_FOLDER}/av1`, bytes(3)],
      [`${IMAGES_FOLDER}/av1-mini`, bytes(4)],
      ['some-other-file', bytes(5)],
    ]);

    expect(res.dbBytes).toEqual(bytes(2));
    expect(res.images).toEqual([
      { name: 'av1', bytes: bytes(3) },
      { name: 'av1-mini', bytes: bytes(4) },
    ]);
    expect(res.ignored).toEqual(['some-other-file']);
  });

  it('reports no db file when the archive has none', () => {
    const res = splitArchiveEntries([[METADATA_FILE_NAME, bytes(1)]]);

    expect(res.dbBytes).toBeUndefined();
    expect(res.images).toEqual([]);
  });

  it('does not treat the metadata or the encrypted payload as unknown', () => {
    const res = splitArchiveEntries([
      [METADATA_FILE_NAME, bytes(1)],
      [PAYLOAD_FILE_NAME, bytes(2)],
    ]);

    expect(res.ignored).toEqual([]);
  });

  // filesStoreService addresses avatars by a flat name, so a nested path is
  // not an avatar this app could ever write back.
  it('ignores nested paths under the images folder', () => {
    const res = splitArchiveEntries([[`${IMAGES_FOLDER}/nested/av1`, bytes(1)]]);

    expect(res.images).toEqual([]);
    expect(res.ignored).toEqual([`${IMAGES_FOLDER}/nested/av1`]);
  });

});

describe('prepareRestoredContactRows', () => {

  // updateContactsTable DROPs the table before its first insert, so a row that
  // fails halfway leaves the address book truncated. Each case below is a row
  // that WOULD fail an insert.
  it('drops rows without a usable mail address', () => {
    const { rows, dropped } = prepareRestoredContactRows([
      rawPerson({ id: 'a', mail: 'ann@3nweb.com' }),
      rawPerson({ id: 'b', mail: '' }),
      rawPerson({ id: 'c', mail: '   ' }),
      rawPerson({ id: 'd', mail: null as unknown as string }),
    ], OWN, 100);

    expect(dropped).toBe(3);
    expect(rows.filter(r => r.mail === 'ann@3nweb.com')).toHaveLength(1);
    expect(rows.every(r => !!r.mail)).toBe(true);
  });

  it('renumbers duplicated ids, keeping the first occurrence', () => {
    const { rows } = prepareRestoredContactRows([
      rawPerson({ id: 'dup', mail: 'ann@3nweb.com' }),
      rawPerson({ id: 'dup', mail: 'bob@3nweb.com' }),
    ], OWN, 100);

    const ann = rows.find(r => r.mail === 'ann@3nweb.com')!;
    const bob = rows.find(r => r.mail === 'bob@3nweb.com')!;
    expect(ann.id).toBe('dup');
    expect(bob.id).not.toBe('dup');
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
  });

  it('folds rows denoting the same account, keeping the fresher one', () => {
    const { rows, deduped } = prepareRestoredContactRows([
      rawPerson({ id: 'a', mail: 'ann@3nweb.com', name: 'old', timestamp: 1 }),
      rawPerson({ id: 'b', mail: 'ann@3nweb.com', name: 'new', timestamp: 9 }),
    ], OWN, 100);

    expect(deduped).toBe(1);
    const ann = rows.filter(r => r.mail === 'ann@3nweb.com');
    expect(ann).toHaveLength(1);
    expect(ann[0].name).toBe('new');
  });

  // The service's own duplicate check compares canonically; a restore must not
  // be the way to get one person into the book twice.
  it('treats addresses differing only in case as one account', () => {
    const { rows } = prepareRestoredContactRows([
      rawPerson({ id: 'a', mail: 'Ann@3NWeb.com', timestamp: 1 }),
      rawPerson({ id: 'b', mail: 'ann@3nweb.com', timestamp: 2 }),
    ], OWN, 100);

    expect(rows.filter(r => r.mail.toLowerCase() === 'ann@3nweb.com')).toHaveLength(1);
  });

  it('puts the own contact back when the archive has none', () => {
    const { rows, ownContactAdded } = prepareRestoredContactRows([
      rawPerson({ id: 'a', mail: 'ann@3nweb.com' }),
    ], OWN, 100);

    expect(ownContactAdded).toBe(true);
    expect(rows[0]).toMatchObject({ id: OWN, mail: OWN, timestamp: 100 });
  });

  it('does not duplicate an own contact that differs only in case', () => {
    const { rows, ownContactAdded } = prepareRestoredContactRows([
      rawPerson({ id: 'a', mail: 'Me@3NWeb.com' }),
    ], OWN, 100);

    expect(ownContactAdded).toBe(false);
    expect(rows).toHaveLength(1);
  });

  // A row carrying the own address as its id must not push the record just put
  // in front of the list off its id.
  it('keeps the own record when another row claims its id', () => {
    const { rows } = prepareRestoredContactRows([
      rawPerson({ id: OWN, mail: 'ann@3nweb.com' }),
    ], OWN, 100);

    expect(rows[0]).toMatchObject({ id: OWN, mail: OWN });
    expect(rows[1].mail).toBe('ann@3nweb.com');
    expect(rows[1].id).not.toBe(OWN);
  });

  it('yields just the own contact for an empty archive', () => {
    const { rows } = prepareRestoredContactRows([], OWN, 100);

    expect(rows).toEqual([{ id: OWN, mail: OWN, timestamp: 100 }]);
  });

  it('gives every row an id and a numeric timestamp', () => {
    const { rows } = prepareRestoredContactRows([
      rawPerson({ id: '', mail: 'ann@3nweb.com', timestamp: '123' as unknown as number }),
      rawPerson({ id: '  ', mail: 'bob@3nweb.com', timestamp: undefined }),
      rawPerson({ id: 'c', mail: 'cid@3nweb.com', timestamp: null as unknown as number }),
    ], OWN, 100);

    for (const row of rows) {
      expect(typeof row.id).toBe('string');
      expect(row.id.trim()).not.toBe('');
      expect(typeof row.timestamp).toBe('number');
      expect(Number.isNaN(row.timestamp)).toBe(false);
    }
    expect(rows.find(r => r.mail === 'ann@3nweb.com')!.timestamp).toBe(123);
    expect(rows.find(r => r.mail === 'bob@3nweb.com')!.timestamp).toBe(0);
  });

  it('trims surrounding whitespace off the address', () => {
    const { rows } = prepareRestoredContactRows([
      rawPerson({ id: 'a', mail: '  ann@3nweb.com  ' }),
    ], OWN, 100);

    expect(rows.find(r => r.id === 'a')!.mail).toBe('ann@3nweb.com');
  });

});

describe('backupFileName', () => {

  it('carries the app version and the creation time', () => {
    expect(backupFileName(new Date(2026, 8, 5, 14, 30), '0.8.34'))
    .toBe('contacts-backup-0_8_34-2026-09-05_14-30.zip');
  });

  it('pads single-digit date components', () => {
    expect(backupFileName(new Date(2026, 0, 2, 3, 4), '1.0.0'))
    .toBe('contacts-backup-1_0_0-2026-01-02_03-04.zip');
  });

  it('normalises a version written with a leading v or spaces', () => {
    expect(backupFileName(new Date(2026, 8, 5, 14, 30), ' v0.8.34 '))
    .toBe('contacts-backup-0_8_34-2026-09-05_14-30.zip');
  });

  // Better a name without the version than one with `undefined` in it.
  it('leaves the version segment out when there is no version', () => {
    expect(backupFileName(new Date(2026, 8, 5, 14, 30)))
    .toBe('contacts-backup-2026-09-05_14-30.zip');
    expect(backupFileName(new Date(2026, 8, 5, 14, 30), ''))
    .toBe('contacts-backup-2026-09-05_14-30.zip');
  });

});
