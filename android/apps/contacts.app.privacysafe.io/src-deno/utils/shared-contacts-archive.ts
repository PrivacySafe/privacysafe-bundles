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
// Reading of an export file with shared contacts (.w3nec), made by
// contacts-share-srv.ts on the sending side.
import { unzipSync, type Unzipped } from 'fflate/browser';
import { canonicalMail } from '@main/common/utils/mail-address.ts';
import { SHARE_DATA_FILE, SHARE_DATA_VERSION, SHARE_IMAGES_FOLDER } from '../constants.ts';
import { isSafeArchivePath } from './backup-archive.ts';
import { dataURLFromImage } from './image-data-url.ts';
import type { ImportedContact, SharedContactsData, SharedImportError } from '../../src/types/index.ts';

/**
 * Failure to read an export file. Like BackupArchiveFailure, the class does
 * not survive the ipc boundary, so the reason is put into the message too.
 */
export class SharedContactsArchiveFailure extends Error {
  constructor(public readonly reason: SharedImportError) {
    super(`File with shared contacts cannot be used: ${reason}`);
    this.name = 'SharedContactsArchiveFailure';
  }
}

function asText(value: unknown): string {
  return (typeof value === 'string') ? value : '';
}

/**
 * Contacts of an export file, with avatars as data-urls, the form in which the
 * app keeps them. Entries without a usable mail are dropped, and so are
 * repeated ones: one address is one contact.
 */
export function readSharedContactsArchive(bytes: Uint8Array): ImportedContact[] {
  let entries: Unzipped;
  try {
    entries = unzipSync(bytes, { filter: file => isSafeArchivePath(file.name) });
  } catch {
    throw new SharedContactsArchiveFailure('corrupted_archive');
  }

  const dataBytes = entries[SHARE_DATA_FILE];
  if (!dataBytes) {
    throw new SharedContactsArchiveFailure('no_data_file');
  }

  let data: SharedContactsData;
  try {
    data = JSON.parse(new TextDecoder().decode(dataBytes)) as SharedContactsData;
  } catch {
    throw new SharedContactsArchiveFailure('corrupted_archive');
  }

  if (!data || !Array.isArray(data.contacts)) {
    throw new SharedContactsArchiveFailure('corrupted_archive');
  }
  if ((typeof data.version !== 'number') || (data.version > SHARE_DATA_VERSION)) {
    throw new SharedContactsArchiveFailure('unsupported_version');
  }

  // avatarId -> data-url. The name in the archive is `<avatarId>.<ext>`.
  const images = new Map<string, string>();
  for (const [path, imageBytes] of Object.entries(entries)) {
    const prefix = `${SHARE_IMAGES_FOLDER}/`;
    if (!path.startsWith(prefix)) {
      continue;
    }
    const name = path.slice(prefix.length);
    const dot = name.lastIndexOf('.');
    if ((dot <= 0) || name.includes('/')) {
      continue;
    }
    const dataURL = dataURLFromImage(imageBytes, name.slice(dot + 1));
    if (dataURL) {
      images.set(name.slice(0, dot), dataURL);
    }
  }

  const seen = new Set<string>();
  const contacts: ImportedContact[] = [];
  for (const item of data.contacts) {
    const mail = asText(item?.mail).trim();
    const cMail = canonicalMail(mail);
    if (!cMail || seen.has(cMail)) {
      continue;
    }
    seen.add(cMail);

    const avatarId = asText(item.avatarId);
    const avatarImage = avatarId ? images.get(avatarId) : undefined;
    contacts.push({
      mail,
      name: asText(item.name),
      phone: asText(item.phone),
      notice: asText(item.notice),
      timestamp: (typeof item.timestamp === 'number') ? item.timestamp : 0,
      ...(avatarImage ? { avatarId, avatarImage } : {}),
      settings: null,
      activities: null,
      key: item.key ?? null,
    });
  }

  return contacts;
}
