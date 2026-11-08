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
import { randomStr } from '../src/common/services/base/random.ts';
import { readSharedContactsArchive } from './utils/shared-contacts-archive.ts';
import type { ImportedContact } from '../src/types/index.ts';

/**
 * How long read contacts wait for the window to import them. The window is
 * opened by the calling app right after the file is read, so contacts still
 * here after this time belong to an import that never started.
 */
const IMPORT_TTL_MILLIS = 30 * 60_000;

/**
 * Import of contacts shared by another user. Chat and inbox apps hand an
 * attachment file to prepareSharedContactsImport (service AppContacts), and
 * open this app with the returned id in the 'import-contacts' command; the
 * window then takes read contacts and decides on each of them with the user.
 */
export function contactsImportSrv() {
  const imports = new Map<string, ImportedContact[]>();

  async function prepareSharedContactsImport(
    file: web3n.files.ReadonlyFile,
  ): Promise<{ importId: string; contactsCount: number }> {
    if (!file || (typeof file.readBytes !== 'function')) {
      throw new Error('No file with shared contacts is given');
    }

    const bytes = await file.readBytes();
    if (!bytes) {
      throw new Error('File with shared contacts is empty');
    }

    const contacts = readSharedContactsArchive(bytes);
    const importId = randomStr(20);
    imports.set(importId, contacts);
    setTimeout(() => imports.delete(importId), IMPORT_TTL_MILLIS);

    return { importId, contactsCount: contacts.length };
  }

  /**
   * Hands read contacts over to the window, once: a second pass over the same
   * import, e.g. by a window re-created with the same start command, would
   * race the first one in adding the same contacts.
   */
  async function getSharedContactsImport(importId: string): Promise<ImportedContact[] | undefined> {
    const contacts = imports.get(importId);
    imports.delete(importId);
    return contacts;
  }

  async function finishSharedContactsImport(importId: string): Promise<void> {
    imports.delete(importId);
  }

  return {
    prepareSharedContactsImport,
    getSharedContactsImport,
    finishSharedContactsImport,
  };
}
