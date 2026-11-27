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
import type { QueryExecResult } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import type { ContactDate, Person, PersonSettings, PersonView, RawPerson } from '../../src/types/index.ts';
import { randomStr } from '../../src/common/services/base/random.ts';
import { makeContactsException } from '../utils/exceptions.ts';
import { safeJsonParse } from '../utils/obj-processing.ts';
import { isNewContactId } from '@main/common/constants/index.ts';
import { canonicalMail } from '@main/common/utils/mail-address.ts';
import { sanitizeContactDates } from '@main/common/utils/contact-dates.ts';
import {
  objectFromQueryExecResult,
  personValueToSqlInsertParams,
  queryResultToPerson,
  textOrUndefined,
} from './contact-row-mapping.ts';

// Re-exported for existing importers; the implementations live in the pure,
// sqlite-runtime-free contact-row-mapping module.
export { objectFromQueryExecResult, personValueToSqlInsertParams, queryResultToPerson };

/**
 * All rows of the contacts table of a db, or none for a db without the table
 * or with an empty one - a file from another device, not only this app's.
 */
export function contactRowsOf(db: { exec: (sql: string) => QueryExecResult[] }): RawPerson[] {
  let sqlValue: QueryExecResult | undefined;
  try {
    [sqlValue] = db.exec('SELECT * FROM contacts');
  } catch {
    return [];
  }
  return (sqlValue && sqlValue.values) ? objectFromQueryExecResult<RawPerson>(sqlValue) : [];
}

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
  listContactsWithDates: () => ContactWithDates[];
}

/** What the reminders need to know of a contact that has dates. */
export type ContactWithDates = Pick<Person, 'id' | 'name' | 'mail'> & { dates: ContactDate[] };

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
  function hasDatesColumn(): boolean {
    const [sqlValue] = sqlite.db.exec('PRAGMA table_info(contacts)');
    // A row of table_info is [cid, name, type, notnull, dflt_value, pk].
    return !!sqlValue && sqlValue.values.some(column => column[1] === 'dates');
  }

  /**
   * Adds the `dates` column if the table lacks it. Checked before EVERY write,
   * not only at start: reloadDb brings in whatever file synchronisation has
   * adopted, and a device still on an older version of the app uploads a table
   * without the column. Inserting into it would fail. The change is in memory
   * only and reaches the file with the write that needed it.
   */
  function ensureDatesColumn(): boolean {
    if (hasDatesColumn()) {
      return false;
    }

    sqlite.db.exec(
      `--sql
      ALTER TABLE contacts
      ADD COLUMN dates TEXT`,
    );
    return true;
  }

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
    ensureDatesColumn();
    sqlite.db.exec(
      `--sql
    INSERT INTO contacts (id, name, mail, avatarId, timestamp, notice, phone, activities, settings, dates)
    VALUES ($id, $name, $mail, $avatarId, $timestamp, $notice, $phone, $activities, $settings, $dates)
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

    ensureDatesColumn();
    sqlite.db.exec(
      `--sql
      UPDATE contacts
      SET name=$name, mail=$mail, avatarId=$avatarId, timestamp=$timestamp, notice=$notice, phone=$phone, activities=$activities, settings=$settings, dates=$dates
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
            SET name=$name, mail=$mail, avatarId=$avatarId, timestamp=$timestamp, notice=$notice, phone=$phone, activities=$activities, settings=$settings, dates=$dates
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
      dates: sanitizeContactDates(updatedContact.dates),
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
          ensureDatesColumn();
          sqlite.db.exec(
            `--sql
          INSERT INTO contacts (id, name, mail, avatarId, timestamp, notice, phone, activities, settings, dates)
          VALUES ($id, $name, $mail, $avatarId, $timestamp, $notice, $phone, $activities, $settings, $dates)
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
      // See queryResultToPerson: text columns may hold other types.
      row.name = textOrUndefined(row.name);
      row.mail = textOrUndefined(row.mail) ?? '';
      row.settings = row.settings
        ? (typeof row.settings === 'string' ? (safeJsonParse<PersonSettings>(row.settings) ?? {}) : row.settings)
        : {};
    }
    return rows;
  }

  function listContactsWithDates(): ContactWithDates[] {
    if (!hasDatesColumn()) {
      return [];
    }

    const [sqlValue] = sqlite.db.exec(
      `--sql
      SELECT id, name, mail, dates
      FROM contacts
      WHERE dates IS NOT NULL AND dates <> ''`,
    );
    if (!sqlValue || !sqlValue.values) {
      return [];
    }

    return objectFromQueryExecResult<Pick<RawPerson, 'id' | 'name' | 'mail' | 'dates'>>(sqlValue)
      .map(row => ({
        id: row.id,
        name: textOrUndefined(row.name),
        mail: textOrUndefined(row.mail) ?? '',
        dates: sanitizeContactDates(row.dates),
      }))
      .filter(row => row.dates.length > 0);
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
          settings    TEXT,
          dates       TEXT
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

    // The rows may come from another device's file. One without an address
    // fails the NOT NULL column, and stopping there left the table truncated
    // in memory - to be saved and uploaded by the next local change. Such rows
    // are left out, and one that fails anyway is skipped, not the rest.
    const rows = (contacts as RawPerson[]).filter(c => (typeof c?.mail === 'string') && !!c.mail.trim());
    for (let i = 0; i < rows.length; i++) {
      try {
        await insertContactInto({
          contact: rows[i],
          withoutSaveToFile: withoutSaveToFile && i !== rows.length - 1,
        });
      } catch (err) {
        await w3n.log('error', `Contact ${String(rows[i]?.id)} could not be written back to the table`, err);
      }
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

    const isDatesFieldAdded = ensureDatesColumn();

    if (!isThereTimestampField || !isThereAvatarIdField || !isThereSettingsField || isDatesFieldAdded) {
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
    listContactsWithDates,
  };
}
