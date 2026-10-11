/*
 Copyright (C) 2020-2025 3NSoft Inc.

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
// @deno-types="../../shared-libs/sqlite-on-3nstorage/index.d.ts"

/* eslint-disable @typescript-eslint/no-empty-function */
import { SQLiteOn3NStorage } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import type { Person, PersonSettings, PersonView, RawPerson } from '../../src/types/index.ts';
import { randomStr } from '../../src/common/services/base/random.ts';
import { makeContactsException } from '../utils/exceptions.ts';
import { safeJsonParse } from '../utils/obj-processing.ts';
import { isNewContactId } from '@main/common/constants/index.ts';
import { canonicalMail } from '@main/common/utils/mail-address.ts';
import {
  objectFromQueryExecResult,
  personValueToSqlInsertParams,
  queryResultToPerson,
} from './contact-row-mapping.ts';

// Re-exported for existing importers; the implementations live in the pure,
// sqlite-runtime-free contact-row-mapping module.
export { objectFromQueryExecResult, personValueToSqlInsertParams, queryResultToPerson };

export interface ContactDB {
  insertContactInto: ({
    contact,
    withoutSaveToFile,
  }: {
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>;
    withoutSaveToFile?: boolean;
  }) => Promise<Person>;
  getContactFrom: (id: string) => Person | undefined;
  getContactByMail: (mail: string) => Person | undefined;
  updateContactInto: (
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>,
    withoutSaveToFile?: boolean,
  ) => Promise<Person>;
  deleteContactFrom: (id: string, withoutSaveToFile?: boolean) => Promise<boolean>;
  listAllContactsFrom: () => PersonView[];
  updateContactsTable: (
    contacts: RawPerson[] | Omit<Person, 'avatarImage'>[],
    withoutSaveToFile?: boolean,
  ) => Promise<boolean>;
  getIdsOfAllFilesInUse: () => string[];
}

export async function contactDb(
  sqlite: SQLiteOn3NStorage,
  /**
   * Called after every successful saveToFile. Used to upload the new local
   * version to the server RIGHT AWAY: leaving the file 'unsynced' (local
   * ahead of synced) opens a window in which the sync choreography
   * (adoptRemote on remote-change echoes of our own uploads) resets the
   * file node's version to the older synced one while the newer local
   * version file stays registered — after which EVERY next save fails with
   * "Version N already exists" (observed deterministically: fresh user,
   * contact #1 saves fine, contact #2 always fails).
   */
  afterSave?: () => Promise<void>,
): Promise<ContactDB> {
  async function saveDbToFile(): Promise<void> {
    await sqlite.saveToFile({ skipUpload: true });
    // Failures here (e.g. offline) must not fail the local save: write
    // itself succeeded, and syncUpload tolerates connect errors anyway.
    await afterSave?.().catch(() => {});
  }

  async function insertContactInto({
    contact,
    withoutSaveToFile,
  }: {
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>;
    withoutSaveToFile?: boolean;
  }): Promise<Person> {
    const contactData = JSON.parse(JSON.stringify(contact)) as
      | RawPerson
      | Omit<RawPerson, 'timestamp'>
      | Person
      | Omit<Person, 'timestamp' | 'avatarImage'>;
    if (isNewContactId(contactData.id)) {
      contactData.id = randomStr(8);
    }

    if (!('timestamp' in contactData) || contactData.timestamp === 0) {
      (contactData as Person).timestamp = Date.now();
    }

    const params = personValueToSqlInsertParams(contactData as Omit<Person, 'avatarImage'> | RawPerson);
    sqlite.db.exec(
      `--sql
    INSERT INTO contacts (id, name, mail, avatarId, timestamp, notice, phone, activities, settings)
    VALUES ($id, $name, $mail, $avatarId, $timestamp, $notice, $phone, $activities, $settings)
    ON CONFLICT(id) DO NOTHING`,
      params,
    );

    const dbChanged = sqlite.db.getRowsModified();
    if (dbChanged === 0) {
      throw makeContactsException({ contactAlreadyExists: true });
    }

    if (!withoutSaveToFile && dbChanged && dbChanged > 0) {
      try {
        await saveDbToFile();
      } catch (err) {
        // Roll the in-memory INSERT back: leaving it in makes every retry hit
        // a false "already exists" while the contact is absent from disk and
        // vanishes on restart (observed with a storage version conflict).
        sqlite.db.exec(`DELETE FROM contacts WHERE id = $id`, { $id: contactData.id });
        await sqlite.saveToFile({ skipUpload: true });
        throw err;
      }
    }

    return contactData as Person;
  }

  function getContactFrom(id: string): Omit<Person, 'avatarImage'> | undefined {
    const [sqlValue] = sqlite.db.exec(
      `--sql
    SELECT * FROM contacts WHERE id = $id`,
      { $id: id },
    );

    return sqlValue && sqlValue.values.length === 1 ? queryResultToPerson(sqlValue, 0) : undefined;
  }

  /**
   * Matched on the canonical form rather than by SQL equality: sqlite compares
   * TEXT byte by byte, so 'Ann@3NWeb.com' would not find a stored
   * 'ann@3nweb.com' and the duplicate check above it would let both in. The
   * table is a personal address book, so scanning it is cheap.
   */
  function getContactByMail(mail: string): Person | undefined {
    const canonical = canonicalMail(mail);
    if (!canonical) {
      return undefined;
    }

    const [sqlValue] = sqlite.db.exec(
      `--sql
    SELECT * FROM contacts`,
    );
    if (!sqlValue || !sqlValue.values.length) {
      return undefined;
    }

    for (let i = 0; i < sqlValue.values.length; i++) {
      const person = queryResultToPerson(sqlValue, i) as Person;
      if (canonicalMail(person.mail) === canonical) {
        return person;
      }
    }
    return undefined;
  }

  async function updateContactInto(
    contact: RawPerson | Omit<RawPerson, 'timestamp'> | Person | Omit<Person, 'timestamp' | 'avatarImage'>,
    withoutSaveToFile?: boolean,
  ): Promise<Person> {
    if (!contact.id) {
      throw makeContactsException({
        invalidValue: true,
        message: 'Given contact does not contain ID',
      });
    }

    // Read the current row first, so a failed file save can restore it (an
    // in-memory change that never reached disk must not survive the error).
    const contactBeforeUpdate = getContactFrom(contact.id);

    const updatedContact = {
      ...contact,
      timestamp: Date.now(),
    } as RawPerson | Omit<Person, 'avatarImage'>;
    const params = personValueToSqlInsertParams(updatedContact);

    sqlite.db.exec(
      `--sql
      UPDATE contacts
      SET name=$name, mail=$mail, avatarId=$avatarId, timestamp=$timestamp, notice=$notice, phone=$phone, activities=$activities, settings=$settings
      WHERE id = $id`,
      params,
    );

    const dbChanged = sqlite.db.getRowsModified();
    // No row matched: the contact is not in the table. Returning the given
    // object anyway told the caller "saved" for something that was never
    // stored - and after a removal on another device that is exactly what a
    // save of an open contact would do.
    if (dbChanged === 0) {
      throw makeContactsException({
        contactNotFound: true,
        message: `There is no contact with id ${contact.id}`,
      });
    }

    if (!withoutSaveToFile && dbChanged > 0) {
      try {
        await saveDbToFile();
      } catch (err) {
        if (contactBeforeUpdate) {
          sqlite.db.exec(
            `--sql
            UPDATE contacts
            SET name=$name, mail=$mail, avatarId=$avatarId, timestamp=$timestamp, notice=$notice, phone=$phone, activities=$activities, settings=$settings
            WHERE id = $id`,
            personValueToSqlInsertParams(contactBeforeUpdate),
          );
        }
        throw err;
      }
    }

    return {
      ...updatedContact,
      activities:
        updatedContact.activities === null
          ? null
          : typeof updatedContact.activities === 'string'
            ? safeJsonParse<Person['activities']>(updatedContact.activities)
            : updatedContact.activities,
      settings:
        updatedContact.settings === null
          ? null
          : typeof updatedContact.settings === 'string'
            ? safeJsonParse<PersonSettings>(updatedContact.settings)
            : updatedContact.settings,
    };
  }

  async function deleteContactFrom(id: string, withoutSaveToFile?: boolean): Promise<boolean> {
    const contactBeforeDelete = getContactFrom(id);

    sqlite.db.exec(
      `--sql
      DELETE FROM contacts WHERE id = $id`,
      { $id: id },
    );

    const dbChanged = sqlite.db.getRowsModified();
    if (!withoutSaveToFile && dbChanged && dbChanged > 0) {
      try {
        await saveDbToFile();
      } catch (err) {
        // Restore the in-memory row: the deletion never reached disk.
        if (contactBeforeDelete) {
          sqlite.db.exec(
            `--sql
          INSERT INTO contacts (id, name, mail, avatarId, timestamp, notice, phone, activities, settings)
          VALUES ($id, $name, $mail, $avatarId, $timestamp, $notice, $phone, $activities, $settings)
          ON CONFLICT(id) DO NOTHING`,
            personValueToSqlInsertParams(contactBeforeDelete),
          );
        }
        throw err;
      }
    }

    return dbChanged > 0;
  }

  function listAllContactsFrom(): Omit<PersonView, 'avatarImage'>[] {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT id, name, mail, avatarId, timestamp, settings
      FROM contacts`,
    );
    if (!sqlValue || !sqlValue.values) {
      return [];
    }

    const rows = objectFromQueryExecResult<Omit<PersonView, 'avatarImage'>>(sqlValue);

    for (const row of rows) {
      row.settings = row.settings
        ? (typeof row.settings === 'string' ? (safeJsonParse<PersonSettings>(row.settings) ?? {}) : row.settings)
        : {};
    }
    return rows;
  }

  function getIdsOfAllFilesInUse(): string[] {
    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT avatarId FROM contacts
      WHERE avatarId IS NOT NULL AND avatarId <> '' AND TRIM(avatarId) <> ''`,
    );

    if (!sqlValue) {
      return [];
    }

    const res: string[] = [];
    for (const value of sqlValue.values as string[][]) {
      for (const item of value) {
        res.push(item);
      }
    }

    return res;
  }

  function createContactsTable() {
    sqlite.db.exec(
      `--sql
        CREATE TABLE contacts (
          id          TEXT PRIMARY KEY UNIQUE,
          mail        TEXT NOT NULL,
          name        TEXT,
          avatarId    TEXT,
          timestamp   INTEGER,
          notice      TEXT,
          phone       TEXT,
          activities  TEXT,
          settings    TEXT
        )`,
    );
  }

  async function updateContactsTable(
    contacts: RawPerson[] | Omit<Person, 'avatarImage'>[],
    withoutSaveToFile?: boolean,
  ): Promise<boolean> {
    sqlite.db.exec(
      `--sql
      DROP TABLE contacts`,
    );

    createContactsTable();

    for (let i = 0; i < contacts.length; i++) {
      await insertContactInto({
        contact: contacts[i],
        withoutSaveToFile: withoutSaveToFile && i !== contacts.length - 1,
      });
    }

    return true;
  }

  async function initializeDB(): Promise<void> {
    const tableList = sqlite.listTables();

    if (!tableList.includes('contacts')) {
      createContactsTable();
      const userOwnAddr = await w3n.mailerid!.getUserId();
      await insertContactInto({
        contact: { id: userOwnAddr, mail: userOwnAddr },
        withoutSaveToFile: true,
      });
    }

    if (!tableList.includes('activities')) {
      sqlite.db.exec(
        `--sql
          CREATE TABLE activities (
          id          TEXT PRIMARY KEY UNIQUE,
          type        TEXT    NOT NULL,
          description TEXT,
          timestamp   INTEGER NOT NULL
        )`,
      );
    }

    const [sqlValue] = sqlite.db.exec('PRAGMA table_info(contacts)');
    const isThereTimestampField = sqlValue.values.some(item => item.includes('timestamp'));
    const isThereAvatarIdField = sqlValue.values.some(item => item.includes('avatarId'));
    const isThereSettingsField = sqlValue.values.some(item => item.includes('settings'));

    if (!isThereTimestampField) {
      sqlite.db.exec(
        `--sql
        ALTER TABLE contacts
        ADD COLUMN timestamp INTEGER
        DEFAULT 0`,
      );
    }

    if (!isThereAvatarIdField) {
      sqlite.db.exec(
        `--sql
        ALTER TABLE contacts
        RENAME COLUMN avatar
        TO avatarId`,
      );
    }

    if (!isThereSettingsField) {
      sqlite.db.exec(
        `--sql
        ALTER TABLE contacts
        RENAME COLUMN avatarMini
        TO settings`,
      );
    }

    if (!isThereTimestampField || !isThereAvatarIdField || !isThereSettingsField) {
      await sqlite.saveToFile({ skipUpload: true });
    }
  }

  await initializeDB();

  return {
    insertContactInto,
    getContactFrom,
    getContactByMail,
    updateContactInto,
    deleteContactFrom,
    listAllContactsFrom,
    updateContactsTable,
    getIdsOfAllFilesInUse,
  };
}
