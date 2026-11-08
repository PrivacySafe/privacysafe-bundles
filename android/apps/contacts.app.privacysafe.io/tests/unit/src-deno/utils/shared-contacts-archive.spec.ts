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
import { zipSync, strToU8 } from 'fflate';
import {
  readSharedContactsArchive,
  SharedContactsArchiveFailure,
} from '@deno/utils/shared-contacts-archive.ts';
import { dataURLFromImage, imageFromDataURL } from '@deno/utils/image-data-url.ts';

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function archive(data: unknown, files: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    ...(data === undefined ? {} : { 'contacts.json': strToU8(JSON.stringify(data)) }),
    ...files,
  });
}

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as SharedContactsArchiveFailure).reason;
  }
  return undefined;
}

describe('image data-urls', () => {

  it('turns image bytes into a data-url and back', () => {
    const dataURL = dataURLFromImage(PNG_BYTES, 'png')!;

    expect(dataURL.startsWith('data:image/png;base64,')).toBe(true);
    expect(imageFromDataURL(dataURL)).toEqual({ bytes: PNG_BYTES, ext: 'png' });
  });

  it('does not take a file of unknown type as an image', () => {
    expect(dataURLFromImage(PNG_BYTES, 'exe')).toBeUndefined();
  });

});

describe('readSharedContactsArchive', () => {

  it('reads contacts with their avatars', () => {
    const bytes = archive(
      {
        version: 1,
        createdAt: 1,
        contacts: [
          { mail: 'ann@3nweb.com', name: 'Ann', phone: '1', notice: 'n', avatarId: 'a1', timestamp: 3, key: null },
          { mail: 'bob@3nweb.com', name: 'Bob', timestamp: 4, key: null },
        ],
      },
      { 'images/a1.png': PNG_BYTES },
    );

    const contacts = readSharedContactsArchive(bytes);

    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      mail: 'ann@3nweb.com',
      name: 'Ann',
      phone: '1',
      notice: 'n',
      avatarId: 'a1',
      settings: null,
      activities: null,
    });
    expect(contacts[0].avatarImage).toBe(dataURLFromImage(PNG_BYTES, 'png'));
    expect(contacts[1]).toMatchObject({ mail: 'bob@3nweb.com', phone: '', notice: '' });
    expect(contacts[1].avatarImage).toBeUndefined();
  });

  it('drops entries without a usable address, and repeated addresses', () => {
    const contacts = readSharedContactsArchive(archive({
      version: 1,
      createdAt: 1,
      contacts: [
        { mail: '' },
        { name: 'no mail' },
        { mail: 'Ann@3nweb.com' },
        { mail: 'ann@3NWEB.com' },
        null,
      ],
    }));

    expect(contacts.map(c => c.mail)).toEqual(['Ann@3nweb.com']);
  });

  it('leaves an avatar out when its file is missing', () => {
    const contacts = readSharedContactsArchive(archive({
      version: 1,
      createdAt: 1,
      contacts: [{ mail: 'ann@3nweb.com', avatarId: 'gone' }],
    }));

    expect(contacts[0].avatarId).toBeUndefined();
    expect(contacts[0].avatarImage).toBeUndefined();
  });

  it('refuses what is not a zip', () => {
    expect(reasonOf(() => readSharedContactsArchive(new Uint8Array([1, 2, 3])))).toBe('corrupted_archive');
  });

  it('refuses an archive without the data file', () => {
    expect(reasonOf(() => readSharedContactsArchive(archive(undefined, { 'x.txt': PNG_BYTES }))))
      .toBe('no_data_file');
  });

  it('refuses a data file of a newer format', () => {
    expect(reasonOf(() => readSharedContactsArchive(archive({ version: 99, createdAt: 1, contacts: [] }))))
      .toBe('unsupported_version');
  });

  it('refuses a data file without contacts', () => {
    expect(reasonOf(() => readSharedContactsArchive(archive({ version: 1 })))).toBe('corrupted_archive');
  });

});
